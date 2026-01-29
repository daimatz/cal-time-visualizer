import type { D1Database } from '@cloudflare/workers-types'

interface EventToMatch {
  id: string
  title: string
  attendeeCount: number
  calendarName: string
}

interface CategoryRule {
  categoryId: string
  ruleType: 'keyword' | 'exact' | 'prefix'
  ruleValue: string
}

interface MatchResult {
  eventId: string
  categoryId: string
  matchType: 'keyword' | 'similar' | 'ai'
}

/**
 * Apply keyword rules to match events to categories
 */
export function applyKeywordRules(
  events: EventToMatch[],
  rules: CategoryRule[]
): Map<string, string> {
  const matches = new Map<string, string>()

  for (const event of events) {
    const titleLower = event.title.toLowerCase()

    for (const rule of rules) {
      const valueLower = rule.ruleValue.toLowerCase()
      let matched = false

      switch (rule.ruleType) {
        case 'keyword':
          matched = titleLower.includes(valueLower)
          break
        case 'exact':
          matched = titleLower === valueLower
          break
        case 'prefix':
          matched = titleLower.startsWith(valueLower)
          break
      }

      if (matched) {
        matches.set(event.id, rule.categoryId)
        break // First matching rule wins
      }
    }
  }

  return matches
}

/**
 * Find events with the same title that have already been categorized
 */
export async function findSimilarEventCategories(
  db: D1Database,
  userId: string,
  events: EventToMatch[]
): Promise<Map<string, string>> {
  const matches = new Map<string, string>()

  if (events.length === 0) return matches

  // Get unique titles
  const uniqueTitles = [...new Set(events.map((e) => e.title))]

  // Query for existing categorizations with the same titles
  // We look for events where the title matches and has been categorized
  const placeholders = uniqueTitles.map(() => '?').join(',')

  const result = await db
    .prepare(
      `SELECT DISTINCT ec.category_id, e_title.title
       FROM event_categories ec
       JOIN (
         SELECT event_id, ? as user_id, title
         FROM (VALUES ${uniqueTitles.map((t, i) => `('event_${i}', '${t.replace(/'/g, "''")}')`).join(',')}) AS t(event_id, title)
       ) e_title ON 1=1
       WHERE ec.user_id = ?
       AND EXISTS (
         SELECT 1 FROM event_categories ec2
         WHERE ec2.user_id = ec.user_id
         AND ec2.category_id = ec.category_id
       )`
    )
    .bind(userId, userId)
    .all()

  // This approach won't work well with D1. Let's use a different strategy.
  // We'll fetch all past categorized events and match by normalized title.

  // Alternative: Get all event_categories for this user and maintain a title->category cache
  // For now, let's use a simpler approach - store title hash in event_categories

  return matches
}

/**
 * Enhanced: Find similar events by looking at past categorized event titles
 * This is a title-based cache lookup
 */
export async function matchEventsByTitle(
  db: D1Database,
  userId: string,
  events: EventToMatch[],
  titleToCategoryCache: Map<string, string>
): Promise<Map<string, string>> {
  const matches = new Map<string, string>()

  for (const event of events) {
    const normalizedTitle = normalizeTitle(event.title)
    const cachedCategoryId = titleToCategoryCache.get(normalizedTitle)

    if (cachedCategoryId) {
      matches.set(event.id, cachedCategoryId)
    }
  }

  return matches
}

/**
 * Normalize event title for matching
 * - Lowercase
 * - Trim whitespace
 * - Remove date/time patterns that might make similar events look different
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    // Remove common date patterns like "2024/01/15" or "01/15"
    .replace(/\d{2,4}[\/\-]\d{1,2}[\/\-]\d{1,2}/g, '')
    // Remove time patterns like "10:00" or "10:00-11:00"
    .replace(/\d{1,2}:\d{2}(?:\s*[-~]\s*\d{1,2}:\d{2})?/g, '')
    // Remove week numbers like "Week 5" or "第5週"
    .replace(/week\s*\d+/gi, '')
    .replace(/第\d+週/g, '')
    // Remove parenthesized numbers like "(5)" often used for recurring events
    .replace(/\(\d+\)/g, '')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Build a title->category cache from existing event_categories
 * Also stores normalized titles for matching
 */
export async function buildTitleCategoryCache(
  db: D1Database,
  userId: string
): Promise<Map<string, string>> {
  const cache = new Map<string, string>()

  // We need to store titles with event_categories, or use a separate cache table
  // For now, let's query the title cache table if it exists

  const result = await db
    .prepare(
      `SELECT normalized_title, category_id FROM event_title_cache
       WHERE user_id = ? ORDER BY created_at DESC`
    )
    .bind(userId)
    .all<{ normalized_title: string; category_id: string }>()
    .catch(() => ({ results: [] })) // Table might not exist yet

  for (const row of result.results) {
    if (!cache.has(row.normalized_title)) {
      cache.set(row.normalized_title, row.category_id)
    }
  }

  return cache
}

/**
 * Save title->category mapping to cache for future lookups
 */
export async function cacheTitleCategory(
  db: D1Database,
  userId: string,
  title: string,
  categoryId: string
): Promise<void> {
  const normalizedTitle = normalizeTitle(title)

  await db
    .prepare(
      `INSERT INTO event_title_cache (id, user_id, normalized_title, category_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, normalized_title) DO UPDATE SET category_id = ?`
    )
    .bind(crypto.randomUUID(), userId, normalizedTitle, categoryId, categoryId)
    .run()
    .catch(() => {
      // Table might not exist, silently fail
    })
}

/**
 * Main function to categorize events with rule matching and caching
 */
export interface CategorizationInput {
  events: EventToMatch[]
  userId: string
  db: D1Database
}

export interface PreCategorizationResult {
  keywordMatched: Map<string, string>
  similarMatched: Map<string, string>
  needsAI: EventToMatch[]
}

export async function preCategorizeEvents(
  db: D1Database,
  userId: string,
  events: EventToMatch[]
): Promise<PreCategorizationResult> {
  // 1. Get keyword rules
  const rulesResult = await db
    .prepare(
      `SELECT cr.category_id, cr.rule_type, cr.rule_value
       FROM category_rules cr
       JOIN categories c ON cr.category_id = c.id
       WHERE c.user_id = ?`
    )
    .bind(userId)
    .all<{ category_id: string; rule_type: string; rule_value: string }>()

  const rules: CategoryRule[] = rulesResult.results.map((r) => ({
    categoryId: r.category_id,
    ruleType: r.rule_type as CategoryRule['ruleType'],
    ruleValue: r.rule_value,
  }))

  // 2. Apply keyword rules
  const keywordMatched = applyKeywordRules(events, rules)

  // 3. Get remaining events that weren't matched by keywords
  const afterKeyword = events.filter((e) => !keywordMatched.has(e.id))

  // 4. Load title->category cache and match similar events
  const titleCache = await buildTitleCategoryCache(db, userId)
  const similarMatched = await matchEventsByTitle(db, userId, afterKeyword, titleCache)

  // 5. Events that still need AI categorization
  const needsAI = afterKeyword.filter((e) => !similarMatched.has(e.id))

  return {
    keywordMatched,
    similarMatched,
    needsAI,
  }
}
