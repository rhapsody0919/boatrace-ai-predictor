import { getDaysAgoJST } from "./jstDate.js";
import { parseFavorites } from "./favorites.js";

/**
 * 再訪の計測 visit_day（GS03）の純関数。端末の中に来訪した日（JST の YYYY-MM-DD）だけを
 * 直近7日分持ち、その日の最初の来訪で1回だけ「直近7日（今日を含む）に来た日数」と
 * 「今の ISO 週（月曜始まり、JST）に来た日数」を送る。
 * 人の識別子は作らない・送らない（GA4 の端末の識別のまま）。
 */
export const VISIT_DAYS_KEY = "boatai-user:visit-days";
export const VISIT_WINDOW_DAYS = 7;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 保存した来訪日の列と今の時刻から、送るか・送る値・次に保存する列を返す。
 * 今日が列にあれば送らない（同じ日の2回目以降）。壊れた保存は空の列として扱う。
 * @returns {{ send: boolean, activeDays7d: number, activeDaysIsoWeek: number, days: string[] }}
 */
export const nextVisitDays = (raw, now = new Date()) => {
  const today = getDaysAgoJST(0, now);
  // JST の曜日（0=日）から今週の月曜を出す。7日の窓は月曜〜今日を必ず含む
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const monday = getDaysAgoJST((weekday + 6) % 7, now);
  const inWeek = (days) => days.filter((d) => d >= monday).length;
  const oldest = getDaysAgoJST(VISIT_WINDOW_DAYS - 1, now);
  let stored = [];
  try {
    const value = JSON.parse(raw ?? "[]");
    if (Array.isArray(value)) stored = value;
  } catch {
    stored = [];
  }
  const recent = [...new Set(stored.filter((d) => typeof d === "string" && DATE_RE.test(d)))]
    .filter((d) => d >= oldest && d <= today)
    .sort();
  if (recent.includes(today)) {
    return { send: false, activeDays7d: recent.length, activeDaysIsoWeek: inWeek(recent), days: recent };
  }
  const days = [...recent, today];
  return { send: true, activeDays7d: days.length, activeDaysIsoWeek: inWeek(days), days };
};

/** ☆の有無（件数は送らない）。保存が読めないときは unknown */
export const favHolder = (raw) => {
  const { racers, venues, error } = parseFavorites(raw);
  if (error) return "unknown";
  if (racers.length > 0 && venues.length > 0) return "both";
  if (racers.length > 0) return "racer";
  if (venues.length > 0) return "venue";
  return "none";
};
