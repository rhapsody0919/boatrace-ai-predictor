# Vercel Preview を Playwright で開く

Preview には Vercel Authentication（Standard Protection）がかかっている。そのまま開くと Vercel のログイン画面へ 302 で飛ばされる。本番（www.boat-ai.jp）と CI の e2e（localhost）は対象外。

自動の確認（`boatrace-fan-reviewer`・`mock-diff-checker` 等）は Protection Bypass for Automation の秘密をヘッダーで送って開く。ヘッダー名は Vercel 公式（[Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)）に従う。

## 守ること

- **秘密の値を表示しない**。console・ログ・報告・スクショ・コミット・PR コメントに出さない。クエリ引数（`?x-vercel-protection-bypass=`）は URL がログに残るので使わない
- **秘密を Codex 側に写さない**。置き場は本体の `.env.local`（Claude 側）だけ。Codex の作業場所・codexlane ユーザー・`/Users/Shared/codex-drop` には置かない。Codex の自己確認で Preview が要るときは Claude 側が代わりに開く
- Preview には本番の管理者キーが入っている。秘密があれば誰でも管理者キー入りの Preview を開けるので、上の2つを破らない

## 秘密の置き場

本体の `.env.local`（`/Users/terukina/boatrace-ai-predictor/.env.local`）の `VERCEL_AUTOMATION_BYPASS_SECRET`。worktree の `.env.local` は本体と別物なので、worktree の中からも本体のパスを読む（下のスクリプトは git の共通ディレクトリから本体を求める）。

## 開き方

ヘッダーは Preview の origin へのリクエストにだけ付ける。`extraHTTPHeaders` はページが出す全リクエスト（Supabase・GA 等の外部）にも秘密を付けるので使わない。`x-vercel-set-bypass-cookie: true` で最初の応答がクッキーを置き、以降の同じ origin のリクエストはクッキーで通る。

スクリプトはスクラッチパッドに置き、リポジトリに残さない。

```js
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const REPO = '<自分の worktree のパス>';
const PREVIEW_URL = '<Preview の URL（ページのパスまで）>';
const require = createRequire(path.join(REPO, 'package.json'));
const { chromium } = require('playwright');

// worktree の .env.local は本体と別物。本体（git の共通ディレクトリの親）の .env.local を読む
const MAIN = path.dirname(execFileSync('git', ['-C', REPO, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim());
const secret = require('dotenv').parse(readFileSync(path.join(MAIN, '.env.local'))).VERCEL_AUTOMATION_BYPASS_SECRET;
if (!secret) throw new Error('本体の .env.local に VERCEL_AUTOMATION_BYPASS_SECRET が無い');

const origin = new URL(PREVIEW_URL).origin;
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  // 秘密は Preview の origin へのリクエストにだけ付ける
  await context.route(`${origin}/**`, (route) =>
    route.continue({
      headers: { ...route.request().headers(), 'x-vercel-protection-bypass': secret, 'x-vercel-set-bypass-cookie': 'true' },
    }),
  );
  const page = await context.newPage();
  const res = await page.goto(PREVIEW_URL, { waitUntil: 'networkidle' });
  // 認証で弾かれると vercel.com のログイン画面に飛ぶ。最終の origin と状態コードの両方で判定する
  if (!res || res.status() !== 200 || new URL(page.url()).origin !== origin) {
    throw new Error(`Preview を開けなかった: status=${res?.status()} url=${new URL(page.url()).origin}`);
  }
  // ここから撮影・DOM の取得
} finally {
  await browser.close();
}
```

- Node は 20 以上で実行する（`~/.nvm/versions/node/v22.*/bin/node` 等。既定の `node` が 16 のことがある）
- `node_modules` が空なら先に `npm ci` を実行する

## 開けなかったとき

秘密が無い・401・302（ログイン画面へ飛ぶ）・最終の origin が Preview と違うときは、推測で埋めずにそこで止まり、「確認できなかった観点」に理由（状態コードと「秘密が無い」等）を書く。秘密の値は書かない。
