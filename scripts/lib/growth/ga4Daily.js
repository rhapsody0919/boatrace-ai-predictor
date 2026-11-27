/**
 * GA4 の日別の PV（screenPageViews＝page_view の数）と google の自然検索の着地 sessions を取る要求と、週の行を組む純関数
 * （google-detail-collect.js が ga4_daily.json に書き、seo-morning-sheet --local-dir が読む。審査 measurement-planner 2026-11-27）。
 *
 * 物差しの役目: 施策の効きの判定は GSC のページのクリック（seoEffect）。PV は判定に使わず、目標の進みと「検索が PV に占める割合」を見る。
 *   GA4 は Cookie に同意した人だけを数える（src/utils/analytics.js の initTrackingIfConsented）ので、PV の絶対値は需要そのものでない。
 *   着地 sessions ÷ GSC クリックの比が週で大きく動いたら、需要より先に計測（同意の帯・計測の切れ目）の変化を疑う。
 * 取り方: pagePath を日別で取って手元で畳まず、型ごとの正規表現で絞った [date, channel] を型の数だけ取る（"(other)" の行に落ちない）。
 *   全部に hostName の絞り（Preview 等の別の host を除く）。着地は sessionSource=google・sessionMedium=organic（GSC は Google だけ）。
 * 数字は手元のファイルだけに出す（repo・PR・票・Slack に貼らない）。
 */
import { ga4PvBreaksWithin } from "../ga4MeasurementBreaks.js";
import { normalizePage } from "./seoDetect.js";

/** ja のページの型（上から順に当てる）。GA4 の PARTIAL_REGEXP と手元の分類で同じ式を使う */
export const PAGE_TYPES = Object.freeze([
  { name: "トップ", re: "^/$" },
  { name: "レース詳細", re: "^/race/" },
  { name: "日付のレース一覧", re: "^/races(/|$)" },
  { name: "選手", re: "^/racers?(/|$)" },
  { name: "会場", re: "^/venue(/|$)" },
  { name: "記事", re: "^/blog(/|$)" },
]);
const NON_JA = "^/(en|ko|zh-TW)(/|$)";
const DAY = 86400000;
const shift = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

const exact = (fieldName, value) => ({ filter: { fieldName, stringFilter: { matchType: "EXACT", value } } });
const regex = (fieldName, value) => ({ filter: { fieldName, stringFilter: { matchType: "PARTIAL_REGEXP", value } } });
const and = (...expressions) => ({ andGroup: { expressions } });

/** runReport の要求の一覧（name・dimensions・metrics・dimensionFilter）。pv* は [date, channel]、landing* は [date] */
export function ga4DailyQueries(host) {
  const pv = (name, extra) => ({ name, dimensions: ["date", "sessionDefaultChannelGroup"], metrics: ["screenPageViews"], dimensionFilter: and(exact("hostName", host), ...extra) });
  const google = [exact("hostName", host), exact("sessionSource", "google"), exact("sessionMedium", "organic")];
  const landing = (name, extra) => ({ name, dimensions: ["date"], metrics: ["sessions"], dimensionFilter: and(...google, ...extra) });
  return [
    pv("pv_total", []),
    pv("pv_non_ja", [regex("pagePath", NON_JA)]),
    ...PAGE_TYPES.map((t) => pv(`pv:${t.name}`, [regex("pagePath", t.re)])),
    landing("landing_total", []),
    ...PAGE_TYPES.map((t) => landing(`landing:${t.name}`, [regex("landingPage", t.re)])),
  ];
}

/** GA4 の date（YYYYMMDD）を YYYY-MM-DD に */
export const ga4Date = (d) => (/^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d);

/** GSC の page の型。どれにも当たらなければ null（ja のその他か、ja でない） */
export function pageTypeOf(page) {
  const p = normalizePage(page).replace(/^[^/]*/, "") || "/";
  return PAGE_TYPES.find((t) => new RegExp(t.re).test(p))?.name ?? null;
}

/** 今週（末日まで7日）・前週・4週前の7日。末日は ga4_daily の meta.to（GSC と同じ lagDays 日前） */
export function weekWindows(to) {
  const w = (end) => ({ from: shift(end, -6), to: end });
  return { cur: w(to), prev: w(shift(to, -7)), base: w(shift(to, -28)) };
}

const inWindow = (w) => (r) => r.date >= w.from && r.date <= w.to;
const sum = (rows, metric, w, keep = () => true) => rows.filter(inWindow(w)).filter(keep).reduce((n, r) => n + Number(r[metric] ?? 0), 0);

/** 比の文。前の窓が取得の期間の外・計測の切れ目をまたぐ・0 なら比べない */
export function change(cur, base, w, curW, from) {
  if (w.from < from) return "期間外";
  const breaks = ga4PvBreaksWithin(w.from, curW.to);
  if (breaks.length > 0) return `比べない（計測の切れ目 ${breaks.map((b) => b.date).join("・")}）`;
  if (!(base > 0)) return "0 なので比べない";
  const pct = Math.round(((cur - base) / base) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

/**
 * 週の行。ga4: ga4_daily.json の中身（{ meta: { from, to, ga4_timezone }, series: { [name]: 行 } }）、gscPageDaily: gsc_page_daily の行。
 * 動きが無くても項目は全部並べる
 */
export function pvWeekLines(ga4, gscPageDaily = []) {
  const { from, to, ga4_timezone: tz } = ga4.meta;
  const W = weekWindows(to);
  const rows = (name) => {
    if (!Array.isArray(ga4.series?.[name])) throw new Error(`ga4_daily.json に ${name} が無い（取得の版が古い）`);
    return ga4.series[name].map((r) => ({ ...r, date: ga4Date(r.date) }));
  };
  const line = (label, name, metric, keep) => {
    const v = (w) => sum(rows(name), metric, w, keep);
    const cur = v(W.cur);
    return `- ${label}: ${cur}（前週 ${change(cur, v(W.prev), W.prev, W.cur, from)}・4週前 ${change(cur, v(W.base), W.base, W.cur, from)}）`;
  };
  const organic = (r) => r.sessionDefaultChannelGroup === "Organic Search";
  const days = new Set(rows("pv_total").filter(inWindow(W.cur)).map((r) => r.date));
  const ratio = (w, type) => {
    const clicks = sum(gscPageDaily, "clicks", w, (r) => type === undefined || pageTypeOf(r.page) === type);
    return clicks > 0 ? (sum(rows(type === undefined ? "landing_total" : `landing:${type}`), "sessions", w) / clicks).toFixed(2) : "-";
  };
  const out = [
    "",
    "[PV の週（GA4。手元だけ。数字を repo・票・Slack に貼らない。効きの判定は GSC のページのクリック）]",
    `- 窓: 今週 ${W.cur.from}〜${W.cur.to}・前週 ${W.prev.from}〜${W.prev.to}・4週前 ${W.base.from}〜${W.base.to}（GA4 の時間帯 ${tz ?? "未確認"}、GSC は PT。日ごとの比は出さない）`,
    `- 今週の欠けた日: ${7 - days.size}`,
    line("全体 PV", "pv_total", "screenPageViews"),
    line("自然検索のセッションの PV（Organic Search。回遊を含む）", "pv_total", "screenPageViews", organic),
    line("ja 以外の PV", "pv_non_ja", "screenPageViews"),
    ...PAGE_TYPES.map((t) => line(`PV: ${t.name}`, `pv:${t.name}`, "screenPageViews")),
    line("google の自然検索の着地 sessions", "landing_total", "sessions"),
    ...PAGE_TYPES.map((t) => line(`着地: ${t.name}`, `landing:${t.name}`, "sessions")),
    `- 着地 sessions ÷ GSC クリック: 今週 ${ratio(W.cur)}・前週 ${ratio(W.prev)}・4週前 ${ratio(W.base)}（大きく動いたら計測の変化を先に疑う）`,
    ...PAGE_TYPES.map((t) => `  - ${t.name}: 今週 ${ratio(W.cur, t.name)}・前週 ${ratio(W.prev, t.name)}`),
  ];
  const breaks = ga4PvBreaksWithin(from, to);
  if (breaks.length > 0) out.push(`- 取得の期間に計測の切れ目: ${breaks.map((b) => b.date).join("・")}（その日をまたいで比べない）`);
  return out;
}
