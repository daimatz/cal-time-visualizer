import { Hono } from 'hono'
import type { Env, User, ReportSettings } from '../types'
import { authMiddleware } from '../middleware/auth'

const settings = new Hono<{
  Bindings: Env
  Variables: { user: User }
}>()

settings.use('*', authMiddleware)

// Get settings
settings.get('/', async (c) => {
  const user = c.get('user')

  const result = await c.env.DB.prepare(
    'SELECT is_enabled, send_day, send_hour, timezone FROM report_settings WHERE user_id = ?'
  )
    .bind(user.id)
    .first<ReportSettings>()

  if (!result) {
    // Return defaults
    return c.json({
      reportEnabled: true,
      reportDay: 0,
      reportHour: 0,
      timezone: 'Asia/Tokyo',
    })
  }

  return c.json({
    reportEnabled: result.is_enabled === 1,
    reportDay: result.send_day,
    reportHour: result.send_hour,
    timezone: result.timezone,
  })
})

// Update settings
settings.put('/', async (c) => {
  const user = c.get('user')
  const { reportEnabled, reportDay, reportHour, timezone } = await c.req.json<{
    reportEnabled?: boolean
    reportDay?: number
    reportHour?: number
    timezone?: string
  }>()

  // Check if settings exist
  const existing = await c.env.DB.prepare(
    'SELECT id FROM report_settings WHERE user_id = ?'
  )
    .bind(user.id)
    .first()

  if (existing) {
    const updates: string[] = []
    const values: (number | string)[] = []

    if (reportEnabled !== undefined) {
      updates.push('is_enabled = ?')
      values.push(reportEnabled ? 1 : 0)
    }
    if (reportDay !== undefined) {
      updates.push('send_day = ?')
      values.push(reportDay)
    }
    if (reportHour !== undefined) {
      updates.push('send_hour = ?')
      values.push(reportHour)
    }
    if (timezone !== undefined) {
      updates.push('timezone = ?')
      values.push(timezone)
    }

    if (updates.length > 0) {
      await c.env.DB.prepare(
        `UPDATE report_settings SET ${updates.join(', ')} WHERE user_id = ?`
      )
        .bind(...values, user.id)
        .run()
    }
  } else {
    await c.env.DB.prepare(
      `INSERT INTO report_settings (id, user_id, is_enabled, send_day, send_hour, timezone)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        user.id,
        reportEnabled !== undefined ? (reportEnabled ? 1 : 0) : 1,
        reportDay ?? 0,
        reportHour ?? 0,
        timezone ?? 'Asia/Tokyo'
      )
      .run()
  }

  return c.json({ success: true })
})

export { settings }
