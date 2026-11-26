/**
 * API で取れない請求を、毎月の初めに1回だけオーナーに見に行ってもらう知らせ（cost-alerts.js が束ねて Slack に出す）。
 * Supabase は請求・使用量（転送量など）を読む API が無く、画面でしか見られない（2026-11-26 窓口が確かめた。オーナー「両方やって」）。
 * 月の1〜5日のどこかで1回（Mac が1日に眠っていても拾う。同じ月の鍵は cost-alerts.js が2回出さない）。
 * 検証: scripts/maintenance/verify-cost-alerts-monthly.js
 */

export const MONTHLY_CHECKS = [
  {
    id: "supabase_billing",
    text: "Supabase の先月の請求と使用量（転送量・DB の大きさ・計算の資源）を見る。API で取れないので画面で: https://supabase.com/dashboard/org/_/billing",
  },
];

/** 月の初めの知らせ。today は JST の日（YYYY-MM-DD） */
export function monthlyChecks(today, checks = MONTHLY_CHECKS) {
  const day = Number(today.slice(8, 10));
  if (!(day >= 1 && day <= 5)) return [];
  const month = today.slice(0, 7);
  return checks.map((c) => ({
    key: `monthly_check:${c.id}:${month}`,
    text: c.text,
  }));
}
