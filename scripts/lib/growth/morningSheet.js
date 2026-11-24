/**
 * SEO の朝の1枚の組み立て（SEO データの輪 PR6。設計 seo-data-loop-design §2・§4・§5）。
 * 見張り（growth 表の鮮度と行数）が緑のときだけ、察知（seoDetect）と効き（seoEffect）を1枚に並べる。
 * DB・API には触れない純関数（読むのは CLI。作り手は本番を読めない）。
 *
 * 数字は公開の場所に出さない。1枚にも票にも、正確な件数・クリック・順位は出さず、桁（approxMagnitude）と順位の帯だけ。
 * 票の本文に数字を書かない（Linear の票が非公開かは未確認）。
 */
import {
  approxMagnitude,
  ctrMedianByPosition,
  decideAction,
  detectCannibal,
  detectMovers,
  normalizePage,
  weightedPosition,
  windows,
} from "./seoDetect.js";
import { EFFECT, cannotSeparate, dueCheckpoints, judgeRewrite, newArticleStage, unmeasured } from "./seoEffect.js";
import { indexStatusOf } from "./urlInspection.js";

/** 目安（根拠なし）。補充の後に見直す。GSC は2〜3日遅れて届くので、直近の日が4日より古ければ止まりとみなす */
export const SHEET = Object.freeze({ maxLagDays: 4, answerPageMaxPosition: 30, topN: 10 });

const DAY = 86400000;
const lagDays = (today, date) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY);

/** 見張り。tables: [{ table, maxDate, rowCount, required }]。状態は ok・stale（直近の日が古い）・empty（0行）・missing（表が無い。必須でなければ注記だけ） */
export function freshnessReport(tables, today) {
  return tables.map((t) => {
    if (t.missing) return { ...t, status: "missing", green: !t.required };
    if (!t.rowCount || !t.maxDate) return { ...t, status: "empty", green: false };
    const lag = lagDays(today, t.maxDate);
    return { ...t, status: lag > SHEET.maxLagDays ? "stale" : "ok", lag, green: lag <= SHEET.maxLagDays };
  });
}

export const isGreen = (report) => report.every((r) => r.green);

/** 順位の帯（票には正確な順位でなく帯を書く） */
export function positionBand(position) {
  if (position == null) return "不明";
  if (position <= 3) return "1〜3位";
  if (position <= 10) return "4〜10位";
  if (position <= 20) return "11〜20位";
  return "21位以下";
}

function totalsByQuery(rows, { from, to }) {
  const m = new Map();
  for (const r of rows) {
    if (r.date < from || r.date > to) continue;
    if (!m.has(r.query)) m.set(r.query, []);
    m.get(r.query).push(r);
  }
  return m;
}

/**
 * 察知の信号。伸びた・新しい語（落ちた語は別枠で数だけ）ごとに推奨の手を1つ付ける。
 * inspections: { [正規化した page]: canonical_ok(true/false/null) }、aioQueries: AIO が出る語の Set
 */
export function buildSignals(rows, today, { series = [], inspections = {}, aioQueries = new Set() } = {}) {
  const w = windows(today);
  const movers = detectMovers(rows, today, { series });
  const cannibals = new Map(detectCannibal(rows, w.recent).map((c) => [c.query, c.pages]));
  const byQuery = totalsByQuery(rows, w.recent);
  const totals = [...byQuery].map(([, rs]) => ({
    impressions: rs.reduce((s, r) => s + r.impressions, 0),
    clicks: rs.reduce((s, r) => s + r.clicks, 0),
    position: weightedPosition(rs),
  }));
  const medians = ctrMedianByPosition(totals);
  return movers.filter((m) => m.kind !== "falling").map((m) => {
    const rs = byQuery.get(m.query) ?? [];
    const impressions = rs.reduce((s, r) => s + r.impressions, 0);
    const clicks = rs.reduce((s, r) => s + r.clicks, 0);
    const pageImpr = new Map();
    for (const r of rs) pageImpr.set(normalizePage(r.page), (pageImpr.get(normalizePage(r.page)) ?? 0) + r.impressions);
    const landing = [...pageImpr].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const position = m.position;
    const action = decideAction({
      hasAnsweringPage: position != null && position <= SHEET.answerPageMaxPosition,
      canonicalOk: landing ? (inspections[landing] ?? null) : null,
      cannibal: cannibals.has(m.query),
      position,
      impressions,
      ctr: impressions > 0 ? clicks / impressions : 0,
      medianCtr: medians.get(Math.max(1, Math.ceil(position ?? 99))) ?? null,
      aio: aioQueries.has(m.query),
      orphan: false, // 内部リンクの静的な数は後の PR（未実装）
    });
    return {
      query: m.query, kind: m.kind, intent: m.intent, competitorOverlap: m.competitorOverlap, event: m.event, seasonal: m.seasonal,
      action, band: positionBand(position), magnitude: approxMagnitude(impressions), landing, overlapPages: cannibals.get(m.query) ?? [],
    };
  });
}

const ACTION_TEXT = {
  new_article: "新記事", consolidate_canonical: "統合・差別化・canonical", rewrite_or_internal_link: "改稿か内部リンク",
  rewrite_title_description: "title・description の改稿", exclude_aio_from_ctr_rewrite: "AIO の語（クリック率の改稿から外す）",
  internal_link_only: "内部リンクだけ", none: "手なし",
};

/** 「SEO:」票の雛形（Linear）。語・順位の帯・表示の桁・着地ページ・重なる記事・推奨の手・測る日。数字は桁と帯だけ */
export function ticketTemplate(s, today) {
  const measure = new Date(Date.parse(`${today}T00:00:00Z`) + 28 * DAY).toISOString().slice(0, 10);
  return [
    `タイトル: SEO: ${s.query} → ${ACTION_TEXT[s.action]}`,
    "",
    `- 狙いの語（主）: ${s.query}`,
    `- 順位の帯: ${s.band}／表示の桁: ${s.magnitude}（直近7日。正確な数字は書かない）`,
    `- 着地ページ: ${s.landing ?? "なし"}`,
    `- 重なる記事: ${s.overlapPages.length > 0 ? s.overlapPages.join("・") : "なし"}`,
    `- 推奨の手: ${ACTION_TEXT[s.action]}`,
    `- 測る日: ${measure}（T+28。主の判定は GSC の page クリック。T+7 は索引と着地の確認だけ）`,
    s.seasonal ? "- 旬の語: 当日中に票にする（通常の朝を待たない）" : null,
    s.event ? "- 開催起因の語: 一般の語の伸びと混ぜない" : null,
  ].filter((l) => l !== null).join("\n");
}

/** 新記事の段と未測定。articles: [{ id, url, publishDate, measuredAt }]、totals: { [正規化した page]: { impressions, clicks } }（公開からの累計）、inspectionRows: { [url]: 行 } */
export function articleLines(articles, today, { totals = {}, inspectionRows = {} } = {}) {
  const lines = articles.map((a) => {
    const t = totals[normalizePage(a.url)] ?? { impressions: 0, clicks: 0 };
    const st = newArticleStage({ indexStatus: indexStatusOf(inspectionRows[a.url]), impressions: t.impressions, clicks: t.clicks });
    return `${a.id ?? a.url}: 段=${st.stage}${st.stoppedAt ? `（${st.stoppedAt}で止まっている）` : ""}・来ている確認=${dueCheckpoints(a.publishDate, today).join("・") || "なし"}`;
  });
  const late = unmeasured(articles.map((a) => ({ id: a.id ?? a.url, publishDate: a.publishDate, measuredAt: a.measuredAt })), today);
  if (late.length > 0) lines.push(`未測定（公開から28日を過ぎて T+28 が出ていない）: ${late.join("・")}`);
  return lines;
}

/**
 * 改稿の判定の1行。edit: { id, page（正規化）, editDate, mergedAt }。pageDaily: growth_gsc_page_daily の行（全ページ）。
 * 対照は、その記事以外のページの日次の合計。T+28 が来るまでは判定せず、来る日を書く
 */
export function rewriteLine(edit, pageDaily, today, { changes = [], coreUpdates = [] } = {}) {
  const dueDate = new Date(Date.parse(`${edit.editDate}T00:00:00Z`) + EFFECT.mainCheckDay * DAY).toISOString().slice(0, 10);
  if (today < dueDate) return `${edit.id}: 判定待ち（T+28 は ${dueDate}）`;
  const rows = pageDaily.filter((r) => normalizePage(r.page) === edit.page);
  const ctrl = new Map();
  for (const r of pageDaily) if (normalizePage(r.page) !== edit.page) ctrl.set(r.date, (ctrl.get(r.date) ?? 0) + r.clicks);
  const controlRows = [...ctrl].map(([date, clicks]) => ({ date, clicks, impressions: 0 }));
  const from = new Date(Date.parse(`${edit.editDate}T00:00:00Z`) - EFFECT.baselineDays * DAY).toISOString().slice(0, 10);
  const cannot = cannotSeparate({ edit, window: { from, to: dueDate }, changes, coreUpdates });
  const r = judgeRewrite({ rows, controlRows, editDate: edit.editDate, cannot });
  return `${edit.id}: ${r.verdict}${r.reasons.length > 0 ? `（${r.reasons.join("・")}）` : ""}`;
}

/** 1枚の本文。見張りが緑のときだけ察知と効きを出す */
export function renderSheet({ today, freshness, signals = [], articleLinesOut = [], fallingCount = 0 }) {
  const out = [`SEO の朝の1枚（PT ${today}）`, "", "[見張り]"];
  for (const r of freshness) {
    out.push(`- ${r.table}: ${r.status}${r.maxDate ? `（直近の日 ${r.maxDate}）` : ""}${r.status === "missing" && !r.required ? "（必須でない。未適用）" : ""}`);
  }
  if (!isGreen(freshness)) {
    out.push("", "見張りが緑でないので、察知と効きは出さない。先に取れていない原因（growth-gsc-daily の失敗・鍵・補充）を見る");
    return out.join("\n");
  }
  const section = (title, items) => items.length > 0 && out.push("", `[${title}]`, ...items.slice(0, SHEET.topN).map((s) => `- ${s.query}（${s.kind}・${s.band}・表示${s.magnitude}${s.competitorOverlap ? "・競合名と同じ語" : ""}）→ ${ACTION_TEXT[s.action]}`));
  section("旬の語: 当日中に票まで", signals.filter((s) => s.seasonal));
  const rest = signals.filter((s) => !s.seasonal);
  section("察知: 一般の語", rest.filter((s) => !s.event && s.intent === "general"));
  section("察知: 指名の語", rest.filter((s) => !s.event && s.intent === "brand"));
  section("察知: 開催起因の語（一般と混ぜない）", rest.filter((s) => s.event));
  out.push("", `落ちた語: ${approxMagnitude(fallingCount)}件`);
  if (articleLinesOut.length > 0) out.push("", "[効き: 新記事の段・未測定]", ...articleLinesOut.map((l) => `- ${l}`));
  return out.join("\n");
}
