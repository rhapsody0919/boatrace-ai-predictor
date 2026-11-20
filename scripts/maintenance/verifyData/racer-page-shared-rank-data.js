/**
 * verify-racer-page-shared.js の道具（番付の racer_page を偽の DB の上で回して見る）。verify ではない。
 * DB・ネットには繋がない。rank-data.js の回し方は rank-data-run.js。
 */
import { jstToday } from "../../sns/rankDataFormat.js";
import { runRankData } from "./rank-data-run.js";

const VENUE = 10;
const RACER = 4001;
const rid = (date, venue, no = 1) =>
  `${date}-${String(venue).padStart(2, "0")}-${String(no).padStart(2, "0")}`;
const addDays = (ymd, days) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** 出走表の日 day の選手 RACER と、その履歴（期間の外・端・中・後の日・他の会場）の表 */
function tablesFor(day, since) {
  const ids = {
    before: rid(addDays(since, -1), VENUE), // 730日の窓の外（含めない）
    edge: rid(since, VENUE, 2), // 窓の端の日（含む）
    card: rid(day, VENUE, 3), // 出走表の日のレース（含む）
    after: rid(addDays(day, 1), VENUE, 4), // 出走表の日より後（含めない）
    other: rid(addDays(day, -3), VENUE + 1, 5), // 他の会場（含めない）
  };
  const all = Object.values(ids);
  return {
    ids,
    tables: {
      race_entries: all.map((race_id) => ({
        race_id,
        boat_number: 1,
        racer_id: RACER,
        player_name: "山田　太郎",
        local_win_rate: 6.5,
      })),
      races: all.map((race_id) => ({ race_id, venue_code: Number(race_id.slice(11, 13)), race_grade: "一般" })),
      race_results: all.map((race_id) => ({ race_id, rank1: 1, rank2: 2, rank3: 3, winning_technique: "逃げ" })),
      race_start_timings: all.map((race_id) => ({ race_id, boat_number: 1, start_timing: 0.12, is_flying: false, entry_course: 1 })),
    },
  };
}

/**
 * 番付の racer_page が、選手ページと同じ関数・同じ引数（会場×1号艇、級・期間の指定なし）・同じ期間で数える。
 * 既定（今日）と今日の --date は見た時刻、過去の --date はその日の終わり（JST）に見たのと同じ。後の日の走は混ぜない
 */
export async function rankDataRacerPageScenes({ assert, aggregateRacerVenueBoatStats, racerHistoryCutoff }) {
  // 過去の日: 期間の始まりはその日の終わり（JST）から730日、終わりはその日まで
  const day = "2026-10-05";
  const asOf = new Date(`${day}T23:59:59+09:00`);
  const since = racerHistoryCutoff(asOf);
  const { ids, tables } = tablesFor(day, since);
  const past = await runRankData(["--dataset=racer_page", `--venue=${VENUE}`, `--date=${day}`], tables);
  assert.equal(past.exitCode, 0, `racer_page が落ちた: ${past.stderr}`);
  const cutoffs = past.spy.filter((s) => s.name === "racerHistoryCutoff");
  assert.deepStrictEqual(
    cutoffs.map((s) => s.args.map((a) => a.toISOString())),
    [[asOf.toISOString()]],
    "過去の --date はその日の終わり（JST）に見たのと同じ期間",
  );
  assert.deepStrictEqual(past.out.period.from, since, "期間の始まりは racerHistoryCutoff(その日の終わり)");
  const aggs = past.spy.filter((s) => s.name === "aggregateRacerVenueBoatStats");
  assert.equal(aggs.length, 1, "選手1人に1回、ページと同じ関数で数える");
  const [history, ...rest] = aggs[0].args;
  assert.deepStrictEqual(rest, [VENUE, 1, null, null], "番付はページの会場×1号艇と同じ引数");
  assert.deepStrictEqual(
    history.map((r) => r.raceId).sort(),
    [ids.edge, ids.card].sort(),
    "履歴は期間の端から出走表の日まで・その会場の走だけ（窓の外・後の日・他の会場を混ぜない）",
  );
  assert.deepStrictEqual(
    aggs[0].out,
    aggregateRacerVenueBoatStats(history, VENUE, 1, null, null),
    "番付の値はページと同じ関数の値",
  );
  const shownN = [...past.out.rows.map((r) => r.n), ...past.out.excluded.map((r) => r.n)];
  assert.ok(shownN.includes(aggs[0].out.n), `番付の走数はページの関数の走数（${aggs[0].out.n}）: ${JSON.stringify(shownN)}`);

  // 既定（今日）と今日の --date: ページと同じく見た時刻から730日
  const today = jstToday();
  for (const args of [[], [`--date=${today}`]]) {
    const run = await runRankData(
      ["--dataset=racer_page", `--venue=${VENUE}`, ...args],
      tablesFor(today, racerHistoryCutoff()).tables,
    );
    assert.equal(run.exitCode, 0, `racer_page ${args} が落ちた: ${run.stderr}`);
    const seen = run.spy.filter((s) => s.name === "racerHistoryCutoff").map((s) => s.args[0]?.getTime());
    assert.equal(seen.length, 1, `${JSON.stringify(args)}: 期間は1回だけ決める`);
    assert.ok(
      seen[0] >= run.startedAt && seen[0] <= run.endedAt,
      `${JSON.stringify(args)}: 今日はページと同じ見た時刻（${new Date(seen[0]).toISOString()}）`,
    );
  }
}
