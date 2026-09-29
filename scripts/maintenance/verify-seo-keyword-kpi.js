#!/usr/bin/env node
/**
 * scripts/lib/seoKeywordKpi.js（SEOワード戦略のKPI集計）の判定を固定の入力で検証する。
 *
 * クラスタ分けが崩れると、旧名系（リブランドで CTR が落ちたクエリ）と一般の
 * AI予想クエリが混ざり、施策の効果を取り違える。週の丸めがずれると、施策の
 * 投入日の前後比較が1週ずれる。
 */

import {
  classifyQuery,
  landingSplit,
  summarizeClusters,
  trackedQueryWeekly,
  weekStartOf,
  weeklySeries,
} from "../lib/seoKeywordKpi.js";

const failures = [];
let checked = 0;

function check(label, actual, expected) {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
  }
}

const row = (keys, clicks, impressions, position) => ({
  keys,
  clicks,
  impressions,
  ctr: impressions ? clicks / impressions : 0,
  position,
});

// --- クラスタ分け ---
const cases = [
  ["龍神レーダー", "new_brand"],
  ["龍神 レーダー 予想", "new_brand"],
  ["boatai", "old_brand"],
  ["boat ai", "old_brand"],
  ["ボートai", "old_brand"],
  ["ボート ai予想", "old_brand"],
  ["ボートアイ", "old_brand"],
  ["ぼーとあい", "old_brand"],
  // 8/20 以降に順位そのままで CTR が落ちた、旧title と語が一致するクエリ
  ["ボートレースai", "old_brand"],
  ["ボートレース ai", "old_brand"],
  ["ボートレースai予想", "old_brand"],
  // 語が足されたものは一般の AI予想として扱う
  ["ボートレースai予想アプリ", "ai_general"],
  ["ボートレース予想ai", "ai_general"],
  ["競艇ai予想 無料", "ai_general"],
  ["競艇ai", "ai_general"],
  ["競艇a i", "ai_general"],
  ["桐生競艇予想 ai", "venue_ai"],
  ["常滑競艇予想ai", "venue_ai"],
  ["津競艇 ai予想", "venue_ai"],
  // 「津」は1文字なので、他の語の一部では会場とみなさない
  ["津々浦々 ai", "ai_general"],
  // 公式の場名表記「ボートレース津」も会場として拾う（code-review 指摘）
  ["ボートレース津 ai予想", "venue_ai"],
  ["競艇 荒れるレース 今日", "today"],
  ["本日のボートレース 無料予想", "today"],
  ["競艇 全レース予想 無料", "prediction"],
  ["競艇予想", "prediction"],
  ["スジ舟券", "other"],
  ["競艇 オッズ 見方", "other"],
  ["kyotei", "other"],
  // 英単語の一部の ai（rain・main・training）は AI と数えない（code-review 指摘）
  ["boat race training", "other"],
  ["kyotei main event", "other"],
  ["aiボート", "ai_general"],
  ["ai 競艇予想", "ai_general"],
];
for (const [q, expected] of cases)
  check(`classify「${q}」`, classifyQuery(q), expected);

// --- 週の丸め（月曜始まり、UTCで計算） ---
check("月曜はその日", weekStartOf("2026-09-21"), "2026-09-21");
check("日曜は前の月曜", weekStartOf("2026-09-27"), "2026-09-21");
check("月跨ぎ", weekStartOf("2026-09-02"), "2026-08-31");
check("年跨ぎ", weekStartOf("2027-01-01"), "2026-12-28");
let threw = false;
try {
  weekStartOf("not-a-date");
} catch {
  threw = true;
}
check("不正な日付は例外", threw, true);

// --- 週次集計（順位は表示回数で重み付け、週の日数を持つ） ---
const weekly = weeklySeries([
  row(["2026-09-20"], 1, 10, 4), // 日曜 → 9/14週
  row(["2026-09-21"], 2, 10, 6),
  row(["2026-09-22"], 0, 30, 10),
]);
check(
  "週次: 週の並びと日数",
  weekly.map((w) => [w.week, w.days]),
  [
    ["2026-09-14", 1],
    ["2026-09-21", 2],
  ],
);
check("週次: クリック合計", weekly[1].clicks, 2);
check("週次: 表示合計", weekly[1].impressions, 40);
check("週次: 順位は表示加重", weekly[1].position, (6 * 10 + 10 * 30) / 40);
check("週次: CTR", weekly[1].ctr, 2 / 40);

// --- 追跡クエリ（query×date から対象語だけ） ---
const tracked = trackedQueryWeekly(
  [
    row(["ボートai", "2026-09-21"], 3, 50, 5),
    row(["ボートai", "2026-09-23"], 1, 50, 7),
    row(["競艇予想", "2026-09-21"], 9, 99, 40),
  ],
  ["ボートai", "龍神レーダー"],
);
check("追跡: 対象語だけ", Object.keys(tracked), ["ボートai", "龍神レーダー"]);
check("追跡: 週にまとまる", tracked["ボートai"].length, 1);
check("追跡: 同週の合計", tracked["ボートai"][0].clicks, 4);
check("追跡: データ無しは空配列", tracked["龍神レーダー"], []);

// --- クラスタ合計 ---
const clusters = summarizeClusters([
  row(["ボートai"], 10, 100, 5),
  row(["ボートレースai"], 2, 100, 7),
  row(["競艇ai"], 5, 200, 6),
]);
check("クラスタ: 旧名系の合算", clusters.old_brand.clicks, 12);
check("クラスタ: 旧名系の語数", clusters.old_brand.queries, 2);
check("クラスタ: 旧名系の順位", clusters.old_brand.position, 6);
check("クラスタ: 一般AI", clusters.ai_general.impressions, 200);
check("クラスタ: 該当なしは順位null", clusters.today.position, null);

// --- 着地ページ ---
const O = "https://www.boat-ai.jp";
const landing = landingSplit([
  row([`${O}/`], 100, 1000, 8),
  row([`${O}/venue/12`], 3, 50, 9),
  row([`${O}/today`], 1, 10, 12),
  row([`${O}/blog/rough-race-signals#toc-heading-0`], 2, 40, 7),
  row([`${O}/en/`], 1, 30, 11),
  row([`${O}/accuracy`], 4, 20, 6),
  row([`${O}/venues`], 0, 5, 20), // /venue/:code ではない
]);
check("着地: トップ", landing.root.clicks, 100);
check("着地: 会場ページ", landing.venue.clicks, 3);
check("着地: /today", landing.today.clicks, 1);
check("着地: ブログ（アンカー付きも）", landing.blog.clicks, 2);
check("着地: 多言語", landing.i18n.clicks, 1);
check("着地: その他の日本語", landing.otherJa.impressions, 25);
check("着地: トップ以外の絶対数", landing.nonRootClicks, 11);

if (failures.length > 0) {
  console.error(
    `❌ verify-seo-keyword-kpi: ${failures.length}/${checked} 件失敗`,
  );
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✅ verify-seo-keyword-kpi: ${checked} 件すべて通過`);
