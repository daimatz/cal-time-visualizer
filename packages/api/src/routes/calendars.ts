import { Hono } from 'hono'
import type { Env, User, LinkedAccount, SelectedCalendar } from '../types'
import { authMiddleware } from '../middleware/auth'

const calendars = new Hono<{
  Bindings: Env
  Variables: { user: User }
}>()

calendars.use('*', authMiddleware)

// Get all calendars
calendars.get('/', async (c) => {
  const user = c.get('user')

  const results = await c.env.DB.prepare(
    `SELECT sc.id, sc.calendar_id, sc.calendar_name, sc.is_enabled, la.google_email
     FROM selected_calendars sc
     JOIN linked_accounts la ON sc.linked_account_id = la.id
     WHERE la.user_id = ?
     ORDER BY la.is_primary DESC, sc.calendar_name`
  )
    .bind(user.id)
    .all<{
      id: string
      calendar_id: string
      calendar_name: string
      is_enabled: number
      google_email: string
    }>()

  return c.json({
    calendars: results.results.map((cal) => ({
      id: cal.id,
      calendarId: cal.calendar_id,
      name: cal.calendar_name,
      isEnabled: cal.is_enabled === 1,
      accountEmail: cal.google_email,
    })),
  })
})

// Toggle calendar enabled/disabled
calendars.put('/:id', async (c) => {
  const user = c.get('user')
  const calendarId = c.req.param('id')
  const { enabled } = await c.req.json<{ enabled: boolean }>()

  // Verify ownership
  const calendar = await c.env.DB.prepare(
    `SELECT sc.id FROM selected_calendars sc
     JOIN linked_accounts la ON sc.linked_account_id = la.id
     WHERE sc.id = ? AND la.user_id = ?`
  )
    .bind(calendarId, user.id)
    .first()

  if (!calendar) {
    return c.json({ error: 'Calendar not found' }, 404)
  }

  await c.env.DB.prepare('UPDATE selected_calendars SET is_enabled = ? WHERE id = ?')
    .bind(enabled ? 1 : 0, calendarId)
    .run()

  return c.json({ success: true })
})

export { calendars }
