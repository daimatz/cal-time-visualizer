# Cal Time Visualizer

Google Calendar と連携して時間の使い方を AI でカテゴライズ・可視化するアプリケーション。

## 機能

- Google OAuth による認証
- 複数 Google アカウントの連携
- カレンダーイベントの自動カテゴライズ (OpenAI gpt-4o-mini)
- 時間配分の可視化 (円グラフ・棒グラフ)
- 週次レポートのメール送信

## 技術スタック

- **Frontend**: Vite + React + Tailwind CSS
- **Backend**: Cloudflare Workers + Hono
- **Database**: Cloudflare D1 (SQLite)
- **Session**: Cloudflare KV
- **AI**: OpenAI API
- **Email**: Mailgun

## セットアップ

### 1. 依存関係のインストール

```bash
pnpm install
```

### 2. Google Cloud Console の設定

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. APIs & Services > Credentials で OAuth 2.0 Client ID を作成
3. Authorized redirect URIs に以下を追加:
   - `http://localhost:5173/api/auth/callback` (開発用)
   - `https://your-domain.com/api/auth/callback` (本番用)
4. Google Calendar API を有効化

### 3. 環境変数の設定

```bash
# packages/api/.dev.vars を作成
cp packages/api/.dev.vars.example packages/api/.dev.vars
```

`.dev.vars` を編集:

```
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
OPENAI_API_KEY=your-openai-api-key
MAILGUN_API_KEY=your-mailgun-api-key
MAILGUN_DOMAIN=your-mailgun-domain
ENCRYPTION_KEY=your-64-char-hex-key
```

暗号化キーの生成:

```bash
openssl rand -hex 32
```

### 4. ローカルデータベースの初期化

```bash
pnpm db:migrate:local
```

### 5. 開発サーバーの起動

```bash
# API サーバー (http://localhost:8787)
pnpm dev:api

# Web フロントエンド (http://localhost:5173)
pnpm dev:web

# 両方同時に起動
pnpm dev
```

## デプロイ (Cloudflare)

### 1. リソースの作成

```bash
# D1 データベースを作成
wrangler d1 create cal-time-visualizer

# KV namespace を作成
wrangler kv:namespace create SESSION_KV
```

### 2. wrangler.toml の更新

作成したリソースの ID を `packages/api/wrangler.toml` に設定

### 3. Secrets の設定

```bash
cd packages/api
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put OPENAI_API_KEY
wrangler secret put MAILGUN_API_KEY
wrangler secret put MAILGUN_DOMAIN
wrangler secret put ENCRYPTION_KEY
```

### 4. データベースのマイグレーション

```bash
pnpm db:migrate
```

### 5. デプロイ

```bash
pnpm deploy
```

## プロジェクト構成

```
cal-time-visualizer/
├── packages/
│   ├── web/                    # Vite + React フロントエンド
│   │   ├── src/
│   │   │   ├── components/     # UI コンポーネント
│   │   │   ├── hooks/          # React Hooks
│   │   │   ├── lib/            # API クライアント, ユーティリティ
│   │   │   └── pages/          # ページコンポーネント
│   │   └── vite.config.ts
│   │
│   └── api/                    # Cloudflare Workers API
│       ├── src/
│       │   ├── routes/         # API エンドポイント
│       │   ├── services/       # 外部サービス連携
│       │   ├── middleware/     # 認証ミドルウェア
│       │   └── db/             # データベーススキーマ
│       └── wrangler.toml
│
├── docs/
│   └── design.md               # 設計ドキュメント
└── pnpm-workspace.yaml
```

## ライセンス

MIT
