/**
 * SEOワード戦略のKPI集計（集客レーン、2026-09-29）
 *
 * search-console-report.js から呼ぶ純関数だけを置く。API呼び出しはしない。
 * 判定を scripts/maintenance/verify-seo-keyword-kpi.js で固定の入力で検証している。
 *
 * 背景（2026-09-29 の調査で判明した計測上の罠）:
 * - 8/20 のリブランドで title から旧名「BoatAI（ボートアイ）」が消え、旧名系クエリ
 *   （ボートai・ボートレースai 等）だけ CTR が約1/3に落ちた。一般のAI予想クエリと
 *   混ぜると施策の効果が読めないため、旧名系を別クラスタに分ける
 * - 匿名化クエリの比率が期間で 61〜75% と動くため、クラスタ合計より
 *   主要クエリ単位の週次で判定する（TRACKED_QUERIES）
 * - 7〜8月は英語版がインデックスされていたバグの谷。比較は施策の投入日
 *   （data/analysis/search-console/seo-measures.json）の前後の週で行う
 */

// 旧名系: 旧title「BoatAI（ボートアイ）- AIボートレース予想」と語が一致していたクエリ。
// ボートレースai は一般語にも見えるが、8/20 を境に順位そのままで CTR が 16〜22% → 1〜2% に
// 落ちており、旧title目当ての検索として扱う
const OLD_BRAND_PATTERN =
  /boat\s*ai\b|ボート\s*ai|ボートアイ|ぼーとあい|ボートあい|^ボートレース\s*ai(\s*予想)?$/i;
const NEW_BRAND_PATTERN =
  /龍神\s*レーダー|りゅうじん\s*レーダー|ryujin\s*radar|龍神\s*雷達|용신\s*레이더/i;

// 24場（src/locales/ja/common.json の venues と同じ表記。からつ・びわこの別表記も拾う）
const VENUE_NAMES = [
  "桐生",
  "戸田",
  "江戸川",
  "平和島",
  "多摩川",
  "浜名湖",
  "蒲郡",
  "常滑",
  "津",
  "三国",
  "びわこ",
  "琵琶湖",
  "住之江",
  "尼崎",
  "鳴門",
  "丸亀",
  "児島",
  "宮島",
  "徳山",
  "下関",
  "若松",
  "芦屋",
  "福岡",
  "唐津",
  "からつ",
  "大村",
];

// 英単語の一部（rain・main・training）に当たらないよう、ai の前後に英字が続く形は除く
const AI_PATTERN =
  /(^|[^a-z])ai($|[^a-z])|ａｉ|(^|[^a-z])a\s+i($|[^a-z])|えーあい|エーアイ/i;
const TODAY_PATTERN = /今日|本日|きょう/;
const PREDICTION_PATTERN = /予想|予測|無料|当たる|的中|全\s*レース/;

/**
 * クエリをクラスタに分ける。判定順が意味を持つ（先に当たったものを採る）。
 * @param {string} query
 * @returns {"new_brand"|"old_brand"|"venue_ai"|"today"|"ai_general"|"prediction"|"other"}
 */
export function classifyQuery(query) {
  const q = query.toLowerCase().replace(/\s+/g, " ").trim();
  if (NEW_BRAND_PATTERN.test(q)) return "new_brand";
  if (OLD_BRAND_PATTERN.test(q)) return "old_brand";
  // 津 は1文字で他の語に混ざりやすいため、会場判定は「津」単独の語か「津競艇」「ボートレース津」等の形に限る
  const hasVenue = VENUE_NAMES.some((v) =>
    v === "津"
      ? /(^|\s|ボートレース)津(\s|競艇|ボート|$)/.test(q)
      : q.includes(v),
  );
  if (hasVenue && AI_PATTERN.test(q)) return "venue_ai";
  if (TODAY_PATTERN.test(q)) return "today";
  if (AI_PATTERN.test(q)) return "ai_general";
  if (PREDICTION_PATTERN.test(q)) return "prediction";
  return "other";
}

export const CLUSTER_LABELS = {
  new_brand: "新ブランド（龍神レーダー）",
  old_brand: "旧名系（BoatAI・ボートai・ボートレースai）",
  venue_ai: "会場名×AI予想",
  today: "今日系（今日・本日）",
  ai_general: "AI予想一般（旧名系を除く）",
  prediction: "予想（非AI）・無料",
  other: "その他（用語・データ・英語等）",
};

// 週次で追う主要クエリ（KPIの判定単位。docs/operation/search-console-report.md の目標値と対応）
export const TRACKED_QUERIES = [
  "ボートai",
  "ボートレースai",
  "boatai",
  "競艇ai予想 無料",
  "競艇ai",
  "競艇 ai 予想",
  "龍神レーダー",
];

function emptyAgg() {
  return { clicks: 0, impressions: 0, positionWeighted: 0, queries: 0 };
}

function finalize(agg) {
  const { clicks, impressions, positionWeighted, queries } = agg;
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    // Search Console の position は表示ごとの平均なので、表示回数で重み付けして合算する
    position: impressions > 0 ? positionWeighted / impressions : null,
    queries,
  };
}

function add(agg, row) {
  agg.clicks += row.clicks;
  agg.impressions += row.impressions;
  agg.positionWeighted += row.position * row.impressions;
  agg.queries += 1;
}

/**
 * query ディメンションの行をクラスタ別に集計する
 * @param {{keys: string[], clicks: number, impressions: number, position: number}[]} rows
 */
export function summarizeClusters(rows) {
  const aggs = Object.fromEntries(
    Object.keys(CLUSTER_LABELS).map((k) => [k, emptyAgg()]),
  );
  for (const r of rows) add(aggs[classifyQuery(r.keys[0])], r);
  return Object.fromEntries(
    Object.entries(aggs).map(([k, v]) => [k, finalize(v)]),
  );
}

/**
 * YYYY-MM-DD をその週の月曜日（YYYY-MM-DD）に丸める。タイムゾーンの影響を受けないよう UTC で計算する
 * @param {string} date
 */
export function weekStartOf(date) {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`weekStartOf: 日付として解釈できません: ${date}`);
  }
  const offset = (d.getUTCDay() + 6) % 7; // 月曜=0
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

/**
 * ["date"] または ["query","date"] の行を週次に集計する。
 * 週の日数（days）を持たせ、集計期間の端で7日に満たない週を区別できるようにする
 * @param {{keys: string[], clicks: number, impressions: number, position: number}[]} rows
 * @param {number} dateKeyIndex - keys のうち日付の位置
 * @returns {{week: string, days: number, clicks: number, impressions: number, ctr: number, position: number|null}[]} 週の昇順
 */
export function weeklySeries(rows, dateKeyIndex = 0) {
  const byWeek = new Map();
  for (const r of rows) {
    const date = r.keys[dateKeyIndex];
    const week = weekStartOf(date);
    if (!byWeek.has(week))
      byWeek.set(week, { agg: emptyAgg(), dates: new Set() });
    const entry = byWeek.get(week);
    add(entry.agg, r);
    entry.dates.add(date);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, { agg, dates }]) => {
      const { queries: _rows, ...rest } = finalize(agg);
      return { week, days: dates.size, ...rest };
    });
}

/**
 * ["query","date"] の行から、追跡対象クエリだけを週次にする
 * @param {{keys: string[]}[]} queryDateRows
 * @param {string[]} trackedQueries
 */
export function trackedQueryWeekly(
  queryDateRows,
  trackedQueries = TRACKED_QUERIES,
) {
  const result = {};
  for (const q of trackedQueries) {
    result[q] = weeklySeries(
      queryDateRows.filter((r) => r.keys[0] === q),
      1,
    );
  }
  return result;
}

/**
 * page ディメンションの行を「トップ `/`」と「それ以外」、主要ページ群に分ける。
 * 比率だけだとトップが落ちても上がって見えるため、絶対数を返す
 * @param {{keys: string[], clicks: number, impressions: number, position: number}[]} pageRows
 * @param {string} origin - 例: https://www.boat-ai.jp
 */
export function landingSplit(pageRows, origin = "https://www.boat-ai.jp") {
  const groups = {
    root: emptyAgg(),
    today: emptyAgg(),
    venue: emptyAgg(),
    blog: emptyAgg(),
    otherJa: emptyAgg(),
    i18n: emptyAgg(),
  };
  for (const r of pageRows) {
    const pathname =
      r.keys[0].replace(origin, "").replace(/[#?].*$/, "") || "/";
    let g = "otherJa";
    if (pathname === "/") g = "root";
    else if (/^\/(en|ko|zh-TW)(\/|$)/.test(pathname)) g = "i18n";
    else if (pathname === "/today") g = "today";
    else if (/^\/venue\/\d+$/.test(pathname)) g = "venue";
    else if (pathname.startsWith("/blog/")) g = "blog";
    add(groups[g], r);
  }
  const out = Object.fromEntries(
    Object.entries(groups).map(([k, v]) => [k, finalize(v)]),
  );
  const nonRootClicks =
    out.today.clicks +
    out.venue.clicks +
    out.blog.clicks +
    out.otherJa.clicks +
    out.i18n.clicks;
  return { ...out, nonRootClicks };
}
