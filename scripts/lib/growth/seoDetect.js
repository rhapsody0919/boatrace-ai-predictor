/**
 * 察知の純関数（SEO データの輪 PR3。設計 seo-data-loop-design §4）。
 * growth_gsc_daily の行（date × query × page）から、伸びた・新しい・落ちた語、カニバリ、旬の語を出し、
 * 語ごとに推奨の手を1つ決める。DB・API には触れない（窓口が行を読んで渡す。作り手は本番を読めない）。
 *
 * 出力は語・順位・表示の件数などを含む。公開の場所（repo・Actions のログ・PR 本文・Linear の票）には出さない。
 * 票に載せるのは桁と帯だけ（approxMagnitude）。
 */
import { VENUE_NAMES } from "../venueNames.js";
import { classifyQuery } from "../seoKeywordKpi.js";

/**
 * 閾値。すべて目安（根拠なし）。補充（PR2）で過去の日次がそろった後に、各線で何件出るかを並べて見直す。
 * 見直すまでは「出しすぎ・出なさすぎ」のどちらもありうる。
 */
export const THRESHOLDS = Object.freeze({
  windowDays: 7,
  minImpressions: 30, // 動きを語る最小の表示（直近の窓の合計）
  risingRatio: 2, // 直近の窓 / 前の窓 の表示の比。これ以上で「伸びた」、逆数以下で「落ちた」
  nearPage1: { minPosition: 11, maxPosition: 20, minImpressions: 100 },
  ctrLowRatio: 0.5, // 同じ順位帯の CTR の中央値のこの割合を下回ると「CTR が低い」
  cannibalSecondShare: 0.2, // 上位2ページの2位が、その語の表示の合計のこの割合以上
  orphanMaxInlinks: 2, // 内部リンクがこれ以下の記事は孤立
});

// 旬の語（閉鎖・終了・代わり型。例: 艇国データバンク）。旬は数日なので通常の朝を待たず当日中に票にする
const SEASONAL_PATTERN = /閉鎖|終了|サービス停止|休止|廃止|代わり|代替|後継|乗り換え/;
// 開催起因の語に付く、開催そのものを指す語
const EVENT_WORD_PATTERN = /sg|ｓｇ|g1|ｇ１|g2|g3|優勝戦|ボートレースクラシック|オールスター|グランプリ|メモリアル|ダービー|クラウン|チャレンジカップ|鳴門秘伝|開催/i;
const COMPETITOR_OVERLAP_PATTERN = /ボートアイ|boat\s*ai\b/i;

/** Search Console の page を比べられる形にする（www と無印・クエリ・ハッシュ・末尾の / を同じにする） */
export function normalizePage(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return String(url);
  }
  const host = u.hostname.replace(/^www\./, "");
  const path = decodeURIComponent(u.pathname).replace(/\/+$/, "") || "/";
  return `${host}${path}`;
}

/** 表示で重みを付けた順位（単純平均にしない）。表示が0なら null */
export function weightedPosition(rows) {
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  if (impressions === 0) return null;
  return rows.reduce((s, r) => s + r.position * r.impressions, 0) / impressions;
}

/** 指名（龍神レーダー・旧名系）と一般の分け。定義は seoKeywordKpi.js の classifyQuery の表に寄せる。ボートアイ系は競合名と同じなので印を付ける */
export function classifyIntent(query) {
  const cluster = classifyQuery(query);
  const brand = cluster === "new_brand" || cluster === "old_brand";
  return {
    intent: brand ? "brand" : "general",
    competitorOverlap: brand && COMPETITOR_OVERLAP_PATTERN.test(query.toLowerCase()),
  };
}

export function isSeasonalTerm(query) {
  return SEASONAL_PATTERN.test(query);
}

/**
 * 開催起因の語か。その日に開催中（start_date〜end_date）の節の会場名を含み、かつ開催を指す語か節の名前を含む。
 * series は race_series の行（venue_code・start_date・end_date・title・grade）。開催の暦は呼び手が渡す
 */
export function isEventDriven(query, date, series) {
  const q = query.toLowerCase();
  return series.some((s) => {
    if (date < s.start_date || date > (s.end_date ?? s.start_date)) return false;
    const venue = VENUE_NAMES[Number(s.venue_code)];
    if (!venue || !q.includes(venue)) return false;
    const title = String(s.title ?? "").replace(/\s+/g, "");
    return EVENT_WORD_PATTERN.test(q) || (title.length >= 3 && q.replace(/\s+/g, "").includes(title));
  });
}

function sum(rows, key) {
  return rows.reduce((s, r) => s + r[key], 0);
}

function inRange(r, from, to) {
  return r.date >= from && r.date <= to;
}

/** to を含む直近 days 日の [from, to] と、その前の同じ長さの窓 */
export function windows(to, days = THRESHOLDS.windowDays) {
  const DAY = 86400000;
  const end = Date.parse(`${to}T00:00:00Z`);
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  return {
    recent: { from: iso(end - (days - 1) * DAY), to },
    prev: { from: iso(end - (2 * days - 1) * DAY), to: iso(end - days * DAY) },
  };
}

function groupBy(rows, keyOf) {
  const m = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

/**
 * 伸びた・新しい・落ちた語。直近の窓と前の窓を、表示の7日の和で比べる。
 * 各語に 指名/一般・開催起因・旬の印を付ける。開催起因は別の札（kind は同じでも event: true）にして、一般の語の伸びと混ぜない
 */
export function detectMovers(rows, to, { series = [], thresholds = THRESHOLDS } = {}) {
  const w = windows(to, thresholds.windowDays);
  const out = [];
  for (const [query, qrows] of groupBy(rows, (r) => r.query)) {
    const recentRows = qrows.filter((r) => inRange(r, w.recent.from, w.recent.to));
    const recent = sum(recentRows, "impressions");
    const prev = sum(qrows.filter((r) => inRange(r, w.prev.from, w.prev.to)), "impressions");
    let kind = null;
    if (prev === 0 && recent >= thresholds.minImpressions) kind = "new";
    else if (prev > 0 && recent >= thresholds.minImpressions && recent / prev >= thresholds.risingRatio) kind = "rising";
    else if (prev >= thresholds.minImpressions && recent / prev <= 1 / thresholds.risingRatio) kind = "falling";
    if (!kind) continue;
    out.push({
      query,
      kind,
      recentImpressions: recent,
      prevImpressions: prev,
      position: weightedPosition(recentRows),
      event: isEventDriven(query, to, series),
      seasonal: isSeasonalTerm(query),
      ...classifyIntent(query),
    });
  }
  return out;
}

/** カニバリ: 同じ語で、窓内の表示の上位2ページ（正規化した page）がどちらも出ている語 */
export function detectCannibal(rows, { from, to }, thresholds = THRESHOLDS) {
  const out = [];
  const win = rows.filter((r) => inRange(r, from, to));
  for (const [query, qrows] of groupBy(win, (r) => r.query)) {
    const pages = [...groupBy(qrows, (r) => normalizePage(r.page))]
      .map(([page, prs]) => ({ page, impressions: sum(prs, "impressions") }))
      .sort((a, b) => b.impressions - a.impressions);
    const total = sum(pages, "impressions");
    if (pages.length < 2 || total < thresholds.minImpressions) continue;
    if (pages[1].impressions / total >= thresholds.cannibalSecondShare) {
      out.push({ query, pages: [pages[0].page, pages[1].page] });
    }
  }
  return out;
}

function median(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 順位帯（1〜10位。位を切り上げ）ごとの CTR の中央値。表示が minImpressions 以上の語だけ。語の行は窓の合計に直してから渡す */
export function ctrMedianByPosition(queryTotals, minImpressions = THRESHOLDS.minImpressions) {
  const buckets = new Map();
  for (const t of queryTotals) {
    if (t.impressions < minImpressions || t.position == null || t.position > 10) continue;
    const b = Math.max(1, Math.ceil(t.position));
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b).push(t.clicks / t.impressions);
  }
  return new Map([...buckets].map(([b, xs]) => [b, median(xs)]));
}

/**
 * 判定木。語ごとに推奨の手を1つ返す。
 * s: { hasAnsweringPage, canonicalOk(null=未確認), cannibal, position, impressions, ctr, medianCtr, aio, orphan }
 * 答えるページが無い→新記事 / 索引・canonical が正しくない→統合・差別化 canonical / カニバリ→統合 /
 * 11〜20位→改稿か内部リンク / 良い順位で CTR が低い→（AIO の語は CTR 改稿から外す、出ない語は title・description）/ 孤立→内部リンク
 */
export function decideAction(s, thresholds = THRESHOLDS) {
  if (!s.hasAnsweringPage) return "new_article";
  if (s.canonicalOk === false) return "consolidate_canonical";
  if (s.cannibal) return "consolidate_canonical";
  const np = thresholds.nearPage1;
  if (s.position >= np.minPosition && s.position <= np.maxPosition && s.impressions >= np.minImpressions) {
    return "rewrite_or_internal_link";
  }
  if (s.position != null && s.position <= 10 && s.medianCtr != null && s.ctr < s.medianCtr * thresholds.ctrLowRatio) {
    return s.aio ? "exclude_aio_from_ctr_rewrite" : "rewrite_title_description";
  }
  if (s.orphan) return "internal_link_only";
  return "none";
}

/** 票に載せる桁（正確な数字を公開の場所に出さない）。10 の冪の下限: 37 → "10台"、420 → "100台" */
export function approxMagnitude(n) {
  if (!(n >= 1)) return "0";
  return `${10 ** Math.floor(Math.log10(n))}台`;
}
