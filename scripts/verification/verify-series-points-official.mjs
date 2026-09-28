// 実行: node --env-file=.env.local scripts/verification/verify-series-points-official.mjs
// CIには載せない（本番Supabaseへの接続と、収録済みの開催のデータに依存するため）。
//
// BOA-475 の受け入れ基準を実データで確かめる。
//
//   (1) 公式の行から組み立てた節内順位が、公式の `rank` と完全一致すること
//       （減点を反映する前は多摩川G1で45名中25名がズレていた）
//   (2) 公式の行がある節を、画面と同じキー（venue_code + meet_start_date）で
//       **必ず引けること**。引けないと黙って当社計算に戻り、開催によって値が
//       変わる原因になる
//
// 2026-09-28の実行結果: 2開催とも順位が全件一致（多摩川G1 45/45・若松G1 49/49）。
// キーのズレで公式行を取れなかった節は0件。
import { supabase } from "../lib/supabaseClient.js";
import {
  buildMeetRanking,
  prelimEndRaceIdOf,
  officialSeriesScore,
} from "../../src/components/race/seriesPoints.js";

// 取得失敗を「データなし」に化けさせない。`scripts/lib/supabaseClient.js` は
// 15秒でfetchを中断するため、エラーを見ないと空の結果で検証が緑になる
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

const official = await must("公式の得点率一覧", () =>
  supabase
    .from("racer_series_points")
    .select(
      "venue_code, meet_start_date, racer_id, player_name, rank, score_rate, placements, total_points, penalty_points, remarks",
    ),
);

const meets = [
  ...new Map(
    official.map((r) => [
      `${r.venue_code}|${r.meet_start_date}`,
      { venueCode: r.venue_code, meetStart: r.meet_start_date },
    ]),
  ).values(),
];
console.log(`公式の行がある節: ${meets.length}（${official.length}行）\n`);

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`  ❌ ${msg}`);
};

for (const m of meets) {
  const vv = String(m.venueCode).padStart(2, "0");
  const rows = official.filter(
    (r) => r.venue_code === m.venueCode && r.meet_start_date === m.meetStart,
  );

  // (2) 画面と同じキーで引けるか。`getMeetScoreboard` は節の開始日を
  //     `race_id` の日付の連続性から推定し、それを `meet_start_date` に当てる。
  //     収録側は `race_conditions.series_day` からの逆算なので、ズレうる
  const byKey = await must(`${vv} ${m.meetStart} のキー一致`, () =>
    supabase
      .from("racer_series_points")
      .select("racer_id")
      .eq("venue_code", m.venueCode)
      .eq("meet_start_date", m.meetStart),
  );
  if (byKey.length !== rows.length) {
    fail(`v${vv} ${m.meetStart}: キーで引けた行 ${byKey.length} ≠ 実際 ${rows.length}`);
  }

  // 節の全レース（開始日から最長9日）
  const entries = await must(`v${vv} ${m.meetStart} の出走表`, () =>
    supabase
      .from("race_entries")
      .select("race_id, boat_number, racer_id, player_name")
      .gte("race_id", m.meetStart)
      .lte("race_id", `${addDays(m.meetStart, 9)}-zz`)
      .like("race_id", `__________-${vv}-__`),
  );
  const raceIds = [...new Set(entries.map((e) => e.race_id))];
  const conds = await must(`v${vv} ${m.meetStart} の種別`, () =>
    supabase
      .from("race_conditions")
      .select("race_id, race_stage, is_final_day")
      .in("race_id", raceIds),
  );
  const results = await must(`v${vv} ${m.meetStart} の結果`, () =>
    supabase
      .from("race_results")
      .select("race_id, rank1, rank2, rank3, rank4, rank5, rank6")
      .in("race_id", raceIds),
  );

  // 節の終わり（次の節が始まる前まで）に絞る
  const finalDay =
    conds.find((c) => c.is_final_day)?.race_id.slice(0, 10) ?? null;
  const inMeet = (id) => !finalDay || id.slice(0, 10) <= finalDay;

  const stage = new Map(conds.map((c) => [c.race_id, c.race_stage ?? ""]));
  const res = new Map(results.map((r) => [r.race_id, r]));
  const prelimEnd = prelimEndRaceIdOf(conds.filter((c) => inMeet(c.race_id)));

  const ranking = buildMeetRanking({
    prelimEndRaceId: prelimEnd,
    withdrawnRacerIds: rows.filter((r) => r.remarks).map((r) => r.racer_id),
    officialByRacer: Object.fromEntries(rows.map((r) => [r.racer_id, r])),
    entries: entries
      .filter((e) => inMeet(e.race_id))
      .map((e) => ({
        raceId: e.race_id,
        boatNumber: e.boat_number,
        racerId: e.racer_id,
        playerName: e.player_name,
        raceStage: stage.get(e.race_id) ?? null,
        ...(res.get(e.race_id) ?? {}),
      })),
  });

  // (1) 順位が公式と一致するか（公式が順位を付けている選手だけを比べる）
  const mineByRacer = new Map(ranking.map((r) => [r.racerId, r]));
  const ranked = rows.filter((r) => r.rank !== null);
  let match = 0;
  const diffs = [];
  for (const o of ranked) {
    const mine = mineByRacer.get(o.racer_id);
    if (mine && mine.rank === o.rank) {
      match += 1;
    } else {
      diffs.push(
        `${o.player_name?.replace(/\s+/g, "")}(${o.racer_id}) 公式${o.rank}位 vs 当社${mine?.rank ?? "—"}位` +
          `（公式rate=${o.score_rate} 当社rate=${mine?.rate?.toFixed(2) ?? "—"}）`,
      );
    }
  }
  const ok = match === ranked.length;
  console.log(
    `■ v${vv} ${m.meetStart}: 順位一致 ${match}/${ranked.length} ${ok ? "✅" : "❌"}`,
  );
  if (!ok) {
    failures += 1;
    diffs.slice(0, 8).forEach((d) => console.error(`    ${d}`));
  }

  // 得点率そのものも突き合わせる（読み替えが公式の値を再現するか）
  let rateMatch = 0;
  for (const o of ranked) {
    const mine = mineByRacer.get(o.racer_id);
    const expected = officialSeriesScore(o);
    if (
      mine &&
      expected &&
      Math.abs(mine.rate - Number(o.score_rate)) < 0.005 &&
      mine.runs === expected.runs
    )
      rateMatch += 1;
  }
  console.log(
    `  得点率・走数の一致 ${rateMatch}/${ranked.length} ${rateMatch === ranked.length ? "✅" : "❌"}`,
  );
  if (rateMatch !== ranked.length) failures += 1;
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

console.log(failures === 0 ? "\n全件パス" : `\n失敗 ${failures} 件`);
process.exit(failures === 0 ? 0 : 1);
