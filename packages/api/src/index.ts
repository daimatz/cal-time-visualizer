import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { Env } from './types'
import { auth } from './routes/auth'
import { calendars } from './routes/calendars'
import { events } from './routes/events'
import { categories } from './routes/categories'
import { categorize } from './routes/categorize'
import { report, generateReportData } from './routes/report'
import { settings } from './routes/settings'
import { sendEmail, generateReportHtml } from './services/mailgun'

const app = new Hono<{ Bindings: Env }>()

// Middleware
app.use('*', logger())
app.use(
  '/api/*',
  cors({
    origin: (origin, c) => {
      const frontendUrl = c.env.FRONTEND_URL
      if (origin === frontendUrl || origin?.startsWith('http://localhost')) {
        return origin
      }
      return frontendUrl
    },
    credentials: true,
  })
)

// Routes
app.route('/api/auth', auth)
app.route('/api/calendars', calendars)
app.route('/api/events', events)
app.route('/api/categories', categories)
app.route('/api/categorize', categorize)
app.route('/api/report', report)
app.route('/api/settings', settings)

// Health check
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Scheduled handler for weekly reports
const scheduled: ExportedHandlerScheduledHandler<Env> = async (event, env, ctx) => {
  console.log('Running scheduled report job')

  try {
    // Get all users with report enabled
    const usersResult = await env.DB.prepare(
      `SELECT u.id, u.email, rs.timezone
       FROM users u
       JOIN report_settings rs ON u.id = rs.user_id
       WHERE rs.is_enabled = 1`
    ).all<{ id: string; email: string; timezone: string }>()

    const now = new Date()

    for (const user of usersResult.results) {
      try {
        // Get user's report settings
        const settings = await env.DB.prepare(
          'SELECT send_day, send_hour, timezone FROM report_settings WHERE user_id = ?'
        )
          .bind(user.id)
          .first<{ send_day: number; send_hour: number; timezone: string }>()

        if (!settings) continue

        // Check if it's the right time for this user
        // Convert UTC to user's timezone and check day/hour
        const userTime = new Date(
          now.toLocaleString('en-US', { timeZone: settings.timezone })
        )
        const userDay = userTime.getDay()
        const userHour = userTime.getHours()

        if (userDay !== settings.send_day || userHour !== settings.send_hour) {
          continue
        }

        console.log(`Sending report to ${user.email}`)

        // Generate report for past week
        const end = new Date()
        const start = new Date()
        start.setDate(start.getDate() - 7)

        const reportData = await generateReportData(
          env,
          user.id,
          start.toISOString().split('T')[0],
          end.toISOString().split('T')[0]
        )

        const html = generateReportHtml(reportData)

        await sendEmail(env.MAILGUN_API_KEY, env.MAILGUN_DOMAIN, {
          to: user.email,
          subject: `Weekly Time Report (${reportData.period.start} 〜 ${reportData.period.end})`,
          html,
        })

        console.log(`Report sent to ${user.email}`)
      } catch (err) {
        console.error(`Failed to send report to ${user.email}:`, err)
      }
    }
  } catch (err) {
    console.error('Scheduled job failed:', err)
  }
}

export default {
  fetch: app.fetch,
  scheduled,
}
