import { Hono } from 'hono'
import type { Env, User, LinkedAccount, SelectedCalendar, Category, EventCategory } from '../types'
import { authMiddleware } from '../middleware/auth'
import { getValidAccessToken, getEvents } from '../services/google'

const events = new Hono<{
  Bindings: Env
  Variables: { user: User }
}>()

events.use('*', authMiddleware)

// Get events for a date range
events.get('/', async (c) => {
  const user = c.get('user')
  const start = c.req.query('start')
  const end = c.req.query('end')

  if (!start || !end) {
    return c.json({ error: 'start and end parameters are required' }, 400)
  }

  // Get all enabled calendars with account info
  const calendarsResult = await c.env.DB.prepare(
    `SELECT sc.calendar_id, sc.calendar_name, la.id as account_id,
            la.access_token, la.refresh_token, la.token_expires_at
     FROM selected_calendars sc
     JOIN linked_accounts la ON sc.linked_account_id = la.id
     WHERE la.user_id = ? AND sc.is_enabled = 1`
  )
    .bind(user.id)
    .all<{
      calendar_id: string
      calendar_name: string
      account_id: string
      access_token: string
      refresh_token: string
      token_expires_at: string
    }>()

  // Get categories
  const categoriesResult = await c.env.DB.prepare(
    'SELECT id, name, color FROM categories WHERE user_id = ?'
  )
    .bind(user.id)
    .all<{ id: string; name: string; color: string }>()

  const categoryMap = new Map(
    categoriesResult.results.map((c) => [c.id, { name: c.name, color: c.color }])
  )

  // Get cached event categories
  const eventCategoriesResult = await c.env.DB.prepare(
    'SELECT event_id, category_id FROM event_categories WHERE user_id = ?'
  )
    .bind(user.id)
    .all<{ event_id: string; category_id: string }>()

  const eventCategoryMap = new Map(
    eventCategoriesResult.results.map((ec) => [ec.event_id, ec.category_id])
  )

  // Group calendars by account
  const accountCalendars = new Map<string, typeof calendarsResult.results>()
  for (const cal of calendarsResult.results) {
    const existing = accountCalendars.get(cal.account_id) || []
    existing.push(cal)
    accountCalendars.set(cal.account_id, existing)
  }

  // Fetch events from each account
  const allEvents: {
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
  }[] = []

  for (const [accountId, cals] of accountCalendars) {
    const account = cals[0] // All have same account info
    try {
      const accessToken = await getValidAccessToken(c.env, {
        access_token: account.access_token,
        refresh_token: account.refresh_token,
        token_expires_at: account.token_expires_at,
      })

      for (const cal of cals) {
        const googleEvents = await getEvents(
          accessToken,
          cal.calendar_id,
          start,
          end
        )

        for (const event of googleEvents) {
          if (!event.start?.dateTime && !event.start?.date) continue

          const eventStart = event.start.dateTime || event.start.date || ''
          const eventEnd = event.end?.dateTime || event.end?.date || ''
          const categoryId = eventCategoryMap.get(event.id)
          const category = categoryId ? categoryMap.get(categoryId) : undefined

          allEvents.push({
            id: event.id,
            title: event.summary || '(No title)',
            start: eventStart,
            end: eventEnd,
            calendarId: cal.calendar_id,
            calendarName: cal.calendar_name,
            attendeeCount: event.attendees?.length || 1,
            categoryId,
            categoryName: category?.name,
            categoryColor: category?.color,
          })
        }
      }
    } catch (err) {
      console.error(`Failed to fetch events for account ${accountId}:`, err)
    }
  }

  // Sort by start time
  allEvents.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())

  return c.json({ events: allEvents })
})

// Set event category manually
events.put('/:eventId/category', async (c) => {
  const user = c.get('user')
  const eventId = c.req.param('eventId')
  const { categoryId } = await c.req.json<{ categoryId: string }>()

  // Verify category belongs to user
  const category = await c.env.DB.prepare(
    'SELECT id FROM categories WHERE id = ? AND user_id = ?'
  )
    .bind(categoryId, user.id)
    .first()

  if (!category) {
    return c.json({ error: 'Category not found' }, 404)
  }

  // Upsert event category
  await c.env.DB.prepare(
    `INSERT INTO event_categories (id, user_id, event_id, category_id, is_manual)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(user_id, event_id) DO UPDATE SET category_id = ?, is_manual = 1`
  )
    .bind(crypto.randomUUID(), user.id, eventId, categoryId, categoryId)
    .run()

  return c.json({ success: true })
})

export { events }
