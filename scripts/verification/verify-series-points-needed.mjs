// 実行: node --env-file=.env.local scripts/verification/verify-series-points-needed.mjs
// CIには載せない（本番Supabaseへの接続と、特定の節のデータに依存するため）。
// 2026-09-28の実行結果: 1955組（レース×選手）で不整合0。
import { supabase } from "./scripts/lib/supabaseClient.js";
import {
  computeSeriesScore,
  buildMeetRanking,
  pointsNeededForBorder,
  SCORE_POINTS,
  SEMIFINAL_DEFAULT_SLOTS,
} from "./src/components/race/seriesPoints.js";

// 若松G1（2026-09-22〜27）の予選期間の各日・各レースについて、
// 「必要得点」の自己整合性を全選手ぶん検証する。
//   (1) 必要得点ぶんを取ると得点率がボーダー以上になる
//   (2) それより1点少ないと届かない（境界が正しい）
//   (3) 「届かず」と出す条件（最大得点でも届かない）が実際に正しい
const vv = "20";
const MEET_FROM = "2026-09-22";

const { data: entries } = await supabase
  .from("race_entries")
  .select("race_id, boat_number, racer_id, player_name")
  .gte("race_id", MEET_FROM)
  .lte("race_id", "2026-09-27-zz")
  .like("race_id", `__________-${vv}-__`);
const raceIds = [...new Set((entries ?? []).map((e) => e.race_id))];
const { data: results } = await supabase
  .from("race_results")
  .select("race_id, rank1, rank2, rank3, rank4, rank5, rank6")
  .in("race_id", raceIds);
const { data: conds } = await supabase
  .from("race_conditions")
  .select("race_id, race_stage")
  .gte("race_id", MEET_FROM)
  .lte("race_id", "2026-09-27-zz")
  .like("race_id", `__________-${vv}-__`);

const stage = new Map((conds ?? []).map((c) => [c.race_id, c.race_stage ?? ""]));
const res = new Map((results ?? []).map((r) => [r.race_id, r]));
const prelimEnd = (conds ?? [])
  .filter((c) => (c.race_stage ?? "").includes("予選"))
  .map((c) => c.race_id)
  .sort()
  .pop();

let checked = 0;
const bad = [];

// 予選期間の各レースを「表示中のレース」に見立てて検証する
for (const displayed of raceIds.filter((id) => id <= prelimEnd).sort()) {
  const past = (entries ?? []).filter((e) => e.race_id < displayed);
  if (past.length === 0) continue;

  const board = {
    prelimEndRaceId: prelimEnd,
    entries: past.map((e) => ({
      raceId: e.race_id,
      boatNumber: e.boat_number,
      racerId: e.racer_id,
      playerName: e.player_name,
      raceStage: stage.get(e.race_id) ?? null,
      ...(res.get(e.race_id) ?? {}),
    })),
  };
  const ranking = buildMeetRanking(board);
  if (ranking.length < SEMIFINAL_DEFAULT_SLOTS) continue;
  const border = ranking[SEMIFINAL_DEFAULT_SLOTS - 1]?.rate;
  if (border === undefined) continue;

  // 残りの予選走数（表示中レースを含む）
  const remaining = new Map();
  for (const e of entries ?? []) {
    if (e.race_id < displayed) continue;
    if (!(stage.get(e.race_id) ?? "").includes("予選")) continue;
    remaining.set(e.racer_id, (remaining.get(e.racer_id) ?? 0) + 1);
  }

  for (const row of ranking) {
    const r = remaining.get(row.racerId) ?? 0;
    const need = pointsNeededForBorder(row, border, r);
    if (need === null) continue;
    checked += 1;

    const rateWith = (extra) => (row.points + extra) / (row.runs + r);
    // (1) 必要得点ぶんを取れば届く
    if (need.reachable && rateWith(need.needed) < border - 1e-9) {
      bad.push(`${displayed} ${row.playerName}: needed=${need.needed} でも届かない`);
    }
    // (2) 1点少ないと届かない（needed>0 のときだけ意味がある）
    if (need.reachable && need.needed > 0 && rateWith(need.needed - 1) >= border) {
      bad.push(`${displayed} ${row.playerName}: needed-1 でも届く（過大）`);
    }
    // (3) 「届かず」は最大得点でも届かないときだけ
    const max = SCORE_POINTS[1] * r;
    if (!need.reachable && rateWith(max) >= border) {
      bad.push(`${displayed} ${row.playerName}: 届かず判定だが最大得点なら届く`);
    }
    if (need.reachable && need.needed > max) {
      bad.push(`${displayed} ${row.playerName}: reachable なのに max 超え`);
    }
  }
}

console.log("検証した (レース×選手) の組:", checked);
console.log("不整合:", bad.length);
bad.slice(0, 10).forEach((b) => console.log("  " + b));
process.exit(bad.length === 0 ? 0 : 1);
