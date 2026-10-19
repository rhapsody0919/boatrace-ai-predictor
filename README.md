# 龍神レーダー - ボートレースのデータとAI予想

ボートレースの出走表・展示・結果・オッズなどのデータと、AI の予想を、スマートフォンで見やすく出すサービス。

**公式サイト**: https://www.boat-ai.jp/

作業の規約（Claude・Codex 共通）は [AGENTS.md](./AGENTS.md)、Claude に固有の進め方は [.claude/CLAUDE.md](./.claude/CLAUDE.md)。設計資料は `docs/` にある（置き場の決まりは `.claude/rules/documentation.md`）。

---

## 構成

```
公式サイト・各会場の公式サイト・BOATCAST
        │ 取得（Vercel Cron。予備として一部 GitHub Actions）
        ▼
┌──────────────────────────────┐
│ Supabase（PostgreSQL・RPC・Storage） │
└──────────────────────────────┘
        ▲ 集計・予想の生成・学習（GitHub Actions・Vercel Cron）
        │
        ▼ 読み取り
┌──────────────────────────────┐
│ Vercel                                │
│  - React の SPA（クライアントで描画）  │
│  - api/（Vercel Functions。キャッシュ  │
│    つきの読み取り・管理 API・cron）    │
│  - middleware.js（ボット向けの HTML）  │
└──────────────────────────────┘
        │
        ▼
     ユーザー（スマートフォン・PC）
```

- スクレイピングは Vercel に集約している（[ADR-0066](./docs/adr/0066-scraping-execution-consolidation-to-vercel.md)）。cron の一覧は `vercel.json`、GitHub Actions は `.github/workflows/`
- SSR・プリレンダリングは無い。JavaScript を実行しないクローラーには、ページごとの meta が届かない（`docs/reference/seo-architecture-constraints.md`）。AI クローラー向けには、ビルド時に静的なスナップショットを作る（`scripts/generate-ai-snapshots.js`）
- DB のマイグレーションは `docs/db-migration/`、適用状況の台帳は `docs/db-migration/APPLIED.md`、適用の手順は `docs/operation/db-apply.md`

## 主な画面

| パス | 内容 |
|---|---|
| `/`・`/races`・`/races/:date` | 会場・レースの一覧 |
| `/race/:raceId` | レース詳細（出走表・直前情報・オッズ・AI予想・結果などのタブ） |
| `/race/:raceId/assist` | 思考アシスト |
| `/today` | 本日のデータ一覧 |
| `/venues`・`/venue/:venueCode`・`/venue/:venueCode/meet/:startDate` | 会場の情報・節のページ |
| `/racers`・`/racer/:racerId` | 選手の一覧・選手のページ |
| `/holmes`・`/poirot` | 予想モデルの説明と成績 |
| `/accuracy`・`/outcome-distribution`・`/winning-technique` | 成績・出目・決まり手の分析 |
| `/blog` | ブログ（`public/blog/`） |
| `/admin/sns-hub` | SNS 投稿の管理（管理者だけ） |

多言語は ja・en・zh-TW・ko（`/en/...` のように言語を前に付ける。`src/config/languages.js`）。

## 技術

- フロントエンド: React 19・Vite・react-router-dom・i18next・Recharts・framer-motion・Leaflet
- サーバー: Vercel Functions（`api/`）・Node.js のバッチ（`scripts/`）
- データベース: Supabase
- 予想モデル: `scripts/ml/`（Python）と `scripts/daily/`
- SNS の動画: `sns-video-studio/`（Remotion）
- テスト: Playwright（`e2e/`。録画を再生する）、検査スクリプト（`scripts/maintenance/verify-*.js`、台帳は `verify-registry.json`）

## 開発

```bash
npm install
cp .env.example .env.local
```

環境変数の一覧は `docs/setup/env-vars.md`。

| コマンド | 内容 |
|---|---|
| `npm run build` | 本番ビルド（AI スナップショットの生成を含む） |
| `npm run lint` | ESLint |
| `npm run verify:ci` | 検査スクリプトをまとめて実行（PR の CI と同じ。手元では全件を流さない） |
| `npm run test:e2e` | E2E（PR の CI でも走る） |
| `npm run test:layout` | 画面幅5種のレイアウトの検査 |

ブランチは GitHub Flow。`master` が本番（https://www.boat-ai.jp/）で、PR ごとに Vercel の Preview が作られる（`codex/*` のブランチは作らない）。コミットメッセージは `<type>: <日本語の説明>`。

## 注意

- 予想は結果を保証しない。舟券の購入は、日本国内に住む20歳以上の人に限られる
- 画面の本文・見出しでは「ボートレース」と書く（`.claude/rules/code-style.md`）
