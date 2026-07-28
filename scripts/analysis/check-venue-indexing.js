/**
 * 英語venueページのインデックス状況チェック（Search Console URL Inspection API）
 *
 * venue-guide-expansion（24会場）が実際にGoogleにインデックスされているかを確認する。
 * Search Analytics API（search-console-report.js）はインデックス済みで表示実績がある
 * ページしか出てこないため、「まだ表示すらされていない」ページの状況はこちらで見る。
 *
 * 使い方:
 *   node scripts/analysis/check-venue-indexing.js
 *
 * 必要な設定は search-console-report.js と共通（.env.local の SEARCH_CONSOLE_SITE_URL、
 * credentials/google-service-account.json）。
 *
 * 注意: このAPIはインデックス状況の「確認」のみ。通常のHTMLページに対する
 * インデックスの「リクエスト」を行う公開APIはGoogleに存在しない
 * （Indexing APIはJobPosting/BroadcastEvent構造化データを持つページ専用）。
 * 未インデックスのページを早めたい場合は、Search ConsoleのUIから
 * 手動で「インデックス登録をリクエスト」する必要がある。
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { getGoogleAuthClient } from "../lib/googleServiceAuth.js";
import { VENUE_GUIDES_EN } from "../../src/data/venueGuidesEn.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../.env.local") });

const SITE_URL = process.env.SEARCH_CONSOLE_SITE_URL;

if (!SITE_URL) {
  console.error(
    `❌ SEARCH_CONSOLE_SITE_URL が設定されていません（.env.local）。`,
  );
  process.exit(1);
}

const auth = getGoogleAuthClient([
  "https://www.googleapis.com/auth/webmasters.readonly",
]);

const searchconsole = google.searchconsole({ version: "v1", auth });

async function inspectUrl(url) {
  const res = await searchconsole.urlInspection.index.inspect({
    requestBody: {
      inspectionUrl: url,
      siteUrl: SITE_URL,
    },
  });
  return res.data.inspectionResult?.indexStatusResult;
}

async function main() {
  const urls = [
    "https://www.boat-ai.jp/en/venues",
    ...VENUE_GUIDES_EN.map((v) => `https://www.boat-ai.jp/en/venues/${v.slug}`),
  ];

  const results = [];
  for (const url of urls) {
    try {
      const status = await inspectUrl(url);
      results.push({
        url,
        verdict: status?.verdict ?? "UNKNOWN",
        coverageState: status?.coverageState ?? "-",
        lastCrawlTime: status?.lastCrawlTime ?? "-",
        indexingState: status?.indexingState ?? "-",
        robotsTxtState: status?.robotsTxtState ?? "-",
      });
    } catch (err) {
      results.push({ url, error: err.message });
    }
    // Search Console URL Inspection API は 1日あたりのクォータが厳しめのため
    // 念のため間隔を空ける
    await new Promise((r) => setTimeout(r, 300));
  }

  const indexed = results.filter((r) => r.verdict === "PASS");
  const notIndexed = results.filter((r) => r.verdict && r.verdict !== "PASS");

  console.log(`\n## インデックス済み (${indexed.length}/${urls.length})`);
  for (const r of indexed) {
    console.log(`  ✅ ${r.url}  (最終クロール: ${r.lastCrawlTime})`);
  }

  console.log(
    `\n## 未インデックス・要確認 (${notIndexed.length}/${urls.length})`,
  );
  for (const r of notIndexed) {
    if (r.error) {
      console.log(`  ⚠️  ${r.url}  エラー: ${r.error}`);
    } else {
      console.log(
        `  ❌ ${r.url}  verdict:${r.verdict} coverage:${r.coverageState} indexingState:${r.indexingState}`,
      );
    }
  }

  console.log(
    `\n注意: 未インデックスのページを早めたい場合、Search ConsoleのUIから手動で` +
      `「インデックス登録をリクエスト」する必要がある（APIでの一括リクエストは不可）。`,
  );
}

main().catch((err) => {
  if (/has not been used in project|SERVICE_DISABLED/i.test(err.message)) {
    console.error(
      `❌ Google Search Console API が有効になっていません: ${err.message}`,
    );
  } else if (err.code === 403 || /permission/i.test(err.message)) {
    console.error(
      `❌ Search Console へのアクセス権限がありません: ${auth.email}`,
    );
  } else {
    console.error("❌ インデックス状況確認エラー:", err.message);
  }
  process.exit(1);
});
