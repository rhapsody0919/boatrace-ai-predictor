// 更新のお知らせの計算（純粋関数。時計は引数で受ける）。設計: docs/design/site-updates/plan.md
import { getDaysAgoJST } from "./jstDate.js";

// トップの帯を出す期間（今日を含む暦日）。目安・根拠なし（spec「既定値で決定した事項」）
export const BANNER_DAYS = 14;
// メニューの NEW を出す期間。ブログの NEW（7日）に合わせた
export const NEW_DAYS = 7;
// 今つくっている物の上限（オーナー決定 2026-11-23）
export const MAKING_MAX = 3;

// 時計を引数で受け、YYYY-MM-DD の文字列の比較で決める（src/utils は凍結のためここに置く）
const todayJst = (now) => getDaysAgoJST(0, now);

// 今日を含む直近 days 日（JST の暦日）に date が入るか。未来の日付は false
export const isWithinJstDays = (date, days, now = new Date()) =>
  typeof date === "string" &&
  date >= getDaysAgoJST(days - 1, now) &&
  date <= todayJst(now);

// 今日（JST）までの件だけ。先の日付で書いた件は、その日まで画面・帯・NEW に出さない
export const visibleUpdates = (items, now = new Date()) =>
  items.filter((item) => item.date <= todayJst(now));

const isHeadline = (item) => item.kind !== "minor";

// 月ごとに束ねる。items は日付の新しい順の前提（verify が見る）
export const groupUpdatesByMonth = (items) => {
  const months = new Map();
  for (const item of items) {
    const month = item.date.slice(0, 7);
    if (!months.has(month)) {
      const [y, m] = month.split("-");
      months.set(month, {
        month,
        label: `${y}年${Number(m)}月`,
        main: [],
        minor: [],
      });
    }
    const group = months.get(month);
    (isHeadline(item) ? group.main : group.minor).push(item);
  }
  return [...months.values()];
};

// トップの帯に出す1件。最新の新機能・改善が期間内で、閉じた件でなければそれを返す
export const pickBannerItem = (items, now = new Date(), dismissedId = null) => {
  const latest = visibleUpdates(items, now).find(isHeadline);
  if (!latest) return null;
  if (!isWithinJstDays(latest.date, BANNER_DAYS, now)) return null;
  if (latest.id === dismissedId) return null;
  return latest;
};

// メニューの NEW（直近 NEW_DAYS 日に新機能・改善があるか）
export const hasRecentUpdate = (items, now = new Date()) =>
  items.some(
    (item) => isHeadline(item) && isWithinJstDays(item.date, NEW_DAYS, now),
  );
