export interface Env {
  DB: D1Database
  SESSION_KV: KVNamespace
  FRONTEND_URL: string
  API_URL: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  OPENAI_API_KEY: string
  MAILGUN_API_KEY: string
  MAILGUN_DOMAIN: string
  ENCRYPTION_KEY: string
}

export interface User {
  id: string
  email: string
  name: string
  created_at: string
  updated_at: string
}

export interface LinkedAccount {
  id: string
  user_id: string
  google_email: string
  access_token: string
  refresh_token: string
  token_expires_at: string
  is_primary: number
  created_at: string
}

export interface SelectedCalendar {
  id: string
  linked_account_id: string
  calendar_id: string
  calendar_name: string
  is_enabled: number
  created_at: string
}

export interface Category {
  id: string
  user_id: string
  name: string
  color: string
  sort_order: number
  is_system: number
  created_at: string
}

export interface CategoryRule {
  id: string
  category_id: string
  rule_type: string
  rule_value: string
  created_at: string
}

export interface EventCategory {
  id: string
  user_id: string
  event_id: string
  category_id: string
  is_manual: number
  created_at: string
}

export interface ReportSettings {
  id: string
  user_id: string
  is_enabled: number
  send_day: number
  send_hour: number
  timezone: string
  created_at: string
}

export interface Session {
  userId: string
  email: string
  name: string
  expiresAt: number
}

export interface GoogleTokens {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
}

export interface GoogleUserInfo {
  id: string
  email: string
  name: string
  picture?: string
}

export interface GoogleCalendar {
  id: string
  summary: string
  primary?: boolean
}

export interface GoogleEvent {
  id: string
  summary?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  attendees?: { email: string; responseStatus?: string }[]
}
