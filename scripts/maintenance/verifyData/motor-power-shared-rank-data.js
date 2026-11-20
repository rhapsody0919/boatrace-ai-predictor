/**
 * verify-motor-power-shared.js の道具（番付の motor_power を偽の DB の上で回す・画面の詳細の評価の色を出す）。verify ではない。
 * DB・ネットには繋がない。rank-data.js の回し方は rank-data-run.js。
 */
import { runRankData } from "./rank-data-run.js";

const VENUE = 2;
const TO = "2026-10-10";

/** 会場 2 の 9/10 から1日1レース。runsOf はモーター番号 → 走数 */
function motorTables(runsOf) {
  const motors = Object.entries(runsOf).flatMap(([motor, runs]) => Array(runs).fill(Number(motor)));
  const races = motors.map((_, i) => {
    const date = new Date(Date.UTC(2026, 8, 10 + i)).toISOString().slice(0, 10);
    return { race_id: `${date}-02-01`, race_date: date, venue_code: VENUE };
  });
  return {
    venue_motor_start_dates: [{ venue_code: VENUE, start_date: "2026-09-01" }],
    races,
    race_entries: races.map((r, i) => ({ race_id: r.race_id, boat_number: 1, motor_number: motors[i], global_2rate: 30 })),
    race_results: races.map((r, i) => ({ race_id: r.race_id, rank1: i % 2 ? 1 : 3, rank2: i % 2 ? 2 : 4, rank3: 5 })),
  };
}

/**
 * 番付に載せる機は、画面が評価の言葉を出す走数（SMALL_SAMPLE_THRESHOLD）以上。未満の機は excluded。
 * 数えるのは画面と同じ computeVenueMotorPowerIndexes
 */
export async function rankDataMotorPowerScenes({ assert, computeVenueMotorPowerIndexes, threshold }) {
  const runsOf = { 11: threshold - 1, 12: threshold, 13: threshold + 1 };
  const tables = motorTables(runsOf);
  const run = await runRankData(["--dataset=motor_power", `--venue=${VENUE}`, `--to=${TO}`], tables);
  assert.equal(run.exitCode, 0, `motor_power が落ちた: ${run.stderr}`);
  const resultByRaceId = new Map(tables.race_results.map((r) => [r.race_id, r]));
  const indexes = computeVenueMotorPowerIndexes(tables.race_entries, resultByRaceId);
  assert.deepStrictEqual(
    run.out.rows.map((r) => r.extra.motor_number).sort(),
    indexes.filter((m) => m.sample_count >= threshold).map((m) => m.motor_number).sort(),
    "番付に載せるのは画面の小標本の線（SMALL_SAMPLE_THRESHOLD）以上の機",
  );
  assert.deepStrictEqual(
    run.out.rows.map((r) => r.extra.motor_number).sort(),
    [12, 13],
    "線ちょうどの機は載せ、1走足りない機は載せない",
  );
  assert.deepStrictEqual(run.out.excluded, [{ motor_number: 11, n: threshold - 1 }], "線に足りない機は excluded");
  assert.equal(run.out.min_n, threshold, "載せる最少の走数は画面の SMALL_SAMPLE_THRESHOLD");
}

/**
 * 画面のモーターの詳細（ドリルダウン）の機力指数の色は、走数が SMALL_SAMPLE_THRESHOLD 未満なら小標本（small）。
 * 画面の値を導く useMotorView（motorConditionView.jsx、hook を使わない関数）を呼んで見る
 */
export async function chartPowerIndexToneScenes({ assert, threshold }) {
  const { useMotorView: motorViewOf } = await import("../../../src/components/analysis/motorConditionView.jsx");
  const toneAt = (power_index, sample_count) =>
    motorViewOf({
      t: (key) => key,
      breakdown: [],
      venueRanks: null,
      selectedRace: null,
      generationStart: null,
      venues: [],
      selectedVenue: VENUE,
      drillDownMotor: null,
      meetParts: null,
      partsBoat: null,
      powerIndex: { power_index, sample_count },
      usageHistory: [],
      trendData: [],
      freshness: null,
      explainBoat: null,
    }).drillPowerIndexTone;
  assert.deepStrictEqual(
    [toneAt(3, threshold - 1), toneAt(3, threshold), toneAt(-3, threshold), toneAt(3, null), toneAt(null, threshold)],
    ["small", "good", "bad", "good", null],
    "画面の小標本の線が SMALL_SAMPLE_THRESHOLD のまま（詳細の機力指数の色）",
  );
}
