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

// ブランド名検索クエリの判定（指名検索比率トラッキング用、2026-08-20追加）
// 「ボートレースai」等の一般語+AI検索は指名検索ではないため、ブランド名が
// 一語として連続している形のみをブランドクエリとみなす
// （新ブランド「龍神レーダー」移行後は新表記も追跡し、旧表記からの移行状況を見る）
const OLD_BRAND_PATTERN = /boat\s*ai\b|ボート\s*ai\b|ボートアイ/i;
const NEW_BRAND_PATTERN =
  /龍神\s*レーダー|りゅうじん\s*レーダー|ryujin\s*radar|龍神\s*雷達|용신\s*레이더/i;

function classifyBrandQuery(query) {
  if (NEW_BRAND_PATTERN.test(query)) return "new";
  if (OLD_BRAND_PATTERN.test(query)) return "old";
  return null;
}

// CTR-vs-掲載順位ギャップ分析（2026-08-20追加）
// 業界一般的な順位別平均CTRの目安値（Advanced Web Ranking等の公開データを参考にした概算）。
// 「順位は妥当なのにCTRが低い」→タイトル/メタディスクリプションの問題
// 「CTRは高いのに順位が低い」→コンテンツ自体は検索意図に合っているが、権威（被リンク等）不足の可能性
const CTR_BENCHMARK_BUCKETS = [
  { maxPosition: 1.5, expectedCtr: 0.28 },
  { maxPosition: 2.5, expectedCtr: 0.15 },
  { maxPosition: 3.5, expectedCtr: 0.11 },
  { maxPosition: 4.5, expectedCtr: 0.08 },
  { maxPosition: 5.5, expectedCtr: 0.07 },
  { maxPosition: 10.5, expectedCtr: 0.035 },
  { maxPosition: 20.5, expectedCtr: 0.015 },
  { maxPosition: Infinity, expectedCtr: 0.005 },
];

function expectedCtrForPosition(position) {
  return CTR_BENCHMARK_BUCKETS.find((b) => position <= b.maxPosition)
    .expectedCtr;
}

// 表示回数が少ないと比率のブレが大きくノイズになるため、最低表示回数を設ける
const CTR_GAP_MIN_IMPRESSIONS = 20;

function findCtrGaps(rows) {
  const titleCandidates = [];
  const authorityCandidates = [];
  for (const r of rows) {
    if (r.impressions < CTR_GAP_MIN_IMPRESSIONS) continue;
    const expected = expectedCtrForPosition(r.position);
    const ratio = r.ctr / expected;
    if (ratio < 0.5) {
      titleCandidates.push({ ...r, expected, ratio });
    } else if (ratio > 1.5 && r.position > 10) {
      authorityCandidates.push({ ...r, expected, ratio });
    }
  }
  titleCandidates.sort((a, b) => b.impressions - a.impressions);
  authorityCandidates.sort((a, b) => b.impressions - a.impressions);
  return { titleCandidates, authorityCandidates };
}

// ページ×クエリのクロス集計（2026-08-22追加）
// queryDimensions(["query"])とqueryDimensions(["page"])は別々にしか取得できず、
// 「このページに実際にどのクエリで来ているか」が分からないままtitle/description
// 改善の当てずっぽうになっていた（天才マーケター・エンジニア・ビジネスマンでの
// 議論で発覚した欠陥）。Search Console APIは["query","page"]の複合ディメンションを
// サポートしているため、それを使い対象ページごとの上位クエリを紐付ける
async function queryPageQueryCross(rowLimit) {
  return queryDimensions(["query", "page"], rowLimit);
}

function buildPageQueriesMap(pageQueryRows) {
  const map = new Map();
  for (const r of pageQueryRows) {
    const [query, page] = r.keys;
    if (!map.has(page)) map.set(page, []);
    map.get(page).push({ query, clicks: r.clicks, impressions: r.impressions });
  }
  for (const rows of map.values()) {
    rows.sort((a, b) => b.impressions - a.impressions);
  }
  return map;
}

function printTopQueriesForPages(pages, pageQueriesMap, label) {
  console.log(`\n## ${label}のページ別クエリ内訳（上位3件）`);
  if (pages.length === 0) {
    console.log("  （対象ページなし）");
    return;
  }
  for (const page of pages) {
    const queries = pageQueriesMap.get(page) ?? [];
    console.log(`  ${page}`);
    if (queries.length === 0) {
      console.log("    （クエリ内訳データなし。表示回数が少なすぎる可能性）");
      continue;
    }
    for (const q of queries.slice(0, 3)) {
      console.log(
        `    - ${q.query.padEnd(30)} clicks:${q.clicks} impressions:${q.impressions}`,
      );
    }
  }
}

async function main() {
  // rowLimit=1000: Search Console APIの実測上限（過去30日で数百件程度になることが多い）を
  // 十分にカバーする値。上位20件だけでは「ブランド名系クエリしか見えていない」状態になり、
  // 網羅性を欠くため全件取得する（2026-08-16、ユーザー指摘）
  const allQueries = await queryDimensions(["query"], 1000);
  const topQueries = allQueries.slice(0, 20);
  const topPages = await queryDimensions(["page"], 100);
  const venuePages = topPages.filter((r) => r.keys[0].includes("/venues"));
  const featurePages = topPages.filter((r) =>
    isFeatureOrArticlePage(r.keys[0]),
  );

  // ページ×クエリのクロス集計はrowLimit=2000（クエリ×ページの組み合わせは
  // クエリ単体・ページ単体よりずっと多くなるため大きめに取る）
  const pageQueryRows = await queryPageQueryCross(2000);
  const pageQueriesMap = buildPageQueriesMap(pageQueryRows);

  const today = formatDate(new Date());
  const outDir = path.join(process.cwd(), "data", "analysis", "search-console");

  // 前回レポートを今回の書き込み前に探す（比較対象に自分自身を含めないため）
  const previous = findPreviousReport(outDir, today);

  const queriesWithClicks = allQueries.filter((r) => r.clicks > 0).length;
  console.log(
    `\n## 検索クエリ（過去${DAYS}日、直近3日を除く） 全${allQueries.length}件中クリック実績あり${queriesWithClicks}件`,
  );
  console.log(`\n### クリック数上位20件`);
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
  // 全クエリ（allQueries）を対象にする。前回レポートが旧形式（上位20件のみ保存）の
  // 場合は、その20件としか照合できないため「新規ランクイン」表記が過渡的に増える
  if (previous) {
    const prevQueries = previous.data.allQueries ?? previous.data.topQueries;
    const prevDays = previous.data.days ?? 1;
    const prevClicksTotal = prevQueries.reduce((sum, r) => sum + r.clicks, 0);
    const prevImpressionsTotal = prevQueries.reduce(
      (sum, r) => sum + r.impressions,
      0,
    );
    const currClicksTotal = allQueries.reduce((sum, r) => sum + r.clicks, 0);
    const currImpressionsTotal = allQueries.reduce(
      (sum, r) => sum + r.impressions,
      0,
    );

    const prevClicksPerDay = perDay(prevClicksTotal, prevDays);
    const currClicksPerDay = perDay(currClicksTotal, DAYS);
    const prevImpressionsPerDay = perDay(prevImpressionsTotal, prevDays);
    const currImpressionsPerDay = perDay(currImpressionsTotal, DAYS);

    console.log(
      `\n## 前回レポート（${previous.date}、${prevDays}日間）との比較（全クエリ合計）`,
    );
    console.log(
      `  クリック/日: ${currClicksPerDay.toFixed(1)} (前回 ${prevClicksPerDay.toFixed(1)}、${formatDelta(((currClicksPerDay - prevClicksPerDay) / (prevClicksPerDay || 1)) * 100)}%)`,
    );
    console.log(
      `  表示回数/日: ${currImpressionsPerDay.toFixed(1)} (前回 ${prevImpressionsPerDay.toFixed(1)}、${formatDelta(((currImpressionsPerDay - prevImpressionsPerDay) / (prevImpressionsPerDay || 1)) * 100)}%)`,
    );

    // 全クエリを対象に順位変動を計算し、動きが大きい順にソートして表示する
    // （毎回同じ上位20件のブランドクエリだけでなく、実際に動いたクエリを網羅的に拾う）
    const prevQueryMap = new Map(prevQueries.map((r) => [r.keys[0], r]));
    const movers = [];
    const newEntries = [];
    for (const r of allQueries) {
      if (r.clicks === 0 && r.impressions < 10) continue; // ノイズ除外（実績がほぼ無いクエリ）
      const prevRow = prevQueryMap.get(r.keys[0]);
      if (!prevRow) {
        newEntries.push(r);
        continue;
      }
      movers.push({
        query: r.keys[0],
        position: r.position,
        delta: r.position - prevRow.position,
      });
    }
    movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    console.log(
      `\n  順位変動が大きいクエリ 上位15件（+は下落、-は上昇。実績のあるクエリ${movers.length}件中）:`,
    );
    if (movers.length === 0) {
      console.log("  （比較可能なクエリがありません）");
    }
    for (const m of movers.slice(0, 15)) {
      console.log(
        `    ${m.query.padEnd(40)} position:${m.position.toFixed(1)} (${formatDelta(m.delta)}pt)`,
      );
    }

    if (newEntries.length > 0) {
      console.log(
        `\n  新規ランクイン（実績のあるクエリのみ、上位10件、全${newEntries.length}件中）:`,
      );
      newEntries
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, 10)
        .forEach((r) => {
          console.log(
            `    ${r.keys[0].padEnd(40)} position:${r.position.toFixed(1)} clicks:${r.clicks}`,
          );
        });
    }
  } else {
    console.log(
      `\n## 前回レポートとの比較\n  （比較対象となる過去レポートが見つかりません。次回実行時から比較が有効になります）`,
    );
  }

  // 指名検索（ブランド名クエリ）比率トラッキング（2026-08-20追加、BoatAI→龍神レーダーのリブランド監視用）
  // 「ボートレースai」等の一般語+AI検索は含めない（classifyBrandQuery参照）
  let oldBrandClicks = 0;
  let newBrandClicks = 0;
  let oldBrandImpressions = 0;
  let newBrandImpressions = 0;
  for (const r of allQueries) {
    const kind = classifyBrandQuery(r.keys[0]);
    if (kind === "old") {
      oldBrandClicks += r.clicks;
      oldBrandImpressions += r.impressions;
    } else if (kind === "new") {
      newBrandClicks += r.clicks;
      newBrandImpressions += r.impressions;
    }
  }
  const totalClicks = allQueries.reduce((sum, r) => sum + r.clicks, 0);
  const brandShare =
    totalClicks > 0
      ? ((oldBrandClicks + newBrandClicks) / totalClicks) * 100
      : 0;
  console.log(`\n## 指名検索（ブランド名クエリ）比率`);
  console.log(
    `  旧ブランド名（BoatAI系）: クリック${oldBrandClicks} / 表示回数${oldBrandImpressions}`,
  );
  console.log(
    `  新ブランド名（龍神レーダー系）: クリック${newBrandClicks} / 表示回数${newBrandImpressions}`,
  );
  console.log(
    `  指名検索が全クリックに占める割合: ${brandShare.toFixed(1)}%（全クリック${totalClicks}件中）`,
  );
  if (previous) {
    const prevQueries = previous.data.allQueries ?? previous.data.topQueries;
    let prevOldBrandClicks = 0;
    let prevNewBrandClicks = 0;
    for (const r of prevQueries) {
      const kind = classifyBrandQuery(r.keys[0]);
      if (kind === "old") prevOldBrandClicks += r.clicks;
      else if (kind === "new") prevNewBrandClicks += r.clicks;
    }
    console.log(
      `  前回比: 旧ブランド ${formatDelta(oldBrandClicks - prevOldBrandClicks, 0)}件、新ブランド ${formatDelta(newBrandClicks - prevNewBrandClicks, 0)}件`,
    );
  }

  // CTR-vs-掲載順位ギャップ分析（2026-08-20追加）
  const { titleCandidates, authorityCandidates } = findCtrGaps(topPages);
  console.log(
    `\n## CTR-vs-掲載順位ギャップ（表示回数${CTR_GAP_MIN_IMPRESSIONS}以上のページが対象）`,
  );
  console.log(
    `  タイトル/メタディスクリプション改善候補（順位相応のCTR目安の半分未満）:`,
  );
  if (titleCandidates.length === 0) {
    console.log("  （該当なし）");
  }
  for (const c of titleCandidates.slice(0, 10)) {
    console.log(
      `    ${c.keys[0].padEnd(60)} position:${c.position.toFixed(1)} ctr:${(c.ctr * 100).toFixed(2)}% (目安${(c.expected * 100).toFixed(1)}%)`,
    );
  }
  console.log(
    `\n  権威・被リンク不足の可能性（CTRは目安の1.5倍超だが順位10位より下）:`,
  );
  if (authorityCandidates.length === 0) {
    console.log("  （該当なし）");
  }
  for (const c of authorityCandidates.slice(0, 10)) {
    console.log(
      `    ${c.keys[0].padEnd(60)} position:${c.position.toFixed(1)} ctr:${(c.ctr * 100).toFixed(2)}% (目安${(c.expected * 100).toFixed(1)}%)`,
    );
  }

  // タイトル/メタ改善候補ページの実際の検索クエリを紐付ける（当てずっぽうでの
  // title書き換えを防ぐ。上位5件のみ、CTR改善作業で直接使う想定）
  printTopQueriesForPages(
    titleCandidates.slice(0, 5).map((c) => c.keys[0]),
    pageQueriesMap,
    "タイトル/メタディスクリプション改善候補",
  );

  // JSON 保存（推移比較用）
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `report-${today}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        days: DAYS,
        allQueries,
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
