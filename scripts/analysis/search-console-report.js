/**
 * Search Console 検索パフォーマンスレポート（BOA-140）
 *
 * Google Search Console API から検索クエリ・ページ別の掲載順位・クリック率を取得し、
 * venue-guide-expansion（会場別ビジターガイド全会場化）等のSEO施策の効果測定に使う。
 *
 * 使い方:
 *   node scripts/analysis/search-console-report.js [--days=30]
 *
 * 必要な設定:
 *   SEARCH_CONSOLE_SITE_URL（.env.local）- Search Console に登録したプロパティURL
 *   サービスアカウント認証 - credentials/google-service-account.json
 *     （GA4連携と共用。GOOGLE_SERVICE_ACCOUNT_KEY_PATH で変更可能）
 *
 * セットアップ手順は docs/operation/search-console-report.md を参照
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { getGoogleAuthClient } from "../lib/googleServiceAuth.js";
import {
  findPreviousReport,
  perDay,
  formatDelta,
} from "../lib/reportComparison.js";

// .env.local を読み込む（プロジェクト共通パターン: scripts/lib/supabaseClient.js と同様）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../.env.local") });

const DAYS = parseInt(
  (process.argv.find((a) => a.startsWith("--days=")) || "--days=30").split(
    "=",
  )[1],
  10,
);
const SITE_URL = process.env.SEARCH_CONSOLE_SITE_URL;

if (!SITE_URL) {
  console.error(`❌ SEARCH_CONSOLE_SITE_URL が設定されていません。

.env.local に追加してください:
  SEARCH_CONSOLE_SITE_URL=https://www.boat-ai.jp/  # Search Console に登録したプロパティURL（末尾スラッシュ必須）

詳細: docs/operation/search-console-report.md`);
  process.exit(1);
}

// サービスアカウント認証（i18n-demand-report.js と同じ方式、BOA-139で共通化）
const auth = getGoogleAuthClient([
  "https://www.googleapis.com/auth/webmasters.readonly",
]);

const searchconsole = google.searchconsole({ version: "v1", auth });

function formatDate(d) {
  return d.toISOString().split("T")[0];
}

// Search Consoleは直近2-3日分のデータが未確定のため、集計対象から除外する
async function queryDimensions(dimensions, rowLimit) {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 3);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - DAYS);

  const res = await searchconsole.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody: {
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      dimensions,
      rowLimit,
    },
  });
  return res.data.rows ?? [];
}

function printRows(rows, keyWidth) {
  if (rows.length === 0) {
    console.log("  （データなし）");
    return;
  }
  for (const r of rows) {
    console.log(
      `  ${r.keys[0].padEnd(keyWidth)} clicks:${String(r.clicks).padStart(4)} impressions:${String(r.impressions).padStart(6)} ctr:${(r.ctr * 100).toFixed(2)}% position:${r.position.toFixed(1)}`,
    );
  }
}

// 新機能記事・分析ツール関連ページ（/growth-report・/growth-pdcaで毎回確認する対象）
function isFeatureOrArticlePage(url) {
  return /\/winning-technique(\?|$)/.test(url) || /\/blog\/.*-guide/.test(url);
}

async function main() {
  const topQueries = await queryDimensions(["query"], 20);
  const topPages = await queryDimensions(["page"], 100);
  const venuePages = topPages.filter((r) => r.keys[0].includes("/venues"));
  const featurePages = topPages.filter((r) =>
    isFeatureOrArticlePage(r.keys[0]),
  );

  const today = formatDate(new Date());
  const outDir = path.join(process.cwd(), "data", "analysis", "search-console");

  // 前回レポートを今回の書き込み前に探す（比較対象に自分自身を含めないため）
  const previous = findPreviousReport(outDir, today);

  console.log(`\n## 検索クエリ上位（過去${DAYS}日、直近3日を除く）`);
  printRows(topQueries, 40);

  console.log(`\n## ページ別の検索パフォーマンス上位`);
  printRows(topPages.slice(0, 20), 60);

  console.log(`\n## 会場ガイドページ（/venues配下）の検索パフォーマンス`);
  printRows(venuePages, 60);

  console.log(
    `\n## 新機能記事・分析ツール（/winning-technique・/blog/*-guide配下）の検索パフォーマンス`,
  );
  printRows(featurePages, 60);
  if (featurePages.length === 0) {
    console.log(
      "  ※ 上位100ページ圏外の可能性あり。表示回数1桁でも公開直後は正常（SEO効果は2〜4週間のタイムラグ）",
    );
  }

  // 前回レポートとの比較（日割り正規化 + クエリ順位変動）
  if (previous) {
    const prevDays = previous.data.days ?? 1;
    const prevClicksTotal = previous.data.topQueries.reduce(
      (sum, r) => sum + r.clicks,
      0,
    );
    const prevImpressionsTotal = previous.data.topQueries.reduce(
      (sum, r) => sum + r.impressions,
      0,
    );
    const currClicksTotal = topQueries.reduce((sum, r) => sum + r.clicks, 0);
    const currImpressionsTotal = topQueries.reduce(
      (sum, r) => sum + r.impressions,
      0,
    );

    const prevClicksPerDay = perDay(prevClicksTotal, prevDays);
    const currClicksPerDay = perDay(currClicksTotal, DAYS);
    const prevImpressionsPerDay = perDay(prevImpressionsTotal, prevDays);
    const currImpressionsPerDay = perDay(currImpressionsTotal, DAYS);

    console.log(
      `\n## 前回レポート（${previous.date}、${prevDays}日間）との比較`,
    );
    console.log(
      `  トップ${topQueries.length}クエリ合計 クリック/日: ${currClicksPerDay.toFixed(1)} (前回 ${prevClicksPerDay.toFixed(1)}、${formatDelta(((currClicksPerDay - prevClicksPerDay) / (prevClicksPerDay || 1)) * 100)}%)`,
    );
    console.log(
      `  トップ${topQueries.length}クエリ合計 表示回数/日: ${currImpressionsPerDay.toFixed(1)} (前回 ${prevImpressionsPerDay.toFixed(1)}、${formatDelta(((currImpressionsPerDay - prevImpressionsPerDay) / (prevImpressionsPerDay || 1)) * 100)}%)`,
    );

    console.log(`\n  クエリ別の順位変動（+は下落、-は上昇）:`);
    const prevQueryMap = new Map(
      previous.data.topQueries.map((r) => [r.keys[0], r]),
    );
    for (const r of topQueries) {
      const prevRow = prevQueryMap.get(r.keys[0]);
      if (!prevRow) {
        console.log(
          `    ${r.keys[0].padEnd(40)} position:${r.position.toFixed(1)} (新規ランクイン)`,
        );
        continue;
      }
      const delta = r.position - prevRow.position;
      console.log(
        `    ${r.keys[0].padEnd(40)} position:${r.position.toFixed(1)} (${formatDelta(delta)}pt)`,
      );
    }
  } else {
    console.log(
      `\n## 前回レポートとの比較\n  （比較対象となる過去レポートが見つかりません。次回実行時から比較が有効になります）`,
    );
  }

  // JSON 保存（推移比較用）
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `report-${today}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        days: DAYS,
        topQueries,
        topPages,
        venuePages,
        featurePages,
      },
      null,
      2,
    ),
  );

  console.log(`\n💾 保存: ${outPath}`);
  console.log(
    `\n判断の目安: /venues配下ページのOrganic Search掲載順位・CTRの推移から、会場ガイド拡充の効果を確認する`,
  );
}

main().catch((err) => {
  // SERVICE_DISABLED は「Search Console の権限」ではなく「GCPプロジェクトでAPI自体が
  // 未有効化」というまったく別の原因。/permission/i だけで判定すると誤判定するため、
  // 先にこちらを判定する（実際にこの誤判定でハマった経緯があるため要注意）
  if (/has not been used in project|SERVICE_DISABLED/i.test(err.message)) {
    console.error(`❌ Google Search Console API が有効になっていません。

以下のURLでAPIを有効化してください（有効化後、反映まで数分かかる場合があります）:
  ${err.message.match(/https:\/\/\S+/)?.[0] ?? "https://console.developers.google.com/apis/library/searchconsole.googleapis.com"}`);
  } else if (err.code === 403 || /permission/i.test(err.message)) {
    console.error(`❌ Search Console へのアクセス権限がありません。

Search Console の「設定 > ユーザーと権限」で以下を「制限付き」ユーザーとして追加してください
（GA4のIAM閲覧者権限とは付与画面・権限モデルが異なります）:
  ${auth.email}`);
  } else {
    console.error("❌ レポート生成エラー:", err.message);
  }
  process.exit(1);
});
