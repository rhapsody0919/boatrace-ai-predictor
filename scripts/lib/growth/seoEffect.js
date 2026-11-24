/**
 * 効きの測りの純関数（SEO データの輪 PR4。設計 seo-data-loop-design §5）。
 * 生の日次（growth_gsc_page_daily の date × page。ページの総クリック・表示）から毎回計算する。表は作らない。
 * DB・API には触れない（窓口が行を読んで渡す）。主の物差しは GSC の page クリック（GA4 は同意後の page_view で着地が偏るので使わない）。
 * 主の判定は T+28。T+7 は索引と着地の確認だけ。数字は公開の場所に出さない（票には桁と帯だけ）。
 */
import { GA4_PV_BREAKS } from "../ga4MeasurementBreaks.js";

/**
 * 閾値・日数。すべて目安（根拠なし）。補充（PR2）で過去の日次がそろった後に、帯の幅・基準の日数を並べて見直す。
 */
export const EFFECT = Object.freeze({
  baselineDays: 28, // 改稿前の基準の日数
  minBaselineDays: 14, // これより基準の日が少ないと「分けられない」（揺れが分からない）
  sumDays: 7, // 比べる単位は7日の和（日の揺れ・PT と JST のずれを消す）
  mainCheckDay: 28, // 主の判定（T+28）
  indexCheckDays: [1, 3, 7], // 新記事の索引の確認（D+1/D+3/D+7）
});

// 配備の定時（ADR-0106、JST 05:45・11:45・17:45）。反映の枠 = マージ時刻以降で最初の定時
const DEPLOY_SLOTS_JST = ["05:45", "11:45", "17:45"];
const DAY = 86400000;
const JST = 9 * 3600000;

const dayMs = (date) => Date.parse(`${date}T00:00:00Z`);
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** date を含む days 日の和（date から前向き）。metric は clicks か impressions */
export function sumWindow(rows, fromDate, days = EFFECT.sumDays, metric = "clicks") {
  const from = dayMs(fromDate);
  const to = from + (days - 1) * DAY;
  return rows.reduce((s, r) => {
    const t = dayMs(r.date);
    return t >= from && t <= to ? s + r[metric] : s;
  }, 0);
}

/** 日 [fromDate, toDate] の和の列（各日を起点とする7日の和）。窓が完全に入る起点だけ */
function rollingSums(rows, fromDate, toDate, metric) {
  const out = [];
  for (let t = dayMs(fromDate); t + (EFFECT.sumDays - 1) * DAY <= dayMs(toDate); t += DAY) {
    out.push(sumWindow(rows, isoDay(t), EFFECT.sumDays, metric));
  }
  return out;
}

/**
 * 基準と帯。基準 = 改稿前28日、帯 = その中の7日の和の最小〜最大（直近の揺れ）、中央値を基準値にする。
 * 基準の日数が足りない（公開から日が浅い等）なら null
 */
export function baselineBand(rows, editDate, metric = "clicks") {
  const end = isoDay(dayMs(editDate) - DAY);
  const start = isoDay(dayMs(editDate) - EFFECT.baselineDays * DAY);
  const have = new Set(rows.filter((r) => r.date >= start && r.date <= end).map((r) => r.date));
  if (have.size < EFFECT.minBaselineDays) return null;
  const sums = rollingSums(rows, start, end, metric).sort((a, b) => a - b);
  const m = sums.length >> 1;
  return { min: sums[0], max: sums.at(-1), base: sums.length % 2 ? sums[m] : (sums[m - 1] + sums[m]) / 2 };
}

/** 反映の枠。マージ時刻（ISO）以降で最初の定時（JST）を ISO（UTC）で返す。同じ値なら同じ枠 */
export function deploySlotOf(mergedAtIso) {
  const t = Date.parse(mergedAtIso);
  const jstDay = Math.floor((t + JST) / DAY) * DAY - JST; // その JST の日の 0 時
  for (let d = 0; d < 2; d++) {
    for (const hm of DEPLOY_SLOTS_JST) {
      const [h, m] = hm.split(":").map(Number);
      const slot = jstDay + d * DAY + (h * 60 + m) * 60000;
      if (slot >= t) return new Date(slot).toISOString();
    }
  }
  throw new Error(`反映の枠が決まらない: ${mergedAtIso}`);
}

/**
 * 「分けられない」を機械で出す3条件（どれか1つで該当）。reasons に当たった条件を返す。
 * 1. 同じ反映の枠に、同じページ・またはサイト全体の型（title・sitemap・robots・middleware・hreflang）に触れた別の変更がある
 *    changes: [{ id, mergedAt, pages: [正規化した page], siteWide: boolean }]
 * 2. コアアップデートの期間（手で持つ台帳 coreUpdates: [{from, to}]。台帳が空の間はこの条件は空）
 * 3. 測りの窓が GA4_PV_BREAKS をまたぐ（GA4 を使う判定のみ。この日を含む以前と翌日以降は比べない）
 */
export function cannotSeparate({ edit, window, changes = [], coreUpdates = [], usesGa4 = false, ga4Breaks = GA4_PV_BREAKS }) {
  const reasons = [];
  const slot = deploySlotOf(edit.mergedAt);
  const sameSlot = changes.some(
    (c) => c.id !== edit.id && deploySlotOf(c.mergedAt) === slot && (c.siteWide || c.pages.includes(edit.page)),
  );
  if (sameSlot) reasons.push("same_slot_change");
  if (coreUpdates.some((u) => u.from <= window.to && u.to >= window.from)) reasons.push("core_update");
  if (usesGa4 && ga4Breaks.some((b) => window.from <= b.date && b.date < window.to)) reasons.push("ga4_measurement_break");
  return { separable: reasons.length === 0, reasons };
}

/** 公開日からの確認の日（D+1/D+3/D+7 と T+28）のうち、今日までに来た物 */
export function dueCheckpoints(publishDate, today) {
  const age = Math.round((dayMs(today) - dayMs(publishDate)) / DAY);
  return [...EFFECT.indexCheckDays, EFFECT.mainCheckDay].filter((d) => age >= d).map((d) => (d === EFFECT.mainCheckDay ? "T+28" : `D+${d}`));
}

/**
 * 新記事の段: 索引された → 表示が出た → クリックが出た。止まった段（stoppedAt）を返す。
 * indexStatus は URL Inspection の結果（"indexed"・"not_indexed"・"unknown"）、totals は公開からの累計
 */
export function newArticleStage({ indexStatus, impressions, clicks }) {
  if (indexStatus !== "indexed") {
    return { stage: indexStatus === "not_indexed" ? "not_indexed" : "index_unknown", stoppedAt: "index" };
  }
  if (!(impressions > 0)) return { stage: "indexed", stoppedAt: "impressions" };
  if (!(clicks > 0)) return { stage: "impressions", stoppedAt: "clicks" };
  return { stage: "clicks", stoppedAt: null };
}

/**
 * 改稿の判定: 伸びた / 戻った / 動かず / 落ちた / 分けられない（オーナーの窓口の決定 2026-11-24）。
 * 改稿後の T+28 時点の7日の和（編集日から22〜28日目）を、対照（触っていないページ群）が同じ期間に動いた割合で割ってから
 * （サイト全体の波を消す）、改稿前28日の帯と比べる。
 *   戻った: 改稿の前に落ちていた記事（改稿前28日の基準値が、その前の28日の帯の下限を下回る）が、落ちる前の帯の下限まで戻った。
 *           落ちる前の帯が取れない（日が足りない）ときは「戻った」は返さない。伸びたより先に当てる
 *   伸びた: 改稿前28日の帯の上に出た
 *   落ちた: 改稿前28日の帯の下に出た
 *   動かず: 帯の中
 * rows: 対象ページの日次、controlRows: 触っていないページ群の日次の合計（date ごと）。分けられない条件は cannot を渡す
 */
export function judgeRewrite({ rows, controlRows, editDate, cannot, metric = "clicks" }) {
  if (!cannot.separable) return { verdict: "分けられない", reasons: cannot.reasons };
  const band = baselineBand(rows, editDate, metric);
  if (!band) return { verdict: "分けられない", reasons: ["baseline_too_short"] };
  const afterFrom = isoDay(dayMs(editDate) + (EFFECT.mainCheckDay - EFFECT.sumDays) * DAY);
  const after = sumWindow(rows, afterFrom, EFFECT.sumDays, metric);
  const ctrlBand = baselineBand(controlRows, editDate, metric);
  const ctrlAfter = sumWindow(controlRows, afterFrom, EFFECT.sumDays, metric);
  if (!ctrlBand || ctrlBand.base === 0) return { verdict: "分けられない", reasons: ["control_missing"] };
  const wave = ctrlAfter / ctrlBand.base; // 触っていないページ群の動き（1 = 変わらず）
  const adjusted = wave > 0 ? after / wave : after;
  const earlier = baselineBand(rows, isoDay(dayMs(editDate) - EFFECT.baselineDays * DAY), metric); // 落ちる前の帯
  const droppedBefore = earlier !== null && band.base < earlier.min;
  let verdict = "動かず";
  if (droppedBefore && adjusted >= earlier.min) verdict = "戻った";
  else if (adjusted > band.max) verdict = "伸びた";
  else if (adjusted < band.min) verdict = "落ちた";
  return { verdict, reasons: [], band, earlier, after, adjusted, wave };
}

/** 未測定: 公開から28日を過ぎて T+28 の判定が出ていない記事。articles: [{ id, publishDate, measuredAt }] */
export function unmeasured(articles, today) {
  return articles.filter((a) => !a.measuredAt && dayMs(today) - dayMs(a.publishDate) >= EFFECT.mainCheckDay * DAY).map((a) => a.id);
}
