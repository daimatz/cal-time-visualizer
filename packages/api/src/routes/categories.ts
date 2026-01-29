import { Hono } from 'hono'
import type { Env, User, Category } from '../types'
import { authMiddleware } from '../middleware/auth'
import { getValidAccessToken, getEvents } from '../services/google'
import { generateCategories, categorizeEvents } from '../services/openai'

const categories = new Hono<{
  Bindings: Env
  Variables: { user: User }
}>()

categories.use('*', authMiddleware)

// Get all categories
categories.get('/', async (c) => {
  const user = c.get('user')

  const result = await c.env.DB.prepare(
    'SELECT id, name, color, sort_order, is_system FROM categories WHERE user_id = ? ORDER BY sort_order'
  )
    .bind(user.id)
    .all<Category>()

  return c.json({
    categories: result.results.map((cat) => ({
      id: cat.id,
      name: cat.name,
      color: cat.color,
      sortOrder: cat.sort_order,
      isSystem: cat.is_system === 1,
    })),
  })
})

// Create category
categories.post('/', async (c) => {
  const user = c.get('user')
  const { name, color } = await c.req.json<{ name: string; color: string }>()

  // Get max sort order
  const maxOrder = await c.env.DB.prepare(
    'SELECT MAX(sort_order) as max_order FROM categories WHERE user_id = ?'
  )
    .bind(user.id)
    .first<{ max_order: number | null }>()

  const sortOrder = (maxOrder?.max_order || 0) + 1
  const id = crypto.randomUUID()

  await c.env.DB.prepare(
    'INSERT INTO categories (id, user_id, name, color, sort_order, is_system) VALUES (?, ?, ?, ?, ?, 0)'
  )
    .bind(id, user.id, name, color, sortOrder)
    .run()

  return c.json({
    category: { id, name, color, sortOrder, isSystem: false },
  })
})

// Update category
categories.put('/:id', async (c) => {
  const user = c.get('user')
  const categoryId = c.req.param('id')
  const { name, color } = await c.req.json<{ name?: string; color?: string }>()

  // Verify ownership
  const category = await c.env.DB.prepare(
    'SELECT id FROM categories WHERE id = ? AND user_id = ?'
  )
    .bind(categoryId, user.id)
    .first()

  if (!category) {
    return c.json({ error: 'Category not found' }, 404)
  }

  const updates: string[] = []
  const values: string[] = []

  if (name) {
    updates.push('name = ?')
    values.push(name)
  }
  if (color) {
    updates.push('color = ?')
    values.push(color)
  }

  if (updates.length > 0) {
    await c.env.DB.prepare(
      `UPDATE categories SET ${updates.join(', ')} WHERE id = ?`
    )
      .bind(...values, categoryId)
      .run()
  }

  return c.json({ success: true })
})

// Delete category
categories.delete('/:id', async (c) => {
  const user = c.get('user')
  const categoryId = c.req.param('id')

  // Verify ownership
  const category = await c.env.DB.prepare(
    'SELECT id FROM categories WHERE id = ? AND user_id = ?'
  )
    .bind(categoryId, user.id)
    .first()

  if (!category) {
    return c.json({ error: 'Category not found' }, 404)
  }

  await c.env.DB.prepare('DELETE FROM categories WHERE id = ?')
    .bind(categoryId)
    .run()

  return c.json({ success: true })
})

// Get rules for a category
categories.get('/:id/rules', async (c) => {
  const user = c.get('user')
  const categoryId = c.req.param('id')

  // Verify ownership
  const category = await c.env.DB.prepare(
    'SELECT id FROM categories WHERE id = ? AND user_id = ?'
  )
    .bind(categoryId, user.id)
    .first()

  if (!category) {
    return c.json({ error: 'Category not found' }, 404)
  }

  const rules = await c.env.DB.prepare(
    'SELECT id, rule_type, rule_value FROM category_rules WHERE category_id = ?'
  )
    .bind(categoryId)
    .all<{ id: string; rule_type: string; rule_value: string }>()

  return c.json({
    rules: rules.results.map((r) => ({
      id: r.id,
      ruleType: r.rule_type,
      ruleValue: r.rule_value,
    })),
  })
})

// Add rule to a category
categories.post('/:id/rules', async (c) => {
  const user = c.get('user')
  const categoryId = c.req.param('id')
  const { ruleType, ruleValue } = await c.req.json<{
    ruleType: 'keyword' | 'exact' | 'prefix'
    ruleValue: string
  }>()

  if (!ruleType || !ruleValue) {
    return c.json({ error: 'ruleType and ruleValue are required' }, 400)
  }

  // Verify ownership
  const category = await c.env.DB.prepare(
    'SELECT id FROM categories WHERE id = ? AND user_id = ?'
  )
    .bind(categoryId, user.id)
    .first()

  if (!category) {
    return c.json({ error: 'Category not found' }, 404)
  }

  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    'INSERT INTO category_rules (id, category_id, rule_type, rule_value) VALUES (?, ?, ?, ?)'
  )
    .bind(id, categoryId, ruleType, ruleValue)
    .run()

  return c.json({
    rule: { id, ruleType, ruleValue },
  })
})

// Delete a rule
categories.delete('/:categoryId/rules/:ruleId', async (c) => {
  const user = c.get('user')
  const categoryId = c.req.param('categoryId')
  const ruleId = c.req.param('ruleId')

  // Verify ownership
  const category = await c.env.DB.prepare(
    'SELECT id FROM categories WHERE id = ? AND user_id = ?'
  )
    .bind(categoryId, user.id)
    .first()

  if (!category) {
    return c.json({ error: 'Category not found' }, 404)
  }

  await c.env.DB.prepare('DELETE FROM category_rules WHERE id = ? AND category_id = ?')
    .bind(ruleId, categoryId)
    .run()

  return c.json({ success: true })
})

// Generate categories using AI
categories.post('/generate', async (c) => {
  const user = c.get('user')

  // Get events from past month
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 30)

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

  // Collect events
  const eventSummaries: {
    id: string
    title: string
    attendeeCount: number
    calendarName: string
  }[] = []

  const accountCalendars = new Map<string, typeof calendarsResult.results>()
  for (const cal of calendarsResult.results) {
    const existing = accountCalendars.get(cal.account_id) || []
    existing.push(cal)
    accountCalendars.set(cal.account_id, existing)
  }

  for (const [accountId, cals] of accountCalendars) {
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
          eventSummaries.push({
            id: event.id,
            title: event.summary || '(No title)',
            attendeeCount: event.attendees?.length || 1,
            calendarName: cal.calendar_name,
          })
        }
      }
    } catch (err) {
      console.error(`Failed to fetch events for account ${accountId}:`, err)
    }
  }

  if (eventSummaries.length === 0) {
    return c.json({ error: 'No events found' }, 400)
  }

  // Generate categories using OpenAI
  const suggestions = await generateCategories(c.env.OPENAI_API_KEY, eventSummaries)

  // Delete existing system categories
  await c.env.DB.prepare('DELETE FROM categories WHERE user_id = ? AND is_system = 1')
    .bind(user.id)
    .run()

  // Insert new categories
  const newCategories: { id: string; name: string; color: string; sortOrder: number; isSystem: boolean }[] = []

  for (let i = 0; i < suggestions.length; i++) {
    const suggestion = suggestions[i]
    const id = crypto.randomUUID()

    await c.env.DB.prepare(
      'INSERT INTO categories (id, user_id, name, color, sort_order, is_system) VALUES (?, ?, ?, ?, ?, 1)'
    )
      .bind(id, user.id, suggestion.name, suggestion.color, i)
      .run()

    newCategories.push({
      id,
      name: suggestion.name,
      color: suggestion.color,
      sortOrder: i,
      isSystem: true,
    })
  }

  return c.json({ categories: newCategories })
})

export { categories }
