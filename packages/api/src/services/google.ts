import type { Env, GoogleTokens, GoogleUserInfo, GoogleCalendar, GoogleEvent } from '../types'
import { encrypt, decrypt } from './crypto'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ')

export function getAuthUrl(env: Env, state: string, isLink = false): string {
  const redirectUri = `${env.API_URL}/api/auth/callback`
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state: isLink ? `link:${state}` : state,
  })
  return `${GOOGLE_AUTH_URL}?${params}`
}

export async function exchangeCode(
  env: Env,
  code: string
): Promise<GoogleTokens> {
  const redirectUri = `${env.API_URL}/api/auth/callback`
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to exchange code: ${error}`)
  }

  return response.json()
}

export async function refreshAccessToken(
  env: Env,
  refreshToken: string
): Promise<GoogleTokens> {
  const decryptedRefreshToken = await decrypt(refreshToken, env.ENCRYPTION_KEY)

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: decryptedRefreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    throw new Error('Failed to refresh token')
  }

  return response.json()
}

export async function getUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new Error('Failed to get user info')
  }

  return response.json()
}

export async function getCalendarList(
  accessToken: string
): Promise<GoogleCalendar[]> {
  const response = await fetch(`${GOOGLE_CALENDAR_API}/users/me/calendarList`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('Calendar API error:', response.status, errorText)
    throw new Error(`Failed to get calendar list: ${response.status} ${errorText}`)
  }

  const data = await response.json() as { items: GoogleCalendar[] }
  return data.items || []
}

export async function getEvents(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string
): Promise<GoogleEvent[]> {
  const params = new URLSearchParams({
    timeMin: new Date(timeMin).toISOString(),
    timeMax: new Date(timeMax).toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  })

  const response = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  if (!response.ok) {
    throw new Error(`Failed to get events: ${response.statusText}`)
  }

  const data = await response.json() as { items: GoogleEvent[] }
  return data.items || []
}

export async function encryptTokens(
  tokens: GoogleTokens,
  encryptionKey: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: string }> {
  const accessToken = await encrypt(tokens.access_token, encryptionKey)
  const refreshToken = tokens.refresh_token
    ? await encrypt(tokens.refresh_token, encryptionKey)
    : ''
  const expiresAt = new Date(
    Date.now() + tokens.expires_in * 1000
  ).toISOString()

  return { accessToken, refreshToken, expiresAt }
}

export async function getValidAccessToken(
  env: Env,
  account: { access_token: string; refresh_token: string; token_expires_at: string }
): Promise<string> {
  const expiresAt = new Date(account.token_expires_at)
  const now = new Date()

  // If token expires in less than 5 minutes, refresh it
  if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
    const newTokens = await refreshAccessToken(env, account.refresh_token)
    const { accessToken, expiresAt: newExpiresAt } = await encryptTokens(
      newTokens,
      env.ENCRYPTION_KEY
    )

    // Update tokens in database
    await env.DB.prepare(
      'UPDATE linked_accounts SET access_token = ?, token_expires_at = ? WHERE refresh_token = ?'
    )
      .bind(accessToken, newExpiresAt, account.refresh_token)
      .run()

    return newTokens.access_token
  }

  return decrypt(account.access_token, env.ENCRYPTION_KEY)
}
