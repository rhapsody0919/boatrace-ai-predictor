// 実行: node --env-file=.env.local scripts/verification/verify-series-points-border.mjs
// CIには載せない（本番Supabaseへの接続と、特定の節のデータに依存するため）。
// 2026-09-28の実行結果（BOA-457/458の配点・算入範囲の見直し後）:
//   若松G1   実ボーダー5.60 / 推定5.67（差0.07）。離脱者2名を除くと 5.60 で完全一致
//   桐生一般 実ボーダー4.83 / 推定6.17（差1.33。離脱者5名を除くと 5.50 で差0.67）
//
// **桐生の節（2026-09-20〜25）は男女別編成**で、この検証には向かない。種別が
// 「予選男子」「予選女子」と分かれ、準優4個＝男子2個・女子2個、優勝戦も2個ある。
// 当社の節内順位は男女を混ぜて1本のランキングにしているため、男女別に選ばれる
// 準優進出者とは原理的に一致しない（差が縮まないのは配点の誤りではない）。
// 男女別編成は2026-02〜09で1節・46レースだけなので別課題として扱う。
import { supabase } from "../lib/supabaseClient.js";
import {
  buildMeetRanking,
  prelimEndRaceIdOf,
  semifinalRaceIdsOf,
  SEMIFINAL_DEFAULT_SLOTS,
} from "../../src/components/race/seriesPoints.js";
// 取得失敗を「データなし」に化けさせない。`scripts/lib/supabaseClient.js` は
// 15秒でfetchを中断する（undiciが無期限にハングする既知の不具合への対策）ため、
// エラーを見ないと**空の結果で検証が緑になる**（2026-09-28、若松の出走表が
// 空で返り「準優に乗った人数: 0」と出たのに成功扱いになっていた）
async function must(label, run) {
  let last = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await run();
    if (!error) {
      if (!data || data.length === 0) throw new Error(`${label}が0件`);
      return data;
    }
    last = error;
  }
  throw new Error(`${label}の取得に失敗: ${last.message}`);
}


// 必要得点はボーダー（準優の目安）を前提にしている。その推定が妥当かを
// 「実際に準優に乗った選手の最低得点率」と突き合わせて検証する。
const MEETS = [
  { vv: "20", from: "2026-09-22", to: "2026-09-27", name: "若松G1" },
  { vv: "01", from: "2026-09-20", to: "2026-09-25", name: "桐生一般" },
];

for (const m of MEETS) {
  const entries = await must(`${m.name}の出走表`, () =>
    supabase
      .from("race_entries")
    .select("race_id, boat_number, racer_id, player_name")
    .gte("race_id", m.from)
    .lte("race_id", `${m.to}-zz`)
      .like("race_id", `__________-${m.vv}-__`),
  );
  const raceIds = [...new Set(entries.map((e) => e.race_id))];
  const results = await must(`${m.name}の結果`, () =>
    supabase
      .from("race_results")
      .select("race_id, rank1, rank2, rank3, rank4, rank5, rank6")
      .in("race_id", raceIds),
  );
  // 本番STの記録。欠場（走っていない）を走数から外すために要る（BOA-489）。
  // STが1行も無いレースは取得漏れの可能性があるので全艇を出走扱いに倒す
  const startRows = await must(`${m.name}のST`, () =>
    supabase
      .from("race_start_timings")
      .select("race_id, boat_number, finish_mark")
      .in("race_id", raceIds),
  );
  // 欠場艇にも行がある（finish_mark='欠'）ので、それは出走に数えない（getMeetScoreboard と同じ）
  const startedKeys = new Set(
    (startRows ?? [])
      .filter((r) => r.finish_mark !== "欠")
      .map((r) => `${r.race_id}|${r.boat_number}`),
  );
  const racesWithSt = new Set((startRows ?? []).map((r) => r.race_id));
  const didStart = (raceId, boatNumber) =>
    !racesWithSt.has(raceId) || startedKeys.has(`${raceId}|${boatNumber}`);
  const conds = await must(`${m.name}の種別`, () =>
    supabase
      .from("race_conditions")
      .select("race_id, race_stage")
      .gte("race_id", m.from)
      .lte("race_id", `${m.to}-zz`)
      .like("race_id", `__________-${m.vv}-__`),
  );

  const stage = new Map((conds ?? []).map((c) => [c.race_id, c.race_stage ?? ""]));
  const res = new Map((results ?? []).map((r) => [r.race_id, r]));
  const prelimEnd = prelimEndRaceIdOf(conds ?? []);
  const semifinalIds = semifinalRaceIdsOf(conds ?? []);

  // 算入範囲の絞り込みは `buildMeetRanking`（`countsForSeriesScore`）に任せる。
  // ここで `race_id <= prelimEnd` で切ってしまうと、予選最終日の「予選」ラベル
  // 以降のレース（芦屋「サンライズＸ戦」等）が落ちて二重の絞り込みになる
  const ranking = buildMeetRanking({
    prelimEndRaceId: prelimEnd,
    entries: (entries ?? []).map((e) => ({
      raceId: e.race_id,
      boatNumber: e.boat_number,
      racerId: e.racer_id,
      playerName: e.player_name,
      raceStage: stage.get(e.race_id) ?? null,
      started: didStart(e.race_id, e.boat_number),
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

  // 節の最終日に出走が無い選手（＝途中で離脱した選手）を除いた場合の推定。
  // 公式の順位表も途中帰郷の選手を順位から外している
  const meetDates = [
    ...new Set((entries ?? []).map((e) => e.race_id.slice(0, 10))),
  ].sort();
  const lastDay = meetDates[meetDates.length - 1];
  const ranAtLastDay = new Set(
    (entries ?? [])
      .filter((e) => e.race_id.startsWith(lastDay))
      .map((e) => e.racer_id),
  );
  const withoutWithdrawn = ranking.filter((r) => ranAtLastDay.has(r.racerId));
  const estimatedExcl = withoutWithdrawn[slots - 1]?.rate ?? null;
  const withdrawn = ranking.filter((r) => !ranAtLastDay.has(r.racerId));
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
  console.log(
    "  途中離脱（最終日に出走なし）:",
    withdrawn.length,
    withdrawn
      .map((r) => `${r.playerName.replace(/\s+/g, "")}(${r.rate.toFixed(2)})`)
      .join(" "),
  );
  console.log(
    "  離脱者を除いた推定:",
    estimatedExcl === null ? "—" : estimatedExcl.toFixed(2),
    actualMin !== null && estimatedExcl !== null
      ? `→ 差 ${(estimatedExcl - actualMin).toFixed(2)}`
      : "",
  );
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
