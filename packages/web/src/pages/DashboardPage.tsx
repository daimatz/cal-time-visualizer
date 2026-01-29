import { useState, useEffect, useMemo } from 'react'
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import {
  reportApi,
  categoryApi,
  categorizeApi,
  type ReportData,
  type Category,
  type ReportEvent,
} from '@/lib/api'

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins}分`
  if (mins === 0) return `${hours}時間`
  return `${hours}時間${mins}分`
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr)
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
}

function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function getDateRange(days: number) {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - days)
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  }
}

type TabType = 'overview' | 'events' | 'attendees' | 'categories'

export function DashboardPage() {
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadingStatus, setLoadingStatus] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [period, setPeriod] = useState(7)
  const [activeTab, setActiveTab] = useState<TabType>('overview')
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryColor, setNewCategoryColor] = useState('#6366f1')

  useEffect(() => {
    loadData()
  }, [period])

  async function loadData() {
    setIsLoading(true)
    setLoadingStatus('カテゴリを読み込み中...')
    try {
      const cats = await categoryApi.list()
      setCategories(cats.categories)

      setLoadingStatus('カレンダーデータを取得中...')
      const range = getDateRange(period)
      const report = await reportApi.data(range)
      setReportData(report)
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setIsLoading(false)
      setLoadingStatus('')
    }
  }

  async function handleGenerateCategories() {
    setIsGenerating(true)
    setLoadingStatus('AIがカレンダーを分析中...')
    try {
      const { categories: newCats } = await categoryApi.generate()
      setCategories(newCats)
      setLoadingStatus('レポートを生成中...')
      await loadData()
    } catch (error) {
      console.error('Failed to generate categories:', error)
    } finally {
      setIsGenerating(false)
      setLoadingStatus('')
    }
  }

  async function handleUpdateCategory(id: string, name: string, color: string) {
    try {
      await categoryApi.update(id, { name, color })
      setCategories((prev) =>
        prev.map((c) => (c.id === id ? { ...c, name, color } : c))
      )
      setEditingCategory(null)
      await loadData()
    } catch (error) {
      console.error('Failed to update category:', error)
    }
  }

  async function handleDeleteCategory(id: string) {
    if (!confirm('このカテゴリを削除しますか？')) return
    try {
      await categoryApi.delete(id)
      setCategories((prev) => prev.filter((c) => c.id !== id))
      await loadData()
    } catch (error) {
      console.error('Failed to delete category:', error)
    }
  }

  async function handleCreateCategory() {
    if (!newCategoryName.trim()) return
    try {
      const { category } = await categoryApi.create({
        name: newCategoryName,
        color: newCategoryColor,
      })
      setCategories((prev) => [...prev, category])
      setNewCategoryName('')
      setNewCategoryColor('#6366f1')
    } catch (error) {
      console.error('Failed to create category:', error)
    }
  }

  async function handleChangeEventCategory(eventId: string, categoryId: string) {
    try {
      await categorizeApi.setCategory(eventId, categoryId)
      // Update local state
      if (reportData) {
        const cat = categories.find((c) => c.id === categoryId)
        setReportData({
          ...reportData,
          events: reportData.events.map((e) =>
            e.id === eventId
              ? {
                  ...e,
                  categoryId,
                  categoryName: cat?.name,
                  categoryColor: cat?.color,
                }
              : e
          ),
        })
      }
    } catch (error) {
      console.error('Failed to change category:', error)
    }
  }

  const pieData = useMemo(() => {
    if (!reportData) return []
    return reportData.categories
      .filter((cat) => cat.minutes > 0)
      .map((cat) => ({
        name: cat.name,
        value: cat.minutes,
        color: cat.color,
      }))
  }, [reportData])

  const barData = useMemo(() => {
    if (!reportData) return []
    return reportData.dailyData.map((day) => ({
      date: formatDateShort(day.date),
      ...Object.fromEntries(
        reportData.categories.map((cat) => [
          cat.name,
          (day.categories[cat.id] || 0) / 60,
        ])
      ),
    }))
  }, [reportData])

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <p className="text-muted-foreground">{loadingStatus || '読み込み中...'}</p>
      </div>
    )
  }

  if (categories.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <p className="text-muted-foreground">
          カテゴリが設定されていません。AIでカテゴリを生成しますか？
        </p>
        <Button onClick={handleGenerateCategories} disabled={isGenerating}>
          {isGenerating ? loadingStatus || 'カテゴリ生成中...' : 'AIでカテゴリを生成'}
        </Button>
      </div>
    )
  }

  const tabs: { id: TabType; label: string }[] = [
    { id: 'overview', label: '概要' },
    { id: 'events', label: 'イベント一覧' },
    { id: 'attendees', label: '参加者' },
    { id: 'categories', label: 'カテゴリ編集' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(Number(e.target.value))}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value={7}>過去7日間</option>
            <option value={14}>過去14日間</option>
            <option value={30}>過去30日間</option>
          </select>
          <Button variant="outline" onClick={loadData} disabled={isLoading}>
            {isLoading ? '読み込み中...' : '更新'}
          </Button>
        </div>
      </div>

      {reportData && (
        <div className="text-sm text-muted-foreground">
          {formatDate(reportData.period.start)} 〜 {formatDate(reportData.period.end)}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {reportData && activeTab === 'overview' && (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  予定の総時間
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatMinutes(reportData.totalMinutes)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {reportData.eventCount}件の予定
                </p>
              </CardContent>
            </Card>
            {reportData.categories
              .filter((cat) => cat.minutes > 0)
              .slice(0, 3)
              .map((cat) => (
                <Card key={cat.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: cat.color }}
                      />
                      {cat.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatMinutes(cat.minutes)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {cat.percentage.toFixed(1)}%
                    </p>
                  </CardContent>
                </Card>
              ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>カテゴリ別時間配分</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      dataKey="value"
                      label={({ name, percent }) =>
                        `${name} ${(percent * 100).toFixed(0)}%`
                      }
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => formatMinutes(value)} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>日別推移</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={barData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis unit="h" />
                    <Tooltip formatter={(value: number) => `${value.toFixed(1)}h`} />
                    <Legend />
                    {reportData.categories
                      .filter((cat) => cat.minutes > 0)
                      .map((cat) => (
                        <Bar
                          key={cat.id}
                          dataKey={cat.name}
                          stackId="a"
                          fill={cat.color}
                        />
                      ))}
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>カテゴリ別サマリー</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {reportData.categories
                  .filter((cat) => cat.minutes > 0)
                  .map((cat) => (
                    <div
                      key={cat.id}
                      className="flex items-center justify-between py-2 border-b last:border-0"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="w-4 h-4 rounded-full"
                          style={{ backgroundColor: cat.color }}
                        />
                        <span className="font-medium">{cat.name}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-muted-foreground">
                          {formatMinutes(cat.minutes)}
                        </span>
                        <span className="text-sm text-muted-foreground w-16 text-right">
                          {cat.percentage.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {reportData && activeTab === 'events' && (
        <Card>
          <CardHeader>
            <CardTitle>イベント一覧 ({reportData.events.length}件)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {reportData.events.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  categories={categories}
                  onChangeCategory={handleChangeEventCategory}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {reportData && activeTab === 'attendees' && (
        <Card>
          <CardHeader>
            <CardTitle>よく一緒にいる人 TOP10</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {reportData.topAttendees.map((attendee, index) => (
                <div
                  key={attendee.email}
                  className="flex items-center justify-between py-2 border-b last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-muted-foreground w-6">
                      {index + 1}
                    </span>
                    <div>
                      <div className="font-medium">{attendee.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {attendee.email}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">{formatMinutes(attendee.minutes)}</div>
                    <div className="text-xs text-muted-foreground">
                      {attendee.percentage.toFixed(1)}%
                    </div>
                  </div>
                </div>
              ))}
              {reportData.topAttendees.length === 0 && (
                <p className="text-muted-foreground text-center py-4">
                  参加者データがありません
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'categories' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>カテゴリ管理</span>
                <Button
                  variant="outline"
                  onClick={handleGenerateCategories}
                  disabled={isGenerating}
                >
                  {isGenerating ? 'AI生成中...' : 'AIで再生成'}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {categories.map((cat) => (
                  <div
                    key={cat.id}
                    className="flex items-center justify-between py-2 border-b last:border-0"
                  >
                    {editingCategory?.id === cat.id ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          type="color"
                          value={editingCategory.color}
                          onChange={(e) =>
                            setEditingCategory({
                              ...editingCategory,
                              color: e.target.value,
                            })
                          }
                          className="w-8 h-8 rounded cursor-pointer"
                        />
                        <input
                          type="text"
                          value={editingCategory.name}
                          onChange={(e) =>
                            setEditingCategory({
                              ...editingCategory,
                              name: e.target.value,
                            })
                          }
                          className="flex-1 px-2 py-1 border rounded"
                        />
                        <Button
                          size="sm"
                          onClick={() =>
                            handleUpdateCategory(
                              cat.id,
                              editingCategory.name,
                              editingCategory.color
                            )
                          }
                        >
                          保存
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingCategory(null)}
                        >
                          キャンセル
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-3">
                          <span
                            className="w-4 h-4 rounded-full"
                            style={{ backgroundColor: cat.color }}
                          />
                          <span className="font-medium">{cat.name}</span>
                          {cat.isSystem && (
                            <span className="text-xs text-muted-foreground">
                              (AI生成)
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingCategory(cat)}
                          >
                            編集
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteCategory(cat.id)}
                          >
                            削除
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>カテゴリを追加</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={newCategoryColor}
                  onChange={(e) => setNewCategoryColor(e.target.value)}
                  className="w-10 h-10 rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="カテゴリ名"
                  className="flex-1 px-3 py-2 border rounded"
                />
                <Button onClick={handleCreateCategory} disabled={!newCategoryName.trim()}>
                  追加
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

function EventRow({
  event,
  categories,
  onChangeCategory,
}: {
  event: ReportEvent
  categories: Category[]
  onChangeCategory: (eventId: string, categoryId: string) => void
}) {
  const duration = Math.round(
    (new Date(event.end).getTime() - new Date(event.start).getTime()) / 60000
  )

  return (
    <div className="flex items-center gap-4 py-2 border-b last:border-0">
      <div className="w-24 text-sm text-muted-foreground">
        {formatDateTime(event.start)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{event.title}</div>
        {event.attendees.length > 0 && (
          <div className="text-xs text-muted-foreground truncate">
            {event.attendees.slice(0, 3).join(', ')}
            {event.attendees.length > 3 && ` +${event.attendees.length - 3}`}
          </div>
        )}
      </div>
      <div className="text-sm text-muted-foreground w-16 text-right">
        {formatMinutes(duration)}
      </div>
      <select
        value={event.categoryId || ''}
        onChange={(e) => onChangeCategory(event.id, e.target.value)}
        className="w-32 px-2 py-1 text-sm border rounded"
        style={{
          borderColor: event.categoryColor || undefined,
          backgroundColor: event.categoryColor ? `${event.categoryColor}20` : undefined,
        }}
      >
        <option value="">未分類</option>
        {categories.map((cat) => (
          <option key={cat.id} value={cat.id}>
            {cat.name}
          </option>
        ))}
      </select>
    </div>
  )
}
