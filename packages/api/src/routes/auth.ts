import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Env, User, LinkedAccount } from '../types'
import {
  getAuthUrl,
  exchangeCode,
  getUserInfo,
  getCalendarList,
  encryptTokens,
} from '../services/google'
import {
  authMiddleware,
  createSession,
  deleteSession,
  getSessionCookieOptions,
} from '../middleware/auth'

const auth = new Hono<{
  Bindings: Env
  Variables: { user: User }
}>()

// Start OAuth flow
auth.get('/login', async (c) => {
  const state = crypto.randomUUID()
  await c.env.SESSION_KV.put(`oauth:${state}`, 'pending', { expirationTtl: 600 })
  const authUrl = getAuthUrl(c.env, state)
  return c.redirect(authUrl)
})

// OAuth callback
auth.get('/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const error = c.req.query('error')

  if (error) {
    return c.redirect(`${c.env.FRONTEND_URL}/login?error=${error}`)
  }

  if (!code || !state) {
    return c.redirect(`${c.env.FRONTEND_URL}/login?error=missing_params`)
  }

  // Check if this is a link operation
  const isLink = state.startsWith('link:')
  const actualState = isLink ? state.slice(5) : state

  // Verify state
  const stateData = await c.env.SESSION_KV.get(`oauth:${actualState}`)
  if (!stateData) {
    return c.redirect(`${c.env.FRONTEND_URL}/login?error=invalid_state`)
  }
  await c.env.SESSION_KV.delete(`oauth:${actualState}`)

  try {
    // Exchange code for tokens
    const tokens = await exchangeCode(c.env, code)
    const userInfo = await getUserInfo(tokens.access_token)
    const calendars = await getCalendarList(tokens.access_token)

    // Encrypt tokens
    const { accessToken, refreshToken, expiresAt } = await encryptTokens(
      tokens,
      c.env.ENCRYPTION_KEY
    )

    if (isLink) {
      // Link to existing account
      const sessionId = getCookie(c, 'session')
      if (!sessionId) {
        return c.redirect(`${c.env.FRONTEND_URL}/settings?error=not_logged_in`)
      }

      const sessionData = await c.env.SESSION_KV.get(sessionId)
      if (!sessionData) {
        return c.redirect(`${c.env.FRONTEND_URL}/settings?error=session_expired`)
      }

      const session = JSON.parse(sessionData)
      const userId = session.userId

      // Check if already linked
      const existing = await c.env.DB.prepare(
        'SELECT id FROM linked_accounts WHERE user_id = ? AND google_email = ?'
      )
        .bind(userId, userInfo.email)
        .first()

      if (existing) {
        return c.redirect(`${c.env.FRONTEND_URL}/settings?error=already_linked`)
      }

      // Create linked account
      const accountId = crypto.randomUUID()
      await c.env.DB.prepare(
        `INSERT INTO linked_accounts (id, user_id, google_email, access_token, refresh_token, token_expires_at, is_primary)
         VALUES (?, ?, ?, ?, ?, ?, 0)`
      )
        .bind(accountId, userId, userInfo.email, accessToken, refreshToken, expiresAt)
        .run()

      // Add calendars (disabled by default for linked accounts)
      for (const cal of calendars) {
        await c.env.DB.prepare(
          `INSERT INTO selected_calendars (id, linked_account_id, calendar_id, calendar_name, is_enabled)
           VALUES (?, ?, ?, ?, 0)`
        )
          .bind(crypto.randomUUID(), accountId, cal.id, cal.summary)
          .run()
      }

      return c.redirect(`${c.env.FRONTEND_URL}/settings?linked=true`)
    }

    // Regular login/signup
    let user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?')
      .bind(userInfo.email)
      .first<User>()

    if (!user) {
      // Create new user
      const userId = crypto.randomUUID()
      await c.env.DB.prepare(
        'INSERT INTO users (id, email, name) VALUES (?, ?, ?)'
      )
        .bind(userId, userInfo.email, userInfo.name)
        .run()

      user = { id: userId, email: userInfo.email, name: userInfo.name } as User

      // Create linked account (primary)
      const accountId = crypto.randomUUID()
      await c.env.DB.prepare(
        `INSERT INTO linked_accounts (id, user_id, google_email, access_token, refresh_token, token_expires_at, is_primary)
         VALUES (?, ?, ?, ?, ?, ?, 1)`
      )
        .bind(accountId, userId, userInfo.email, accessToken, refreshToken, expiresAt)
        .run()

      // Add calendars
      for (const cal of calendars) {
        await c.env.DB.prepare(
          `INSERT INTO selected_calendars (id, linked_account_id, calendar_id, calendar_name, is_enabled)
           VALUES (?, ?, ?, ?, 1)`
        )
          .bind(crypto.randomUUID(), accountId, cal.id, cal.summary)
          .run()
      }

      // Create default report settings
      await c.env.DB.prepare(
        `INSERT INTO report_settings (id, user_id, is_enabled, send_day, send_hour, timezone)
         VALUES (?, ?, 1, 0, 0, 'Asia/Tokyo')`
      )
        .bind(crypto.randomUUID(), userId)
        .run()
    } else {
      // Update tokens for existing primary account
      await c.env.DB.prepare(
        `UPDATE linked_accounts SET access_token = ?, refresh_token = ?, token_expires_at = ?
         WHERE user_id = ? AND is_primary = 1`
      )
        .bind(accessToken, refreshToken, expiresAt, user.id)
        .run()
    }

    // Create session
    const sessionId = await createSession(c.env.SESSION_KV, user)
    setCookie(c, 'session', sessionId, getSessionCookieOptions(c.env.FRONTEND_URL))

    return c.redirect(`${c.env.FRONTEND_URL}/auth/callback`)
  } catch (err) {
    console.error('OAuth error:', err)
    return c.redirect(`${c.env.FRONTEND_URL}/login?error=auth_failed`)
  }
})

// Start link account flow
auth.get('/link', authMiddleware, async (c) => {
  const state = crypto.randomUUID()
  await c.env.SESSION_KV.put(`oauth:${state}`, 'link', { expirationTtl: 600 })
  const authUrl = getAuthUrl(c.env, state, true)
  return c.redirect(authUrl)
})

// Get current user
auth.get('/me', async (c) => {
  const sessionId = getCookie(c, 'session')

  if (!sessionId) {
    return c.json({ user: null })
  }

  const sessionData = await c.env.SESSION_KV.get(sessionId)
  if (!sessionData) {
    return c.json({ user: null })
  }

  const session = JSON.parse(sessionData)
  const user = await c.env.DB.prepare('SELECT id, email, name FROM users WHERE id = ?')
    .bind(session.userId)
    .first<User>()

  return c.json({ user })
})

// Get linked accounts
auth.get('/accounts', authMiddleware, async (c) => {
  const user = c.get('user')

  const accounts = await c.env.DB.prepare(
    'SELECT id, google_email, is_primary FROM linked_accounts WHERE user_id = ?'
  )
    .bind(user.id)
    .all<{ id: string; google_email: string; is_primary: number }>()

  return c.json({
    accounts: accounts.results.map((a) => ({
      id: a.id,
      googleEmail: a.google_email,
      isPrimary: a.is_primary === 1,
    })),
  })
})

// Unlink account
auth.delete('/link/:id', authMiddleware, async (c) => {
  const user = c.get('user')
  const accountId = c.req.param('id')

  // Check if this is not primary account
  const account = await c.env.DB.prepare(
    'SELECT is_primary FROM linked_accounts WHERE id = ? AND user_id = ?'
  )
    .bind(accountId, user.id)
    .first<{ is_primary: number }>()

  if (!account) {
    return c.json({ error: 'Account not found' }, 404)
  }

  if (account.is_primary === 1) {
    return c.json({ error: 'Cannot unlink primary account' }, 400)
  }

  await c.env.DB.prepare('DELETE FROM linked_accounts WHERE id = ?')
    .bind(accountId)
    .run()

  return c.json({ success: true })
})

// Logout
auth.post('/logout', async (c) => {
  const sessionId = getCookie(c, 'session')

  if (sessionId) {
    await deleteSession(c.env.SESSION_KV, sessionId)
    deleteCookie(c, 'session')
  }

  return c.json({ success: true })
})

export { auth }
