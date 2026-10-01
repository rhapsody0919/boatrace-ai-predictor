/**
 * 管理画面（/admin/rules）の運用成績（全体・ルール別・週別）の取得と整形（BOA-567）
 *
 * 以前は predictions（2026-01-16以降の全件、約3.8万行）と race_results を画面から
 * 1000件ずつページングして取り、ブラウザで集計していた（3系統が並行し、表示のたびに数十MBの転送）。
 * 集計を RPC get_admin_rule_performance に移し、/api/admin/rules/performance（Basic認証・
 * service key）経由で生の整数だけを受け取る。% の丸め・週の累積・ラベル付けはここで行い、
 * 旧実装（ruleMatchService.getTopPerformingRules / getOverallPerformance、
 * adminRuleService.getWeeklyPerformance）と同じ式（Math.round）で出す。
 *
 * scripts/maintenance/verify-admin-rule-performance.js が Node から読むため、import は拡張子付き。
 */

import { VENUE_RULES_BY_VENUE, VENUE_NAMES } from "../config/venueRules.js";

export const RULE_PERFORMANCE_START_DATE = "2026-01-16";

const percent = (numerator, denominator) =>
  denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;

/**
 * RPC の生の値を画面の形に整える（純粋関数）
 * @param {{ total: {samples, hits, payout}, by_rule: Array<{rule_id, samples, hits, payout}>, by_week: Array<{week_start, samples, hits, payout}> }} raw
 * @returns {{ overall: Object, rules: Array, weekly: Array }}
 */
export function shapeRulePerformance(
  raw,
  startDate = RULE_PERFORMANCE_START_DATE,
) {
  const byRuleId = new Map((raw.by_rule || []).map((r) => [r.rule_id, r]));

  // 旧 getTopPerformingRules と同じ: 会場（VENUE_RULES_BY_VENUE のキー順）・定義順に並べてから
  // 回収率の降順（安定ソート。同率の並びもこの順で決まる）
  const rules = Object.values(VENUE_RULES_BY_VENUE)
    .flat()
    .map((rule) => {
      const stat = byRuleId.get(rule.id) || { samples: 0, hits: 0, payout: 0 };
      return {
        ruleId: rule.id,
        venueCode: rule.venueCode,
        venueName: VENUE_NAMES[rule.venueCode],
        description: rule.description,
        betType: rule.betType,
        samples: stat.samples,
        hits: stat.hits,
        hitRate: percent(stat.hits, stat.samples),
        recovery:
          stat.samples > 0
            ? Math.round((stat.payout / (stat.samples * 100)) * 100)
            : 0,
      };
    });
  rules.sort((a, b) => b.recovery - a.recovery);

  const total = raw.total || { samples: 0, hits: 0, payout: 0 };
  const totalInvestment = total.samples * 100;
  const overall = {
    startDate,
    samples: total.samples,
    hits: total.hits,
    hitRate: percent(total.hits, total.samples),
    totalInvestment,
    totalPayout: total.payout,
    recovery:
      total.samples > 0
        ? Math.round((total.payout / totalInvestment) * 100)
        : 0,
  };

  // 旧 getWeeklyPerformance と同じ: 週（月曜始まり）の昇順で累積する
  const weeks = [...(raw.by_week || [])].sort((a, b) =>
    a.week_start.localeCompare(b.week_start),
  );
  let cumulativeSamples = 0;
  let cumulativePayout = 0;
  const weekly = weeks.map((w) => {
    cumulativeSamples += w.samples;
    cumulativePayout += w.payout;
    const investment = cumulativeSamples * 100;
    const [, month, day] = w.week_start.split("-").map(Number);
    return {
      weekStart: w.week_start,
      weekLabel: `${month}/${day}`,
      weeklySamples: w.samples,
      weeklyPayout: w.payout,
      weeklyRecovery:
        w.samples > 0 ? Math.round((w.payout / (w.samples * 100)) * 100) : 0,
      cumulativeSamples,
      cumulativePayout,
      cumulativeRecovery:
        investment > 0 ? Math.round((cumulativePayout / investment) * 100) : 0,
    };
  });

  return { overall, rules, weekly };
}

/**
 * /api/admin/rules/performance から取得して整形する。失敗は例外にする（「データなし」に化けさせない）
 */
export async function fetchRulePerformance() {
  const response = await fetch("/api/admin/rules/performance");
  let body;
  try {
    body = await response.json();
  } catch {
    // Vite開発サーバー等、Edge Function が動かない環境では SPA のHTMLが返る
    throw new Error(
      `運用成績APIから予期しない応答がありました (${response.status})`,
    );
  }
  if (!response.ok) {
    throw new Error(
      body.error || `運用成績の取得に失敗しました (${response.status})`,
    );
  }
  return shapeRulePerformance(body.data, body.startDate);
}
