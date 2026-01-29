import { Hono } from 'hono'
import type { Env, User } from '../types'
import { authMiddleware } from '../middleware/auth'
import { getValidAccessToken, getEvents } from '../services/google'
import { categorizeEvents } from '../services/openai'
import { sendEmail, generateReportHtml } from '../services/mailgun'

const report = new Hono<{
  Bindings: Env
  Variables: { user: User }
}>()

report.use('*', authMiddleware)

// Get report data
report.get('/', async (c) => {
  const user = c.get('user')
  const start = c.req.query('start')
  const end = c.req.query('end')

  if (!start || !end) {
    return c.json({ error: 'start and end parameters are required' }, 400)
  }

  const reportData = await generateReportData(c.env, user.id, start, end)
  return c.json(reportData)
})

// Preview report HTML
report.get('/preview', async (c) => {
  const user = c.get('user')

  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 7)

  const reportData = await generateReportData(
    c.env,
    user.id,
    start.toISOString().split('T')[0],
    end.toISOString().split('T')[0]
  )

  const html = generateReportHtml(reportData)
  return c.json({ html })
})

// Send report manually
report.post('/send', async (c) => {
  const user = c.get('user')

  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 7)

  const reportData = await generateReportData(
    c.env,
    user.id,
    start.toISOString().split('T')[0],
    end.toISOString().split('T')[0]
  )

  const html = generateReportHtml(reportData)

  await sendEmail(c.env.MAILGUN_API_KEY, c.env.MAILGUN_DOMAIN, {
    to: user.email,
    subject: `Weekly Time Report (${reportData.period.start} 〜 ${reportData.period.end})`,
    html,
  })

  return c.json({ success: true })
})

interface EventData {
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

async function generateReportData(
  env: Env,
  userId: string,
  start: string,
  end: string
) {
  // Get all enabled calendars with account info
  const calendarsResult = await env.DB.prepare(
    `SELECT sc.calendar_id, sc.calendar_name, la.id as account_id,
            la.access_token, la.refresh_token, la.token_expires_at
     FROM selected_calendars sc
     JOIN linked_accounts la ON sc.linked_account_id = la.id
     WHERE la.user_id = ? AND sc.is_enabled = 1`
  )
    .bind(userId)
    .all<{
      calendar_id: string
      calendar_name: string
      account_id: string
      access_token: string
      refresh_token: string
      token_expires_at: string
    }>()

  // Get categories
  const categoriesResult = await env.DB.prepare(
    'SELECT id, name, color FROM categories WHERE user_id = ? ORDER BY sort_order'
  )
    .bind(userId)
    .all<{ id: string; name: string; color: string }>()

  const categoryMap = new Map(
    categoriesResult.results.map((c) => [c.id, { name: c.name, color: c.color }])
  )

  // Get cached event categories
  const eventCategoriesResult = await env.DB.prepare(
    'SELECT event_id, category_id FROM event_categories WHERE user_id = ?'
  )
    .bind(userId)
    .all<{ event_id: string; category_id: string }>()

  const eventCategoryMap = new Map(
    eventCategoriesResult.results.map((ec) => [ec.event_id, ec.category_id])
  )

  // Fetch all events
  const allEvents: EventData[] = []

  const accountCalendars = new Map<string, typeof calendarsResult.results>()
  for (const cal of calendarsResult.results) {
    const existing = accountCalendars.get(cal.account_id) || []
    existing.push(cal)
    accountCalendars.set(cal.account_id, existing)
  }

  for (const [, cals] of accountCalendars) {
    const account = cals[0]
    try {
      const accessToken = await getValidAccessToken(env, {
        access_token: account.access_token,
        refresh_token: account.refresh_token,
        token_expires_at: account.token_expires_at,
      })

      for (const cal of cals) {
        const googleEvents = await getEvents(accessToken, cal.calendar_id, start, end)

        for (const event of googleEvents) {
          if (!event.start?.dateTime) continue // Skip all-day events

          const attendees = (event.attendees || [])
            .map((a) => a.email)
            .filter((email): email is string => !!email)

          allEvents.push({
            id: event.id,
            title: event.summary || '(No title)',
            start: event.start.dateTime,
            end: event.end?.dateTime || event.start.dateTime,
            attendees,
            calendarName: cal.calendar_name,
          })
        }
      }
    } catch (err) {
      console.error(`Failed to fetch events:`, err)
    }
  }

  // Categorize uncategorized events
  const uncategorizedEvents = allEvents.filter((e) => !eventCategoryMap.has(e.id))

  if (uncategorizedEvents.length > 0 && categoriesResult.results.length > 0) {
    try {
      const aiResults = await categorizeEvents(
        env.OPENAI_API_KEY,
        uncategorizedEvents.map((e) => ({
          id: e.id,
          title: e.title,
          attendeeCount: e.attendees.length || 1,
          calendarName: e.calendarName,
        })),
        categoriesResult.results,
        []
      )

      for (const result of aiResults) {
        eventCategoryMap.set(result.eventId, result.categoryId)

        await env.DB.prepare(
          `INSERT INTO event_categories (id, user_id, event_id, category_id, is_manual)
           VALUES (?, ?, ?, ?, 0)
           ON CONFLICT(user_id, event_id) DO UPDATE SET category_id = ? WHERE is_manual = 0`
        )
          .bind(crypto.randomUUID(), userId, result.eventId, result.categoryId, result.categoryId)
          .run()
      }
    } catch (err) {
      console.error('Failed to categorize events:', err)
    }
  }

  // Add category info to events
  for (const event of allEvents) {
    const categoryId = eventCategoryMap.get(event.id)
    if (categoryId) {
      event.categoryId = categoryId
      const cat = categoryMap.get(categoryId)
      if (cat) {
        event.categoryName = cat.name
        event.categoryColor = cat.color
      }
    }
  }

  // Calculate statistics
  const categoryMinutes = new Map<string, number>()
  const dailyData = new Map<string, Map<string, number>>()
  const attendeeMinutes = new Map<string, number>()

  for (const event of allEvents) {
    const categoryId = eventCategoryMap.get(event.id)
    const duration = Math.round(
      (new Date(event.end).getTime() - new Date(event.start).getTime()) / 60000
    )
    const date = event.start.split('T')[0]

    if (categoryId) {
      categoryMinutes.set(categoryId, (categoryMinutes.get(categoryId) || 0) + duration)

      if (!dailyData.has(date)) {
        dailyData.set(date, new Map())
      }
      const dayData = dailyData.get(date)!
      dayData.set(categoryId, (dayData.get(categoryId) || 0) + duration)
    }

    // Count time per attendee
    for (const attendee of event.attendees) {
      attendeeMinutes.set(attendee, (attendeeMinutes.get(attendee) || 0) + duration)
    }
  }

  const totalMinutes = Array.from(categoryMinutes.values()).reduce((a, b) => a + b, 0)

  // Sort attendees by time
  const topAttendees = Array.from(attendeeMinutes.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([email, minutes]) => ({
      email,
      name: email.split('@')[0], // Simple name extraction
      minutes,
      percentage: totalMinutes > 0 ? (minutes / totalMinutes) * 100 : 0,
    }))

  // Sort events by start time
  allEvents.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())

  return {
    period: { start, end },
    totalMinutes,
    eventCount: allEvents.length,
    categories: categoriesResult.results.map((cat) => {
      const minutes = categoryMinutes.get(cat.id) || 0
      return {
        id: cat.id,
        name: cat.name,
        color: cat.color,
        minutes,
        percentage: totalMinutes > 0 ? (minutes / totalMinutes) * 100 : 0,
      }
    }),
    dailyData: Array.from(dailyData.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, cats]) => ({
        date,
        categories: Object.fromEntries(cats),
      })),
    events: allEvents.map((e) => ({
      id: e.id,
      title: e.title,
      start: e.start,
      end: e.end,
      attendees: e.attendees,
      calendarName: e.calendarName,
      categoryId: e.categoryId,
      categoryName: e.categoryName,
      categoryColor: e.categoryColor,
    })),
    topAttendees,
  }
}

export { report, generateReportData }
