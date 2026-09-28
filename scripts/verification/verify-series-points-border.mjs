// 実行: node --env-file=.env.local scripts/verification/verify-series-points-border.mjs
// CIには載せない（本番Supabaseへの接続と、特定の節のデータに依存するため）。
// 2026-09-28の実行結果:
//   若松G1   実ボーダー5.60 / 推定5.67（差0.07）。ズレの原因は途中帰郷の1名
//   桐生一般 実ボーダー4.50 / 推定5.33（差0.83）。一般戦は得点率順だけで
//            準優が決まらないことがある
import { supabase } from "./scripts/lib/supabaseClient.js";
import {
  buildMeetRanking,
  SEMIFINAL_DEFAULT_SLOTS,
} from "./src/components/race/seriesPoints.js";

// 必要得点はボーダー（準優の目安）を前提にしている。その推定が妥当かを
// 「実際に準優に乗った選手の最低得点率」と突き合わせて検証する。
const MEETS = [
  { vv: "20", from: "2026-09-22", to: "2026-09-27", name: "若松G1" },
  { vv: "01", from: "2026-09-20", to: "2026-09-25", name: "桐生一般" },
];

for (const m of MEETS) {
  const { data: entries } = await supabase
    .from("race_entries")
    .select("race_id, boat_number, racer_id, player_name")
    .gte("race_id", m.from)
    .lte("race_id", `${m.to}-zz`)
    .like("race_id", `__________-${m.vv}-__`);
  const raceIds = [...new Set((entries ?? []).map((e) => e.race_id))];
  const { data: results } = await supabase
    .from("race_results")
    .select("race_id, rank1, rank2, rank3, rank4, rank5, rank6")
    .in("race_id", raceIds);
  const { data: conds } = await supabase
    .from("race_conditions")
    .select("race_id, race_stage")
    .gte("race_id", m.from)
    .lte("race_id", `${m.to}-zz`)
    .like("race_id", `__________-${m.vv}-__`);

  const stage = new Map((conds ?? []).map((c) => [c.race_id, c.race_stage ?? ""]));
  const res = new Map((results ?? []).map((r) => [r.race_id, r]));
  const prelimEnd = (conds ?? [])
    .filter((c) => (c.race_stage ?? "").includes("予選"))
    .map((c) => c.race_id)
    .sort()
    .pop();
  const semifinalIds = (conds ?? [])
    .filter((c) => (c.race_stage ?? "").includes("準優"))
    .map((c) => c.race_id)
    .sort();

  const past = (entries ?? []).filter((e) => e.race_id <= prelimEnd);
  const ranking = buildMeetRanking({
    prelimEndRaceId: prelimEnd,
    entries: past.map((e) => ({
      raceId: e.race_id,
      boatNumber: e.boat_number,
      racerId: e.racer_id,
      playerName: e.player_name,
      raceStage: stage.get(e.race_id) ?? null,
      ...(res.get(e.race_id) ?? {}),
    })),
  });
  const rateById = new Map(ranking.map((r) => [r.racerId, r]));

  // 実際に準優に乗った選手
  const semifinalRacers = [
    ...new Set(
      (entries ?? [])
        .filter((e) => semifinalIds.includes(e.race_id))
        .map((e) => e.racer_id),
    ),
  ];
  const rates = semifinalRacers
    .map((id) => rateById.get(id))
    .filter(Boolean)
    .sort((a, b) => b.rate - a.rate);

  const slots = semifinalIds.length * 6 || SEMIFINAL_DEFAULT_SLOTS;
  const estimated = ranking[slots - 1]?.rate ?? null;
  const actualMin = rates.length ? rates[rates.length - 1].rate : null;

  console.log(`\n■ ${m.name}（準優 ${semifinalIds.length}個 = ${slots}枠）`);
  console.log("  予選終了レース:", prelimEnd);
  console.log("  準優に乗った人数:", rates.length);
  console.log(
    "  実際のボーダー（準優進出者の最低得点率）:",
    actualMin === null ? "—" : actualMin.toFixed(2),
    rates.length ? `（${rates[rates.length - 1].playerName.replace(/\s+/g, "")}）` : "",
  );
  console.log(
    "  当社の推定（予選終了時点の" + slots + "位の得点率）:",
    estimated === null ? "—" : estimated.toFixed(2),
  );
  if (actualMin !== null && estimated !== null) {
    console.log("  差:", (estimated - actualMin).toFixed(2));
  }
  // 推定ボーダー以上だったのに準優に乗らなかった人／その逆
  const inSemifinal = new Set(semifinalRacers);
  const missed = ranking.filter(
    (r) => estimated !== null && r.rate >= estimated && !inSemifinal.has(r.racerId),
  );
  const extra = ranking.filter(
    (r) => estimated !== null && r.rate < estimated && inSemifinal.has(r.racerId),
  );
  console.log(
    "  推定以上なのに準優に乗らなかった:",
    missed.length,
    missed.slice(0, 3).map((r) => `${r.playerName.replace(/\s+/g, "")}(${r.rate.toFixed(2)})`).join(" "),
  );
  console.log(
    "  推定未満なのに準優に乗った:",
    extra.length,
    extra.slice(0, 3).map((r) => `${r.playerName.replace(/\s+/g, "")}(${r.rate.toFixed(2)})`).join(" "),
  );
}
process.exit(0);
