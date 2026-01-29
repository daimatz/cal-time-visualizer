interface SendEmailParams {
  to: string
  subject: string
  html: string
}

export async function sendEmail(
  apiKey: string,
  domain: string,
  params: SendEmailParams
): Promise<void> {
  const auth = btoa(`api:${apiKey}`)

  const formData = new FormData()
  formData.append('from', `Cal Time Visualizer <noreply@${domain}>`)
  formData.append('to', params.to)
  formData.append('subject', params.subject)
  formData.append('html', params.html)

  const response = await fetch(
    `https://api.mailgun.net/v3/${domain}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
      },
      body: formData,
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to send email: ${error}`)
  }
}

export function generateReportHtml(data: {
  period: { start: string; end: string }
  totalMinutes: number
  categories: { name: string; color: string; minutes: number; percentage: number }[]
}): string {
  const formatMinutes = (minutes: number) => {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    if (hours === 0) return `${mins}分`
    if (mins === 0) return `${hours}時間`
    return `${hours}時間${mins}分`
  }

  const categoryRows = data.categories
    .map(
      (cat) => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">
          <span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background-color: ${cat.color}; margin-right: 8px;"></span>
          ${cat.name}
        </td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: right;">
          ${formatMinutes(cat.minutes)}
        </td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: right;">
          ${cat.percentage.toFixed(1)}%
        </td>
      </tr>
    `
    )
    .join('')

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #1f2937;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    h1 {
      color: #3b82f6;
      font-size: 24px;
      margin-bottom: 8px;
    }
    .period {
      color: #6b7280;
      font-size: 14px;
      margin-bottom: 24px;
    }
    .total {
      background-color: #f3f4f6;
      padding: 16px;
      border-radius: 8px;
      margin-bottom: 24px;
    }
    .total-label {
      font-size: 14px;
      color: #6b7280;
    }
    .total-value {
      font-size: 32px;
      font-weight: bold;
      color: #1f2937;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      text-align: left;
      padding: 8px;
      border-bottom: 2px solid #e5e7eb;
      font-weight: 600;
    }
    .footer {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid #e5e7eb;
      font-size: 12px;
      color: #9ca3af;
    }
  </style>
</head>
<body>
  <h1>Weekly Time Report</h1>
  <p class="period">${data.period.start} 〜 ${data.period.end}</p>

  <div class="total">
    <div class="total-label">総時間</div>
    <div class="total-value">${formatMinutes(data.totalMinutes)}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th>カテゴリ</th>
        <th style="text-align: right;">時間</th>
        <th style="text-align: right;">割合</th>
      </tr>
    </thead>
    <tbody>
      ${categoryRows}
    </tbody>
  </table>

  <div class="footer">
    <p>このレポートは Cal Time Visualizer から自動送信されました。</p>
  </div>
</body>
</html>
  `.trim()
}
