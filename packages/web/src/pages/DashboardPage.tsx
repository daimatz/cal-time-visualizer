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
import { reportApi, categoryApi, type ReportData, type Category } from '@/lib/api'

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins}分`
  if (mins === 0) return `${hours}時間`
  return `${hours}時間${mins}分`
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

export function DashboardPage() {
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isGenerating, setIsGenerating] = useState(false)
  const [period, setPeriod] = useState(7)

  useEffect(() => {
    loadData()
  }, [period])

  async function loadData() {
    setIsLoading(true)
    try {
      const range = getDateRange(period)
      const [report, cats] = await Promise.all([
        reportApi.data(range),
        categoryApi.list(),
      ])
      setReportData(report)
      setCategories(cats.categories)
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  async function handleGenerateCategories() {
    setIsGenerating(true)
    try {
      const { categories: newCats } = await categoryApi.generate()
      setCategories(newCats)
      await loadData()
    } catch (error) {
      console.error('Failed to generate categories:', error)
    } finally {
      setIsGenerating(false)
    }
  }

  const pieData = useMemo(() => {
    if (!reportData) return []
    return reportData.categories.map((cat) => ({
      name: cat.name,
      value: cat.minutes,
      color: cat.color,
    }))
  }, [reportData])

  const barData = useMemo(() => {
    if (!reportData) return []
    return reportData.dailyData.map((day) => ({
      date: day.date.slice(5), // MM-DD
      ...Object.fromEntries(
        reportData.categories.map((cat) => [
          cat.name,
          (day.categories[cat.id] || 0) / 60, // hours
        ])
      ),
    }))
  }, [reportData])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
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
          {isGenerating ? 'カテゴリ生成中...' : 'AIでカテゴリを生成'}
        </Button>
      </div>
    )
  }

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
          <Button variant="outline" onClick={loadData}>
            更新
          </Button>
        </div>
      </div>

      {reportData && (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  総時間
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatMinutes(reportData.totalMinutes)}
                </div>
              </CardContent>
            </Card>
            {reportData.categories.slice(0, 3).map((cat) => (
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
                    <Tooltip
                      formatter={(value: number) => formatMinutes(value)}
                    />
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
                    {reportData.categories.map((cat) => (
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
              <CardTitle>カテゴリ一覧</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {reportData.categories.map((cat) => (
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
    </div>
  )
}
