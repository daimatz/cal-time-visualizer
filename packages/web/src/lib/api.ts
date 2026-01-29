const API_BASE = import.meta.env.VITE_API_URL || ''

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.message || `HTTP ${response.status}`)
  }

  return response.json()
}

export const api = {
  get: <T>(endpoint: string) => request<T>(endpoint),
  post: <T>(endpoint: string, data?: unknown) =>
    request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }),
  put: <T>(endpoint: string, data?: unknown) =>
    request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    }),
  delete: <T>(endpoint: string) =>
    request<T>(endpoint, { method: 'DELETE' }),
}

// Auth
export const authApi = {
  me: () => api.get<{ user: User | null }>('/api/auth/me'),
  logout: () => api.post<void>('/api/auth/logout'),
  accounts: () => api.get<{ accounts: LinkedAccount[] }>('/api/auth/accounts'),
  unlinkAccount: (id: string) => api.delete<void>(`/api/auth/link/${id}`),
}

// Calendars
export const calendarApi = {
  list: () => api.get<{ calendars: Calendar[] }>('/api/calendars'),
  toggle: (id: string, enabled: boolean) =>
    api.put<void>(`/api/calendars/${id}`, { enabled }),
}

// Events
export const eventApi = {
  list: (params: { start: string; end: string }) =>
    api.get<{ events: CalendarEvent[] }>(
      `/api/events?start=${params.start}&end=${params.end}`
    ),
}

// Categories
export const categoryApi = {
  list: () => api.get<{ categories: Category[] }>('/api/categories'),
  create: (data: { name: string; color: string }) =>
    api.post<{ category: Category }>('/api/categories', data),
  update: (id: string, data: { name?: string; color?: string }) =>
    api.put<void>(`/api/categories/${id}`, data),
  delete: (id: string) => api.delete<void>(`/api/categories/${id}`),
  generate: () =>
    api.post<{ categories: Category[] }>('/api/categories/generate'),
}

// Categorize
export const categorizeApi = {
  categorize: (eventIds: string[]) =>
    api.post<{ results: EventCategory[] }>('/api/categorize', { eventIds }),
  setCategory: (eventId: string, categoryId: string) =>
    api.put<void>(`/api/events/${eventId}/category`, { categoryId }),
}

// Report
export const reportApi = {
  data: (params: { start: string; end: string }) =>
    api.get<ReportData>(`/api/report?start=${params.start}&end=${params.end}`),
  preview: () => api.get<{ html: string }>('/api/report/preview'),
  send: () => api.post<void>('/api/report/send'),
}

// Settings
export const settingsApi = {
  get: () => api.get<Settings>('/api/settings'),
  update: (data: Partial<Settings>) => api.put<void>('/api/settings', data),
}

// Types
export interface User {
  id: string
  email: string
  name: string
}

export interface LinkedAccount {
  id: string
  googleEmail: string
  isPrimary: boolean
}

export interface Calendar {
  id: string
  calendarId: string
  name: string
  isEnabled: boolean
  accountEmail: string
}

export interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string
  calendarId: string
  calendarName: string
  attendeeCount: number
  categoryId?: string
  categoryName?: string
  categoryColor?: string
}

export interface Category {
  id: string
  name: string
  color: string
  sortOrder: number
  isSystem: boolean
}

export interface EventCategory {
  eventId: string
  categoryId: string
}

export interface ReportEvent {
  id: string
  title: string
  start: string
  end: string
  attendees: string[]
  calendarName: string
  categoryId?: string
  categoryName?: string
  categoryColor?: string
}

export interface TopAttendee {
  email: string
  name: string
  minutes: number
  percentage: number
}

export interface ReportData {
  period: { start: string; end: string }
  totalMinutes: number
  eventCount: number
  categories: {
    id: string
    name: string
    color: string
    minutes: number
    percentage: number
  }[]
  dailyData: {
    date: string
    categories: { [categoryId: string]: number }
  }[]
  events: ReportEvent[]
  topAttendees: TopAttendee[]
}

export interface Settings {
  reportEnabled: boolean
  reportDay: number
  reportHour: number
  timezone: string
}
