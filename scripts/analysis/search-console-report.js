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
import {
  CLUSTER_LABELS,
  TRACKED_QUERIES,
  landingSplit,
  summarizeClusters,
  trackedQueryWeekly,
  weekStartOf,
  weeklySeries,
} from "../lib/seoKeywordKpi.js";
import {
  printRows,
  isFeatureOrArticlePage,
  buildPageQueriesMap,
  printTopQueriesForPages,
  printQueryMovers,
  printBrandShare,
  printCtrGaps,
} from "./searchConsoleReportPrint.js";

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
function dateWindow(days) {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 3);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);
  return { startDate: formatDate(startDate), endDate: formatDate(endDate) };
}

// requireComplete: 全件が要る集計（KPI）で使う。上限ちょうどで返ってきたら取りこぼしなので止める。
// 既存の「上位N件だけ見る」呼び出し（topPages 等）は上限で切れるのが仕様なので false のまま
async function queryDimensions(
  dimensions,
  rowLimit,
  { days = DAYS, requireComplete = false } = {},
) {
  const { startDate, endDate } = dateWindow(days);

  const res = await searchconsole.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody: {
      startDate,
      endDate,
      dimensions,
      rowLimit,
    },
  });
  const rows = res.data.rows ?? [];
  if (requireComplete && rows.length === rowLimit) {
    throw new Error(
      `Search Console の取得行数が上限（${rowLimit}）に達しました（dimensions=${dimensions.join(",")}）。rowLimit を上げるかページングを実装してください`,
    );
  }
  return rows;
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

// SEOワード戦略のKPI（集客レーン、2026-09-29。docs/operation/search-console-report.md「SEOワード戦略のKPI」）
// 8/31以降の週次を基準にし、施策は投入日（seo-measures.json）の前後の週で比べる
const KPI_WEEKS = 12;
const KPI_ROW_LIMIT = 25000;
const MEASURES_PATH = path.join(
  process.cwd(),
  "data",
  "analysis",
  "search-console",
  "seo-measures.json",
);

function loadMeasures() {
  if (!fs.existsSync(MEASURES_PATH)) return [];
  const parsed = JSON.parse(fs.readFileSync(MEASURES_PATH, "utf8"));
  if (!Array.isArray(parsed.entries)) {
    throw new Error(`${MEASURES_PATH} に entries 配列がありません`);
  }
  return parsed.entries;
}

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const pos = (v) => (v === null ? "-" : v.toFixed(1));

async function buildSeoKpi() {
  const kpiDays = KPI_WEEKS * 7;
  const opts = { days: kpiDays, requireComplete: true };
  const [dateRows, queryDateRows, queryRows, pageRows] = await Promise.all([
    queryDimensions(["date"], KPI_ROW_LIMIT, opts),
    queryDimensions(["query", "date"], KPI_ROW_LIMIT, opts),
    queryDimensions(["query"], KPI_ROW_LIMIT, { requireComplete: true }),
    queryDimensions(["page"], KPI_ROW_LIMIT, { requireComplete: true }),
  ]);
  const measures = loadMeasures();
  const siteWeekly = weeklySeries(dateRows, 0);
  const tracked = trackedQueryWeekly(queryDateRows, TRACKED_QUERIES);
  const clusters = summarizeClusters(queryRows);
  const landing = landingSplit(pageRows);
  const namedClicks = queryRows.reduce((sum, r) => sum + r.clicks, 0);
  // クラスタ集計（過去DAYS日）と同じ期間のサイト合計。匿名化クエリの比率を見るために出す
  const { startDate: clusterStart } = dateWindow(DAYS);
  const totalClicks = dateRows
    .filter((r) => r.keys[0] >= clusterStart)
    .reduce((sum, r) => sum + r.clicks, 0);

  const measuresByWeek = new Map();
  for (const m of measures) {
    const w = weekStartOf(m.date);
    if (!measuresByWeek.has(w)) measuresByWeek.set(w, []);
    measuresByWeek.get(w).push(m.id);
  }
  // 集計期間の端の週は7日に満たない。主要クエリの週次で前後比較するときに誤読しないよう印を付ける
  const partialWeeks = new Set(
    siteWeekly.filter((w) => w.days < 7).map((w) => w.week),
  );
  const partial = (week) => (partialWeeks.has(week) ? "（7日未満の週）" : "");
  const mark = (week) =>
    measuresByWeek.has(week)
      ? `  ← ${measuresByWeek.get(week).join(", ")}`
      : "";

  console.log(`\n## SEOワード戦略のKPI（直近${KPI_WEEKS}週、週は月曜始まり）`);
  console.log(`\n### サイト全体（週次）`);
  for (const w of siteWeekly) {
    console.log(
      `  ${w.week}（${w.days}日） クリック/日:${(w.clicks / w.days).toFixed(1).padStart(6)} 表示/日:${(w.impressions / w.days).toFixed(0).padStart(6)} CTR:${pct(w.ctr).padStart(6)} 順位:${pos(w.position)}${mark(w.week)}`,
    );
  }

  console.log(`\n### 主要クエリ（週次。KPIはこの単位で判定する）`);
  for (const [query, series] of Object.entries(tracked)) {
    console.log(`  ${query}`);
    if (series.length === 0) {
      console.log("    （データなし）");
      continue;
    }
    for (const w of series) {
      console.log(
        `    ${w.week} クリック:${String(w.clicks).padStart(4)} 表示:${String(w.impressions).padStart(5)} CTR:${pct(w.ctr).padStart(6)} 順位:${pos(w.position)}${partial(w.week)}${mark(w.week)}`,
      );
    }
  }

  console.log(
    `\n### クエリのクラスタ（過去${DAYS}日。名前の出るクエリのクリック ${namedClicks} / サイト合計 ${totalClicks}）`,
  );
  for (const [key, c] of Object.entries(clusters)) {
    console.log(
      `  ${CLUSTER_LABELS[key].padEnd(28)} クリック:${String(c.clicks).padStart(5)} 表示:${String(c.impressions).padStart(6)} CTR:${pct(c.ctr).padStart(6)} 順位:${pos(c.position)} 語数:${c.queries}`,
    );
  }

  console.log(`\n### 着地ページ（過去${DAYS}日、絶対数）`);
  const landingLabels = {
    root: "トップ /",
    venue: "会場ページ /venue/*",
    racer: "選手ページ /racer/*",
    today: "/today",
    blog: "ブログ /blog/*",
    otherJa: "その他の日本語ページ",
    i18n: "多言語 /en・/ko・/zh-TW",
  };
  for (const [key, label] of Object.entries(landingLabels)) {
    const g = landing[key];
    console.log(
      `  ${label.padEnd(24)} クリック:${String(g.clicks).padStart(5)} 表示:${String(g.impressions).padStart(6)} 順位:${pos(g.position)}`,
    );
  }
  console.log(`  トップ以外の着地クリック: ${landing.nonRootClicks}`);

  return {
    weeks: KPI_WEEKS,
    namedClicks,
    totalClicks,
    siteWeekly,
    trackedQueries: tracked,
    clusters,
    landing,
    measures,
  };
}

function printQuerySections(
  allQueries,
  topQueries,
  topPages,
  venuePages,
  featurePages,
) {
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
}

// 前回レポートとの比較（日割り正規化 + クエリ順位変動）
// 全クエリ（allQueries）を対象にする。前回レポートが旧形式（上位20件のみ保存）の
// 場合は、その20件としか照合できないため「新規ランクイン」表記が過渡的に増える
function printPreviousComparison(previous, allQueries) {
  if (!previous) {
    console.log(
      `\n## 前回レポートとの比較\n  （比較対象となる過去レポートが見つかりません。次回実行時から比較が有効になります）`,
    );
    return;
  }
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

  printQueryMovers(prevQueries, allQueries);
}

// JSON 保存（推移比較用）
function saveReport(outDir, today, report) {
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `report-${today}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), days: DAYS, ...report },
      null,
      2,
    ),
  );

  console.log(`\n💾 保存: ${outPath}`);
  console.log(
    `\n判断の目安: /venues配下ページのOrganic Search掲載順位・CTRの推移から、会場ガイド拡充の効果を確認する`,
  );
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

  printQuerySections(
    allQueries,
    topQueries,
    topPages,
    venuePages,
    featurePages,
  );
  printPreviousComparison(previous, allQueries);
  printBrandShare(allQueries, previous);
  const titleCandidates = printCtrGaps(topPages);

  // タイトル/メタ改善候補ページの実際の検索クエリを紐付ける（当てずっぽうでの
  // title書き換えを防ぐ。上位5件のみ、CTR改善作業で直接使う想定）
  printTopQueriesForPages(
    titleCandidates.slice(0, 5).map((c) => c.keys[0]),
    pageQueriesMap,
    "タイトル/メタディスクリプション改善候補",
  );

  const seoKpi = await buildSeoKpi();

  saveReport(outDir, today, {
    allQueries,
    topQueries,
    topPages,
    venuePages,
    featurePages,
    seoKpi,
  });
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
