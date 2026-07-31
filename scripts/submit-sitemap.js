/**
 * Search Console へのsitemap再送信（BOA-152関連: SEO未対応の是正）
 *
 * sitemap.xml更新のたびにGoogleへ再クロールを促す。個々の新規ページの
 * 即時インデックス登録を保証するものではないが、Googleが公式にサポートする
 * 正規の手段（Indexing APIの求人/ライブ配信専用縛りとは異なる）。
 *
 * 使い方:
 *   node scripts/submit-sitemap.js
 *
 * 必要な設定:
 *   SEARCH_CONSOLE_SITE_URL（.env.local）- search-console-report.js と共用
 *   サービスアカウントに Search Console で「フル」権限が必要
 *     （読み取り専用の「制限付き」権限では書き込み系APIが権限エラーになる。
 *     docs/operation/search-console-report.md の「制限付き」設定から変更が必要）
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { getGoogleAuthClient } from "./lib/googleServiceAuth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env.local") });

const SITE_URL = "https://www.boat-ai.jp";
const SEARCH_CONSOLE_SITE_URL = process.env.SEARCH_CONSOLE_SITE_URL;

if (!SEARCH_CONSOLE_SITE_URL) {
  console.error(`❌ SEARCH_CONSOLE_SITE_URL が設定されていません。
.env.local に追加してください（search-console-report.js と共用）。
詳細: docs/operation/search-console-report.md`);
  process.exit(1);
}

const auth = getGoogleAuthClient([
  "https://www.googleapis.com/auth/webmasters",
]);
const webmasters = google.webmasters({ version: "v3", auth });

async function main() {
  const feedpath = `${SITE_URL}/sitemap.xml`;
  await webmasters.sitemaps.submit({
    siteUrl: SEARCH_CONSOLE_SITE_URL,
    feedpath,
  });
  console.log(`✅ sitemap再送信を送信しました: ${feedpath}`);
}

main().catch((err) => {
  if (err.code === 403 || /permission|forbidden/i.test(err.message)) {
    console.error(`❌ Search Console への書き込み権限がありません。

サービスアカウントの権限が「制限付き（読み取り専用）」のままの可能性があります。
Search Console の「設定 > ユーザーと権限」で、以下のアカウントを「フル」権限に変更してください:
  ${auth.email}

（search-console-report.js の読み取り専用用途とは異なり、sitemap再送信には書き込み権限が必要です）`);
  } else {
    console.error("❌ sitemap再送信エラー:", err.message);
  }
  process.exit(1);
});
