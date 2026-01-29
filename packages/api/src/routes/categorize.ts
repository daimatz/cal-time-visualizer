import { Hono } from 'hono'
import type { Env, User } from '../types'
import { authMiddleware } from '../middleware/auth'
import { getValidAccessToken, getEvents } from '../services/google'
import { categorizeEvents } from '../services/openai'
import {
  preCategorizeEvents,
  cacheTitleCategory,
  normalizeTitle,
} from '../services/categorization'

const categorize = new Hono<{
  Bindings: Env
  Variables: { user: User }
}>()

categorize.use('*', authMiddleware)

// Categorize events using AI
categorize.post('/', async (c) => {
  const user = c.get('user')
  const { eventIds } = await c.req.json<{ eventIds: string[] }>()

  if (!eventIds || eventIds.length === 0) {
    return c.json({ results: [] })
  }

  // Get categories
  const categoriesResult = await c.env.DB.prepare(
    'SELECT id, name FROM categories WHERE user_id = ? ORDER BY sort_order'
  )
    .bind(user.id)
    .all<{ id: string; name: string }>()

  if (categoriesResult.results.length === 0) {
    return c.json({ error: 'No categories defined' }, 400)
  }

  // Get events that need categorization (excluding manual ones)
  const manualResult = await c.env.DB.prepare(
    `SELECT event_id, category_id FROM event_categories
     WHERE user_id = ? AND event_id IN (${eventIds.map(() => '?').join(',')}) AND is_manual = 1`
  )
    .bind(user.id, ...eventIds)
    .all<{ event_id: string; category_id: string }>()

  const manualMap = new Map(manualResult.results.map((m) => [m.event_id, m.category_id]))
  const eventsToCategorizIds = eventIds.filter((id) => !manualMap.has(id))

  // Get event details from calendars
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

  // We need to match event IDs to their details
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 30)

  const eventMap = new Map<
    string,
    { id: string; title: string; attendeeCount: number; calendarName: string }
  >()

  const accountCalendars = new Map<string, typeof calendarsResult.results>()
  for (const cal of calendarsResult.results) {
    const existing = accountCalendars.get(cal.account_id) || []
    existing.push(cal)
    accountCalendars.set(cal.account_id, existing)
  }

  for (const [, cals] of accountCalendars) {
    const account = cals[0]
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
          start.toISOString(),
          end.toISOString()
        )

        for (const event of googleEvents) {
          if (eventsToCategorizIds.includes(event.id)) {
            eventMap.set(event.id, {
              id: event.id,
              title: event.summary || '(No title)',
              attendeeCount: event.attendees?.length || 1,
              calendarName: cal.calendar_name,
            })
          }
        }
      }
    } catch (err) {
      console.error(`Failed to fetch events:`, err)
    }
  }

  const eventsToCategorizData = eventsToCategorizIds
    .map((id) => eventMap.get(id))
    .filter((e): e is NonNullable<typeof e> => e !== undefined)

  if (eventsToCategorizData.length === 0) {
    // Return manual categorizations only
    return c.json({
      results: Array.from(manualMap.entries()).map(([eventId, categoryId]) => ({
        eventId,
        categoryId,
      })),
    })
  }

  // Pre-categorize: Apply keyword rules and similar event matching
  const preResult = await preCategorizeEvents(c.env.DB, user.id, eventsToCategorizData)

  const allResults: { eventId: string; categoryId: string }[] = []

  // Store keyword-matched results
  for (const [eventId, categoryId] of preResult.keywordMatched) {
    await c.env.DB.prepare(
      `INSERT INTO event_categories (id, user_id, event_id, category_id, is_manual)
       VALUES (?, ?, ?, ?, 0)
       ON CONFLICT(user_id, event_id) DO UPDATE SET category_id = ? WHERE is_manual = 0`
    )
      .bind(crypto.randomUUID(), user.id, eventId, categoryId, categoryId)
      .run()

    // Cache title for future lookups
    const event = eventMap.get(eventId)
    if (event) {
      await cacheTitleCategory(c.env.DB, user.id, event.title, categoryId)
    }

    allResults.push({ eventId, categoryId })
  }

  // Store similar-matched results
  for (const [eventId, categoryId] of preResult.similarMatched) {
    await c.env.DB.prepare(
      `INSERT INTO event_categories (id, user_id, event_id, category_id, is_manual)
       VALUES (?, ?, ?, ?, 0)
       ON CONFLICT(user_id, event_id) DO UPDATE SET category_id = ? WHERE is_manual = 0`
    )
      .bind(crypto.randomUUID(), user.id, eventId, categoryId, categoryId)
      .run()

    allResults.push({ eventId, categoryId })
  }

  // Categorize remaining events using OpenAI
  if (preResult.needsAI.length > 0) {
    // Get category rules for AI context
    const rulesResult = await c.env.DB.prepare(
      `SELECT cr.category_id, cr.rule_type, cr.rule_value, c.name as category_name
       FROM category_rules cr
       JOIN categories c ON cr.category_id = c.id
       WHERE c.user_id = ?`
    )
      .bind(user.id)
      .all<{ category_id: string; rule_type: string; rule_value: string; category_name: string }>()

    const rules = rulesResult.results.map((r) => ({
      categoryId: r.category_id,
      description: `${r.rule_type}: ${r.rule_value} → ${r.category_name}`,
    }))

    const aiResults = await categorizeEvents(
      c.env.OPENAI_API_KEY,
      preResult.needsAI.map((e) => ({
        id: e.id,
        title: e.title,
        attendeeCount: e.attendeeCount,
        calendarName: e.calendarName,
      })),
      categoriesResult.results,
      rules
    )

    // Store AI results and cache titles
    for (const result of aiResults) {
      await c.env.DB.prepare(
        `INSERT INTO event_categories (id, user_id, event_id, category_id, is_manual)
         VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(user_id, event_id) DO UPDATE SET category_id = ? WHERE is_manual = 0`
      )
        .bind(crypto.randomUUID(), user.id, result.eventId, result.categoryId, result.categoryId)
        .run()

      // Cache title for future lookups
      const event = eventMap.get(result.eventId)
      if (event) {
        await cacheTitleCategory(c.env.DB, user.id, event.title, result.categoryId)
      }

      allResults.push(result)
    }
  }

  // Add manual categorizations
  for (const [eventId, categoryId] of manualMap) {
    allResults.push({ eventId, categoryId })
  }

  return c.json({ results: allResults })
})

export { categorize }
