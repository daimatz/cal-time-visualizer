# Cal Time Visualizer - 設計ドキュメント

## 1. 概要

Google Calendar と連携し、ユーザーの時間の使い方を AI (OpenAI) で自動カテゴライズ・可視化するWebアプリケーション。
毎週定期的にレポートをメール送信する機能を持つ。

## 2. 機能要件

### 2.1 認証・アカウント管理

- **Primary Account**: Google OAuth でサインアップ/サインイン
- **連携アカウント**: 複数の Google アカウントを追加連携可能
- 各アカウントで取得するカレンダー一覧を選択可能

### 2.2 カレンダーデータ取得

- 連携した全アカウントのカレンダーイベントを取得
- 取得対象期間: 指定可能（デフォルト: 過去1週間）
- 取得データ:
  - イベントタイトル
  - 開始/終了時刻
  - 参加者一覧
  - カレンダー名
  - イベントの種類（終日/時間指定）

### 2.3 AI カテゴライズ

OpenAI API を使用した2段階のカテゴライズ:

#### 2.3.1 カテゴリマスター生成

初回またはユーザーリクエスト時に、過去のイベント一覧を分析してカテゴリマスターを自動生成:

```
入力: 過去1ヶ月のイベント一覧 (タイトル、参加者数、カレンダー名)
↓
OpenAI API (gpt-4o-mini)
↓
出力: カテゴリマスター候補
  - Meeting (1on1)
  - Meeting (Team)
  - External Meeting
  - Focus Time
  - 開発作業
  - etc.
```

#### 2.3.2 イベントカテゴライズ

各イベントを生成されたカテゴリに振り分け:

```
入力: イベント情報 + カテゴリマスター + 振り分けルール
↓
OpenAI API (gpt-4o-mini)
↓
出力: カテゴリ ID
```

#### 2.3.3 ユーザーカスタマイズ

- カテゴリマスターの編集（追加/削除/名前変更）
- 振り分けルールのヒント設定
  - 例: 「"standup" を含む場合は Team Meeting」
  - 例: 「参加者が2人なら 1on1」
- 個別イベントのカテゴリ手動修正（学習データとして活用）

### 2.4 可視化

- 期間内の時間配分を円グラフ/棒グラフで表示
- カテゴリ別の合計時間
- 日別の時間推移
- 前週との比較（オプション）

### 2.5 レポート送信

- 毎週日曜 9:00 (JST) に定期実行
- Primary Account のメールアドレス宛に送信
- レポート内容:
  - 過去1週間の時間配分サマリー
  - カテゴリ別の時間（テキスト形式）
  - 前週比の変化

---

## 3. システムアーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend (Vite + React)                       │
│                    Hosted on Cloudflare Pages                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │  Login   │  │ Dashboard│  │ Settings │  │ Report Preview   │ │
│  │  Page    │  │  Page    │  │  Page    │  │     Page         │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Backend API (Cloudflare Workers + Hono)          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │  Auth    │  │ Calendar │  │ Report   │  │  Categorize      │ │
│  │  API     │  │   API    │  │   API    │  │     API          │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
    │         │              │              │              │
    ▼         ▼              ▼              ▼              ▼
┌────────┐ ┌────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────┐
│  D1    │ │  KV    │ │   Google     │ │   OpenAI     │ │Mailgun │
│ (SQL)  │ │(Cache) │ │ Calendar API │ │     API      │ │(Email) │
└────────┘ └────────┘ └──────────────┘ └──────────────┘ └────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │  Cron Triggers   │
                    │ (Workers 内蔵)    │
                    └──────────────────┘
```

---

## 4. 技術スタック

| レイヤー | 技術 | 理由 |
|---------|------|------|
| Frontend | Vite + React 18 | 軽量、高速ビルド |
| Styling | Tailwind CSS + shadcn/ui | 高速開発、モダンなUI |
| Backend | Cloudflare Workers + Hono | エッジ実行、低レイテンシ |
| DB | Cloudflare D1 (SQLite) | Workers との統合、無料枠 |
| Cache | Cloudflare KV | セッション、トークンキャッシュ |
| グラフ | Recharts | React対応、軽量 |
| AI | OpenAI API (gpt-4o-mini) | カテゴライズ処理 |
| Email | Mailgun | 信頼性、無料枠 |
| Cron | Workers Cron Triggers | Workers 統合 |
| Hosting | Cloudflare Pages + Workers | 統合環境 |

---

## 5. データベース設計 (D1 SQLite)

### 5.1 ER図

```
┌─────────────────┐       ┌─────────────────────┐
│     users       │       │  linked_accounts    │
├─────────────────┤       ├─────────────────────┤
│ id (PK)         │──┐    │ id (PK)             │
│ email           │  │    │ user_id (FK)        │──┐
│ name            │  └───<│ google_email        │  │
│ created_at      │       │ access_token        │  │
│ updated_at      │       │ refresh_token       │  │
└─────────────────┘       │ token_expires_at    │  │
                          │ is_primary          │  │
                          │ created_at          │  │
                          └─────────────────────┘  │
                                                   │
┌─────────────────────┐                            │
│  selected_calendars │                            │
├─────────────────────┤                            │
│ id (PK)             │                            │
│ linked_account_id   │───────────────────────────<┘
│ calendar_id         │
│ calendar_name       │
│ is_enabled          │
│ created_at          │
└─────────────────────┘

┌─────────────────────┐       ┌─────────────────────┐
│  categories         │       │  category_rules     │
├─────────────────────┤       ├─────────────────────┤
│ id (PK)             │──┐    │ id (PK)             │
│ user_id (FK)        │  │    │ category_id (FK)    │──<┘
│ name                │  └───<│ rule_type           │
│ color               │       │ rule_value          │
│ sort_order          │       │ created_at          │
│ is_system           │       └─────────────────────┘
│ created_at          │
└─────────────────────┘

┌─────────────────────┐
│  event_categories   │
├─────────────────────┤
│ id (PK)             │
│ user_id (FK)        │
│ event_id            │  (Google Calendar Event ID)
│ category_id (FK)    │
│ is_manual           │  (手動修正かどうか)
│ created_at          │
└─────────────────────┘

┌─────────────────────┐
│  report_settings    │
├─────────────────────┤
│ id (PK)             │
│ user_id (FK)        │
│ is_enabled          │
│ send_day            │
│ send_hour           │
│ timezone            │
│ created_at          │
└─────────────────────┘
```

### 5.2 テーブル詳細

#### users
| カラム | 型 | 説明 |
|--------|-----|------|
| id | TEXT (UUID) | 主キー |
| email | TEXT | Primary Account のメールアドレス |
| name | TEXT | 表示名 |
| created_at | TEXT (ISO8601) | 作成日時 |
| updated_at | TEXT (ISO8601) | 更新日時 |

#### linked_accounts
| カラム | 型 | 説明 |
|--------|-----|------|
| id | TEXT (UUID) | 主キー |
| user_id | TEXT | users.id への外部キー |
| google_email | TEXT | 連携した Google アカウントのメール |
| access_token | TEXT | Google API アクセストークン (暗号化) |
| refresh_token | TEXT | リフレッシュトークン (暗号化) |
| token_expires_at | TEXT | トークン有効期限 |
| is_primary | INTEGER (0/1) | Primary Account かどうか |
| created_at | TEXT | 作成日時 |

#### selected_calendars
| カラム | 型 | 説明 |
|--------|-----|------|
| id | TEXT (UUID) | 主キー |
| linked_account_id | TEXT | linked_accounts.id への外部キー |
| calendar_id | TEXT | Google Calendar ID |
| calendar_name | TEXT | カレンダー名 |
| is_enabled | INTEGER (0/1) | 集計対象かどうか |
| created_at | TEXT | 作成日時 |

#### categories
| カラム | 型 | 説明 |
|--------|-----|------|
| id | TEXT (UUID) | 主キー |
| user_id | TEXT | users.id への外部キー |
| name | TEXT | カテゴリ名 |
| color | TEXT | 表示色 (hex) |
| sort_order | INTEGER | 表示順 |
| is_system | INTEGER (0/1) | システム生成か |
| created_at | TEXT | 作成日時 |

#### category_rules
| カラム | 型 | 説明 |
|--------|-----|------|
| id | TEXT (UUID) | 主キー |
| category_id | TEXT | categories.id への外部キー |
| rule_type | TEXT | ルール種別 (title_contains, attendee_count, etc.) |
| rule_value | TEXT | ルール値 (JSON) |
| created_at | TEXT | 作成日時 |

#### event_categories
| カラム | 型 | 説明 |
|--------|-----|------|
| id | TEXT (UUID) | 主キー |
| user_id | TEXT | users.id への外部キー |
| event_id | TEXT | Google Calendar Event ID |
| category_id | TEXT | categories.id への外部キー |
| is_manual | INTEGER (0/1) | 手動設定かどうか |
| created_at | TEXT | 作成日時 |

#### report_settings
| カラム | 型 | 説明 |
|--------|-----|------|
| id | TEXT (UUID) | 主キー |
| user_id | TEXT | users.id への外部キー |
| is_enabled | INTEGER (0/1) | レポート送信有効 |
| send_day | INTEGER | 送信曜日 (0=日曜) |
| send_hour | INTEGER | 送信時刻 (0-23) |
| timezone | TEXT | タイムゾーン |
| created_at | TEXT | 作成日時 |

---

## 6. 画面フロー

```
                    ┌─────────────┐
                    │   Landing   │
                    │    Page     │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   Google    │
                    │   OAuth     │
                    └──────┬──────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
            ▼              ▼              ▼
     ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
     │  Dashboard  │ │  Settings   │ │   Report    │
     │   (Main)    │ │    Page     │ │   Preview   │
     └─────────────┘ └─────────────┘ └─────────────┘
            │              │
            │              ├── アカウント連携管理
            │              ├── カレンダー選択
            │              ├── カテゴリ管理 (AI生成 + 手動編集)
            │              ├── 振り分けルール設定
            │              └── レポート設定
            │
            ├── 期間選択
            ├── カテゴリ別時間表示 (円グラフ)
            ├── 日別推移 (棒グラフ)
            └── イベント一覧 (カテゴリ付き、手動修正可能)
```

---

## 7. API設計

### 7.1 認証関連

| Method | Endpoint | 説明 |
|--------|----------|------|
| GET | /api/auth/login | Google OAuth 開始 |
| GET | /api/auth/callback | Google OAuth コールバック |
| POST | /api/auth/link | 追加アカウント連携 |
| DELETE | /api/auth/link/:id | アカウント連携解除 |
| GET | /api/auth/accounts | 連携アカウント一覧 |
| POST | /api/auth/logout | ログアウト |
| GET | /api/auth/me | 現在のユーザー情報 |

### 7.2 カレンダー関連

| Method | Endpoint | 説明 |
|--------|----------|------|
| GET | /api/calendars | 全カレンダー一覧 |
| PUT | /api/calendars/:id | カレンダー有効/無効切替 |
| GET | /api/events | イベント一覧取得 (期間指定) |

### 7.3 カテゴリ関連

| Method | Endpoint | 説明 |
|--------|----------|------|
| GET | /api/categories | カテゴリ一覧 |
| POST | /api/categories | カテゴリ追加 |
| PUT | /api/categories/:id | カテゴリ更新 |
| DELETE | /api/categories/:id | カテゴリ削除 |
| POST | /api/categories/generate | AI でカテゴリマスター生成 |
| GET | /api/categories/:id/rules | カテゴリのルール一覧 |
| POST | /api/categories/:id/rules | ルール追加 |
| DELETE | /api/categories/rules/:id | ルール削除 |

### 7.4 カテゴライズ関連

| Method | Endpoint | 説明 |
|--------|----------|------|
| POST | /api/categorize | イベント一括カテゴライズ (AI) |
| PUT | /api/events/:eventId/category | イベントのカテゴリ手動設定 |

### 7.5 レポート関連

| Method | Endpoint | 説明 |
|--------|----------|------|
| GET | /api/report | レポートデータ取得 |
| GET | /api/report/preview | レポートプレビュー (HTML) |
| POST | /api/report/send | 手動レポート送信 |

### 7.6 設定関連

| Method | Endpoint | 説明 |
|--------|----------|------|
| GET | /api/settings | 設定取得 |
| PUT | /api/settings | 設定更新 |

### 7.7 Cron (内部)

| Trigger | 説明 |
|---------|------|
| `0 0 * * 0` (UTC) | 週次レポート送信 (日曜9時JST) |

---

## 8. 処理フロー詳細

### 8.1 初回サインアップフロー

```
User                    Workers                 Google                  D1
 │                       │                        │                      │
 │──── Sign in ─────────>│                        │                      │
 │                       │──── OAuth Request ────>│                      │
 │<──── Google Login ────│<───────────────────────│                      │
 │──── Authorize ───────>│                        │                      │
 │                       │<─── Code + Tokens ─────│                      │
 │                       │                        │                      │
 │                       │──── Create User ───────────────────────────>│
 │                       │──── Store Tokens ──────────────────────────>│
 │                       │<─── User Created ─────────────────────────-│
 │                       │                        │                      │
 │                       │──── Get Calendars ────>│                      │
 │                       │<─── Calendar List ─────│                      │
 │                       │──── Store Calendars ───────────────────────>│
 │                       │                        │                      │
 │<─── Set Cookie ───────│                        │                      │
 │<─── Redirect ─────────│                        │                      │
```

### 8.2 カテゴリマスター生成フロー

```
User                    Workers                 D1                    OpenAI
 │                       │                        │                      │
 │── Generate Request ──>│                        │                      │
 │                       │                        │                      │
 │                       │── Get past events ────>│                      │
 │                       │   (Google API)         │                      │
 │                       │<─── Events ────────────│                      │
 │                       │                        │                      │
 │                       │── Analyze events ─────────────────────────>│
 │                       │   (gpt-4o-mini)        │                      │
 │                       │<─── Category suggestions ─────────────────│
 │                       │                        │                      │
 │                       │── Store categories ───>│                      │
 │                       │<─── OK ────────────────│                      │
 │                       │                        │                      │
 │<─── Categories ───────│                        │                      │
```

### 8.3 イベントカテゴライズフロー

```
User                    Workers                 D1                    OpenAI
 │                       │                        │                      │
 │── View Dashboard ────>│                        │                      │
 │                       │                        │                      │
 │                       │── Get events ─────────>│                      │
 │                       │   (Google API)         │                      │
 │                       │                        │                      │
 │                       │── Get categories ─────>│                      │
 │                       │── Get rules ──────────>│                      │
 │                       │── Get manual cats ────>│                      │
 │                       │                        │                      │
 │                       │ [For uncategorized events]                    │
 │                       │                        │                      │
 │                       │── Categorize (batch) ─────────────────────>│
 │                       │   (gpt-4o-mini)        │                      │
 │                       │<─── Category IDs ─────────────────────────│
 │                       │                        │                      │
 │                       │── Cache results ──────>│                      │
 │                       │                        │                      │
 │<─── Dashboard data ───│                        │                      │
```

### 8.4 レポート生成フロー (Cron)

```
Cron Trigger            Workers                 D1        Google    OpenAI    Mailgun
 │                       │                        │          │         │         │
 │──── Trigger ─────────>│                        │          │         │         │
 │                       │                        │          │         │         │
 │                       │── Get users (report ON)>│         │         │         │
 │                       │                        │          │         │         │
 │                       │ [For each user]        │          │         │         │
 │                       │                        │          │         │         │
 │                       │── Get tokens ─────────>│          │         │         │
 │                       │── Refresh if needed ────────────>│         │         │
 │                       │── Get events ───────────────────>│         │         │
 │                       │── Categorize ───────────────────────────>│         │
 │                       │                        │          │         │         │
 │                       │ [Generate report]      │          │         │         │
 │                       │                        │          │         │         │
 │                       │── Send email ─────────────────────────────────────>│
 │                       │<─── OK ───────────────────────────────────────────│
 │                       │                        │          │         │         │
 │<─── Complete ─────────│                        │          │         │         │
```

---

## 9. AI カテゴライズ詳細

### 9.1 カテゴリマスター生成プロンプト

```typescript
const generateCategoriesPrompt = (events: EventSummary[]) => `
あなたはカレンダーイベントを分析するアシスタントです。
以下のイベント一覧を分析し、時間の使い方を把握するのに適したカテゴリを5-10個提案してください。

## イベント一覧
${events.map(e => `- ${e.title} (参加者: ${e.attendeeCount}名, カレンダー: ${e.calendarName})`).join('\n')}

## 出力形式 (JSON)
{
  "categories": [
    { "name": "カテゴリ名", "description": "どういうイベントが該当するか" },
    ...
  ]
}
`;
```

### 9.2 イベントカテゴライズプロンプト

```typescript
const categorizeEventsPrompt = (
  events: Event[],
  categories: Category[],
  rules: Rule[]
) => `
以下のイベントを指定されたカテゴリに振り分けてください。

## カテゴリ一覧
${categories.map(c => `- ${c.id}: ${c.name}`).join('\n')}

## 振り分けルール (優先適用)
${rules.map(r => `- ${r.description}`).join('\n')}

## イベント一覧
${events.map(e => `- ${e.id}: "${e.title}" (参加者: ${e.attendeeCount}名)`).join('\n')}

## 出力形式 (JSON)
{
  "results": [
    { "eventId": "xxx", "categoryId": "yyy" },
    ...
  ]
}
`;
```

### 9.3 コスト最適化

- **バッチ処理**: 複数イベントを1リクエストでカテゴライズ
- **キャッシュ**: 同一イベントIDは再カテゴライズしない (event_categories テーブル)
- **軽量モデル**: gpt-4o-mini を使用 (コスト約1/30)
- **トークン削減**: イベント情報は必要最小限に圧縮

---

## 10. セキュリティ考慮事項

### 10.1 トークン管理

- Google OAuth トークンは AES-256-GCM で暗号化して D1 に保存
- 暗号化キーは Workers の Secret として管理
- リフレッシュトークンは期限管理し、失効時は再認証を促す

### 10.2 セッション管理

- セッショントークンは HttpOnly, Secure, SameSite=Strict Cookie
- セッションデータは KV に保存 (TTL: 7日)

### 10.3 API セキュリティ

- 全 API エンドポイントで認証必須
- Cron エンドポイントは Workers 内部からのみ呼び出し可能
- CORS 設定で許可オリジンを制限

### 10.4 データプライバシー

- カレンダーデータは永続保存しない (カテゴライズ結果のみ保存)
- ユーザーがアカウント削除時は全データを削除

---

## 11. 開発フェーズ

### Phase 1: 基盤構築
- [ ] Vite + React プロジェクトセットアップ
- [ ] Cloudflare Workers (Hono) セットアップ
- [ ] D1 データベース作成・マイグレーション
- [ ] Google OAuth 実装
- [ ] 基本的な UI コンポーネント (shadcn/ui)

### Phase 2: コア機能
- [ ] カレンダー取得・表示
- [ ] OpenAI カテゴリマスター生成
- [ ] OpenAI イベントカテゴライズ
- [ ] ダッシュボード (グラフ表示)

### Phase 3: マルチアカウント
- [ ] 追加アカウント連携
- [ ] カレンダー選択機能

### Phase 4: カスタマイズ機能
- [ ] カテゴリ編集 UI
- [ ] 振り分けルール設定 UI
- [ ] イベントの手動カテゴリ修正

### Phase 5: レポート機能
- [ ] レポート生成ロジック
- [ ] メール送信 (Mailgun)
- [ ] Cron Triggers 設定
- [ ] レポートプレビュー

---

## 12. プロジェクト構成

```
cal-time-visualizer/
├── packages/
│   ├── web/                    # Vite + React フロントエンド
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── pages/
│   │   │   ├── hooks/
│   │   │   ├── lib/
│   │   │   └── main.tsx
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   └── api/                    # Cloudflare Workers API
│       ├── src/
│       │   ├── routes/
│       │   │   ├── auth.ts
│       │   │   ├── calendars.ts
│       │   │   ├── categories.ts
│       │   │   ├── events.ts
│       │   │   ├── report.ts
│       │   │   └── settings.ts
│       │   ├── services/
│       │   │   ├── google.ts
│       │   │   ├── openai.ts
│       │   │   ├── mailgun.ts
│       │   │   └── categorizer.ts
│       │   ├── db/
│       │   │   ├── schema.sql
│       │   │   └── migrations/
│       │   ├── middleware/
│       │   │   └── auth.ts
│       │   └── index.ts
│       ├── wrangler.toml
│       └── package.json
│
├── package.json                # Workspace root
├── pnpm-workspace.yaml
└── docs/
    └── design.md
```

---

## 13. 環境変数 / Secrets

### Workers (wrangler.toml / Secrets)

```toml
# wrangler.toml
name = "cal-time-visualizer-api"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "cal-time-visualizer"
database_id = "xxx"

[[kv_namespaces]]
binding = "SESSION_KV"
id = "xxx"

[vars]
FRONTEND_URL = "https://cal-time-visualizer.pages.dev"
```

```bash
# Secrets (wrangler secret put)
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
OPENAI_API_KEY=xxx
MAILGUN_API_KEY=xxx
MAILGUN_DOMAIN=xxx
ENCRYPTION_KEY=xxx  # 32 bytes hex
```

### Frontend (.env)

```env
VITE_API_URL=https://cal-time-visualizer-api.xxx.workers.dev
```

---

## 14. 今後の拡張案

- Slack 通知対応
- カテゴリの学習機能（手動修正を学習データとして活用）
- Outlook Calendar 対応
- チーム機能（組織内の時間分析）
- 目標設定と達成度トラッキング
- モバイルアプリ (PWA)
