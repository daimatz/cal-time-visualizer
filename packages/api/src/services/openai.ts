import OpenAI from 'openai'

interface EventSummary {
  id: string
  title: string
  attendeeCount: number
  calendarName: string
}

interface CategorySuggestion {
  name: string
  description: string
  color: string
}

interface CategorizeResult {
  eventId: string
  categoryId: string
}

const COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
  '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e',
]

export async function generateCategories(
  apiKey: string,
  events: EventSummary[]
): Promise<CategorySuggestion[]> {
  const openai = new OpenAI({ apiKey })

  const prompt = `あなたはカレンダーイベントを分析するアシスタントです。
以下のイベント一覧を分析し、時間の使い方を把握するのに適したカテゴリを5-10個提案してください。

## イベント一覧 (サンプル)
${events.slice(0, 50).map(e => `- ${e.title} (参加者: ${e.attendeeCount}名, カレンダー: ${e.calendarName})`).join('\n')}

## 出力形式 (JSON)
必ず以下の形式で出力してください:
{
  "categories": [
    { "name": "カテゴリ名", "description": "どういうイベントが該当するか" },
    ...
  ]
}

一般的なカテゴリの例: 1on1, チームMTG, 外部MTG, 作業時間, 移動, プライベート など
イベント内容に応じて適切なカテゴリを提案してください。`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.7,
  })

  const content = response.choices[0]?.message?.content
  if (!content) {
    throw new Error('No response from OpenAI')
  }

  const parsed = JSON.parse(content) as { categories: { name: string; description: string }[] }

  return parsed.categories.map((cat, index) => ({
    name: cat.name,
    description: cat.description,
    color: COLORS[index % COLORS.length],
  }))
}

export async function categorizeEvents(
  apiKey: string,
  events: EventSummary[],
  categories: { id: string; name: string }[],
  rules: { categoryId: string; description: string }[]
): Promise<CategorizeResult[]> {
  if (events.length === 0) return []

  const openai = new OpenAI({ apiKey })

  const prompt = `以下のイベントを指定されたカテゴリに振り分けてください。

## カテゴリ一覧
${categories.map(c => `- ${c.id}: ${c.name}`).join('\n')}

${rules.length > 0 ? `## 振り分けルール (優先適用)
${rules.map(r => `- ${r.description} → カテゴリID: ${r.categoryId}`).join('\n')}` : ''}

## イベント一覧
${events.map(e => `- ${e.id}: "${e.title}" (参加者: ${e.attendeeCount}名)`).join('\n')}

## 出力形式 (JSON)
{
  "results": [
    { "eventId": "イベントID", "categoryId": "カテゴリID" },
    ...
  ]
}

全てのイベントに対して結果を出力してください。`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  })

  const content = response.choices[0]?.message?.content
  if (!content) {
    throw new Error('No response from OpenAI')
  }

  const parsed = JSON.parse(content) as { results: CategorizeResult[] }
  return parsed.results
}
