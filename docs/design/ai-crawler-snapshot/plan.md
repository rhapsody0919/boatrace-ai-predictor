# AIクローラー向け静的スナップショット配信 - システム設計

ADR: [0032-ai-crawler-snapshot-delivery.md](../../adr/0032-ai-crawler-snapshot-delivery.md)（配信方式の採用理由）

## データ設計

新規のSupabaseテーブル・カラム追加は無し。既存のコンテンツソースをそのまま使う。

| 対象ページ | データソース |
|-----------|-------------|
| ブログ記事 | `public/blog/*.md`（既存） |
| `/winning-technique` | `src/locales/ja/common.json`の`analysisPage.h1`/`subtitle`/`tabs.*`/`info.*`（既存、17タブ分） |

`/winning-technique`の各分析タブ（`OutcomeDistributionTable`等17コンポーネント）はSupabase実データに依存するため、spec.mdの決定通りスナップショット生成の対象外とする。ビルド時にライブDBへ依存すると、ビルドの決定性が損なわれる（当日のレース有無でスナップショット内容が変わってしまう）ため、この切り分けは技術的にも妥当。

## スクリプト構成・実行タイミング

新規スクリプトは`scripts/`直下に配置する（`generate-sitemap.js`と同じくビルド成果物を生成する性質のスクリプトのため、`daily/analysis/maintenance/db`のいずれにも該当しない）。

```
scripts/
├── generate-ai-snapshots.js      # 新規: ビルド後のスナップショット生成本体
└── verification/
    └── verify-ai-snapshots.js    # 新規: デプロイ後の技術検証（ボットUA偽装フェッチ）
```

### `generate-ai-snapshots.js` の処理内容

`vite build`完了後、`dist/`を対象に実行する。2つの生成ロジックを持つ:

**1. ブログ記事（Playwright使用）**
1. `vite preview`相当のローカル静的サーバーを一時起動し`dist/`を配信
2. `src/data/blogPosts.js`から日本語記事の全IDを列挙
3. Playwrightで各記事URL（`/blog/{id}`）にアクセスし、`.blog-post-content`が描画されるまで待機
4. `page.content()`で完成後のHTML全体を取得
5. `dist/ai-snapshots/blog/{id}.html`として保存
6. 一時サーバーを停止

**2. `/winning-technique`（ブラウザ不使用、テンプレート生成）**
1. `src/locales/ja/common.json`の`analysisPage`セクションを読み込み
2. `h1`・`subtitle`・17タブ分の`tabs.*`名称・`info.*`（title/dataView等）を、`index.html`と同じ`<head>`構成（title/meta description/canonical）を持つ簡易HTMLテンプレートに流し込む
3. `dist/ai-snapshots/winning-technique.html`として保存

ブラウザを使わない理由: 実データ依存タブを除外した「説明部分のみ」の状態を、実際のReactコンポーネントから安定して切り出す手段が無い（タブのマウントを止めてもuseEffect内のSupabaseフェッチが走る可能性があり、ビルド時にライブAPIへ依存させたくない）。テンプレート生成なら対象コンテンツが静的JSONで完結し、ビルドの決定性が保たれる。

### `package.json`の変更

```diff
- "build": "vite build",
+ "build": "vite build && node scripts/generate-ai-snapshots.js",
```

`vercel.json`の`buildCommand`は`npm run build`のままのため変更不要。ビルド成果物（`dist/ai-snapshots/`）はVercelのデプロイにそのまま含まれる。

## `middleware.js` の変更

既存のSNSハブBasic認証ロジックはそのまま維持し、パスによる分岐を追加する。Runtime変更は不要（Edge Runtimeのデフォルトのまま、`rewrite()`のみ使用）。

```js
import { rewrite } from "@vercel/functions";
import { resolveSnapshotPath } from "./src/config/aiCrawlerBots.js"; // 新規、下記参照

export const config = {
  matcher: [
    "/admin/sns-hub",
    "/admin/sns-hub/:path*",
    "/api/admin/sns-hub/:path*",
    "/blog/:path*",
    "/winning-technique",
  ],
};

export default function middleware(request) {
  const url = new URL(request.url);

  if (url.pathname.startsWith("/admin/sns-hub") || url.pathname.startsWith("/api/admin/sns-hub")) {
    return handleSnsHubAuth(request); // 既存のBasic認証ロジックをそのまま関数化
  }

  const snapshotPath = resolveSnapshotPath(url.pathname, request.headers.get("user-agent"));
  if (snapshotPath) {
    return rewrite(new URL(snapshotPath, request.url));
  }

  return; // 通常のSPAフローへ（vercel.jsonのrewriteに委ねる）
}
```

### 新規: `src/config/aiCrawlerBots.js`

対象ボットのUser-Agent文字列リストと、パス→スナップショットファイルの対応ロジックを1箇所にまとめる（`middleware.js`と`verify-ai-snapshots.js`の両方から再利用するため）。

```js
export const AI_CRAWLER_USER_AGENTS = [
  "GPTBot",
  "ClaudeBot",
  "PerplexityBot",
  "Google-Extended",
  "facebookexternalhit",
  "Twitterbot",
];

export function isTargetBot(userAgent) {
  if (!userAgent) return false;
  return AI_CRAWLER_USER_AGENTS.some((ua) => userAgent.includes(ua));
}

export function resolveSnapshotPath(pathname, userAgent) {
  if (!isTargetBot(userAgent)) return null;

  if (pathname === "/winning-technique") {
    return "/ai-snapshots/winning-technique.html";
  }

  const blogMatch = pathname.match(/^\/blog\/([^/]+)$/);
  if (blogMatch) {
    return `/ai-snapshots/blog/${blogMatch[1]}.html`;
  }

  return null;
}
```

ブログ記事が存在しない`id`（404ケース）の場合は、対応するスナップショットファイル自体が存在しないため、Vercelの静的アセット404にフォールバックする（`generate-ai-snapshots.js`が実在する記事のみ生成するため、不整合は起きない）。

## 技術検証（`verify-ai-snapshots.js`）

デプロイ後、`AI_CRAWLER_USER_AGENTS`の代表UA（例: `GPTBot`）を付与したfetchを対象URL全件に対して行い、レスポンスHTMLに`.blog-post-content`相当の実コンテンツ文字列が含まれるかを機械的にチェックする。既存の`scripts/verification/`ディレクトリの規約（検証専用スクリプトの置き場所）に合わせる。

## 効果測定（GA4）

新規スクリプトは作成しない。既存の集客定点観測フロー（`/growth-report`・`/x-growth-report`等と同じ枠組み）でGA4の Referral / AI Assistant チャネルを定点観測する。spec.mdの決定通り閾値は設けず、1〜2週間の定性観測とする。

## 既存機能への影響範囲

| ファイル | 変更種別 |
|---------|---------|
| `middleware.js` | 変更（既存のBasic認証ロジックを関数化し、新規分岐を追加） |
| `package.json` | 変更（`build`スクリプトに1ステップ追加） |
| `scripts/generate-ai-snapshots.js` | 新規 |
| `scripts/verification/verify-ai-snapshots.js` | 新規 |
| `src/config/aiCrawlerBots.js` | 新規 |

通常ユーザー・Googlebot向けの挙動・既存の`vercel.json`rewrite/headers設定への変更は無い。`sitemap.xml`への追加登録も不要（新規URLではなく、既存URLへの応答内容分岐のため）。
