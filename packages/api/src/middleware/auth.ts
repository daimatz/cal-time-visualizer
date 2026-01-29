import { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import type { Env, Session, User } from '../types'

const SESSION_COOKIE = 'session'
const SESSION_TTL = 7 * 24 * 60 * 60 // 7 days in seconds

export async function authMiddleware(
  c: Context<{ Bindings: Env; Variables: { user: User; session: Session } }>,
  next: Next
) {
  const sessionId = getCookie(c, SESSION_COOKIE)

  if (!sessionId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const sessionData = await c.env.SESSION_KV.get(sessionId)
  if (!sessionData) {
    return c.json({ error: 'Session expired' }, 401)
  }

  const session: Session = JSON.parse(sessionData)

  if (session.expiresAt < Date.now()) {
    await c.env.SESSION_KV.delete(sessionId)
    return c.json({ error: 'Session expired' }, 401)
  }

  // Get user from database
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?')
    .bind(session.userId)
    .first<User>()

  if (!user) {
    return c.json({ error: 'User not found' }, 401)
  }

  c.set('user', user)
  c.set('session', session)

  await next()
}

export async function createSession(
  kv: KVNamespace,
  user: User
): Promise<string> {
  const sessionId = crypto.randomUUID()
  const session: Session = {
    userId: user.id,
    email: user.email,
    name: user.name,
    expiresAt: Date.now() + SESSION_TTL * 1000,
  }

  await kv.put(sessionId, JSON.stringify(session), {
    expirationTtl: SESSION_TTL,
  })

  return sessionId
}

export async function deleteSession(
  kv: KVNamespace,
  sessionId: string
): Promise<void> {
  await kv.delete(sessionId)
}

export function getSessionCookieOptions(frontendUrl: string) {
  const isProduction = !frontendUrl.includes('localhost')
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'Lax' as const,
    path: '/',
    maxAge: SESSION_TTL,
  }
}
