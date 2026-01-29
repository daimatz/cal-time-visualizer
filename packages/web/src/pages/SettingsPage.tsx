import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import {
  authApi,
  calendarApi,
  categoryApi,
  settingsApi,
  type LinkedAccount,
  type Calendar,
  type Category,
  type Settings,
} from '@/lib/api'

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [accounts, setAccounts] = useState<LinkedAccount[]>([])
  const [calendars, setCalendars] = useState<Calendar[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [showLinkedMessage, setShowLinkedMessage] = useState(false)

  useEffect(() => {
    if (searchParams.get('linked') === 'true') {
      setShowLinkedMessage(true)
      setSearchParams({}, { replace: true })
    }
    loadData()
  }, [])

  async function loadData() {
    setIsLoading(true)
    try {
      const [accs, cals, cats, sett] = await Promise.all([
        authApi.accounts(),
        calendarApi.list(),
        categoryApi.list(),
        settingsApi.get(),
      ])
      setAccounts(accs.accounts)
      setCalendars(cals.calendars)
      setCategories(cats.categories)
      setSettings(sett)
    } catch (error) {
      console.error('Failed to load settings:', error)
    } finally {
      setIsLoading(false)
    }
  }

  async function handleToggleCalendar(id: string, enabled: boolean) {
    try {
      await calendarApi.toggle(id, enabled)
      setCalendars((prev) =>
        prev.map((cal) => (cal.id === id ? { ...cal, isEnabled: enabled } : cal))
      )
    } catch (error) {
      console.error('Failed to toggle calendar:', error)
    }
  }

  async function handleUnlinkAccount(id: string) {
    if (!confirm('このアカウントの連携を解除しますか？')) return
    try {
      await authApi.unlinkAccount(id)
      setAccounts((prev) => prev.filter((acc) => acc.id !== id))
      await loadData()
    } catch (error) {
      console.error('Failed to unlink account:', error)
    }
  }

  async function handleSaveSettings() {
    if (!settings) return
    setIsSaving(true)
    try {
      await settingsApi.update(settings)
    } catch (error) {
      console.error('Failed to save settings:', error)
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDeleteCategory(id: string) {
    if (!confirm('このカテゴリを削除しますか？')) return
    try {
      await categoryApi.delete(id)
      setCategories((prev) => prev.filter((cat) => cat.id !== id))
    } catch (error) {
      console.error('Failed to delete category:', error)
    }
  }

  function handleAddAccount() {
    window.location.href = '/api/auth/link'
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Settings</h1>

      {showLinkedMessage && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-md flex items-center justify-between">
          <p>
            アカウントを連携しました。下のカレンダー一覧から、集計に含めるカレンダーを有効にしてください。
          </p>
          <button
            onClick={() => setShowLinkedMessage(false)}
            className="text-blue-600 hover:text-blue-800"
          >
            ✕
          </button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>連携アカウント</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="flex items-center justify-between py-2 border-b last:border-0"
            >
              <div className="flex items-center gap-2">
                <span>{account.googleEmail}</span>
                {account.isPrimary && (
                  <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded">
                    Primary
                  </span>
                )}
              </div>
              {!account.isPrimary && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleUnlinkAccount(account.id)}
                >
                  連携解除
                </Button>
              )}
            </div>
          ))}
          <Button variant="outline" onClick={handleAddAccount}>
            + アカウントを追加
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>カレンダー</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {calendars.map((calendar) => (
            <label
              key={calendar.id}
              className="flex items-center justify-between py-2 border-b last:border-0 cursor-pointer"
            >
              <div>
                <div className="font-medium">{calendar.name}</div>
                <div className="text-sm text-muted-foreground">
                  {calendar.accountEmail}
                </div>
              </div>
              <input
                type="checkbox"
                checked={calendar.isEnabled}
                onChange={(e) =>
                  handleToggleCalendar(calendar.id, e.target.checked)
                }
                className="w-5 h-5 rounded border-gray-300"
              />
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>カテゴリ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {categories.map((category) => (
            <div
              key={category.id}
              className="flex items-center justify-between py-2 border-b last:border-0"
            >
              <div className="flex items-center gap-3">
                <span
                  className="w-4 h-4 rounded-full"
                  style={{ backgroundColor: category.color }}
                />
                <span>{category.name}</span>
                {category.isSystem && (
                  <span className="text-xs text-muted-foreground">(AI生成)</span>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDeleteCategory(category.id)}
              >
                削除
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>レポート設定</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {settings && (
            <>
              <label className="flex items-center justify-between">
                <span>週次レポートを有効にする</span>
                <input
                  type="checkbox"
                  checked={settings.reportEnabled}
                  onChange={(e) =>
                    setSettings({ ...settings, reportEnabled: e.target.checked })
                  }
                  className="w-5 h-5 rounded border-gray-300"
                />
              </label>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    送信曜日
                  </label>
                  <select
                    value={settings.reportDay}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        reportDay: Number(e.target.value),
                      })
                    }
                    className="w-full rounded-md border border-input bg-background px-3 py-2"
                  >
                    <option value={0}>日曜日</option>
                    <option value={1}>月曜日</option>
                    <option value={2}>火曜日</option>
                    <option value={3}>水曜日</option>
                    <option value={4}>木曜日</option>
                    <option value={5}>金曜日</option>
                    <option value={6}>土曜日</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    送信時刻
                  </label>
                  <select
                    value={settings.reportHour}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        reportHour: Number(e.target.value),
                      })
                    }
                    className="w-full rounded-md border border-input bg-background px-3 py-2"
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>
                        {i}:00
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <Button onClick={handleSaveSettings} disabled={isSaving}>
                {isSaving ? '保存中...' : '設定を保存'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
