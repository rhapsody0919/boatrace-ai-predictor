// rank-data.js の motorPower から移した、機力指数の読み取り（世代・期間・レース・出走・結果）と出力の組み立て
import { STADIUM_NAMES } from "../../src/constants/index.js";
import { motorWindowFrom } from "../../src/utils/motorPowerIndex.js";
import {
  currentMotorGenerationStart,
  motorGenerationStartAsOf,
} from "../../src/utils/motorGeneration.js";
import { formatPowerIndex } from "../../src/utils/smallSampleRate.js";
import { SMALL_SAMPLE_THRESHOLD } from "../../src/pure/basicInfoStats.js";
import { readAll, readAllIn } from "./rank-data-db.js";
import { round, slash } from "./rankDataFormat.js";

/** 機力指数の期間（画面の既定、MotorConditionChart の「過去90日」） */
export const MOTOR_POWER_DAYS = 90;

/** 会場の使用開始日から機力指数の期間（window）を作る。分からなければ投げる */
export async function readMotorWindow({ venueCode, to, baseDate }) {
  const starts = await readAll(
    "venue_motor_start_dates",
    "start_date",
    ["start_date"],
    (q) => q.eq("venue_code", venueCode),
  );
  // 世代: 既定は画面と同じ最新の使用開始日。--to=D は D の時点の世代（D の翌日に入れ替えた会場で、
  // 新しい世代の開始日から数えて0件にならないように）
  const window = motorWindowFrom(
    to
      ? motorGenerationStartAsOf(starts, to)
      : currentMotorGenerationStart(starts),
    MOTOR_POWER_DAYS,
    baseDate,
  );
  if (window.since === null) {
    throw new Error(
      `${STADIUM_NAMES[venueCode]} はモーターの使用開始日が分からない（画面も機力指数を出さない）`,
    );
  }
  return window;
}

/** 期間のレース・出走・結果を読む。before はレース ID の上限（無ければ null） */
export async function readMotorData({ venueCode, window, before }) {
  // 画面の getRacesForVenueSince と同じ: 会場・race_date が since 以降（上限があれば race_id < 上限）
  const races = (
    await readAll(
      "races",
      "race_id, race_date",
      ["race_date", "race_id"],
      (q) =>
        q
          .eq("venue_code", venueCode)
          .gte("race_date", window.since)
          .lte("race_date", before ?? "9999-12-31"),
    )
  ).filter((r) => before === null || r.race_id < before);
  const raceIds = races.map((r) => r.race_id);
  const [entries, results] = await Promise.all([
    readAllIn(
      "race_entries",
      "race_id, boat_number, motor_number, global_2rate",
      "race_id",
      raceIds,
      ["race_id", "boat_number"],
    ),
    readAllIn(
      "race_results",
      "race_id, rank1, rank2, rank3",
      "race_id",
      raceIds,
      ["race_id"],
    ),
  ]);
  const resultByRaceId = new Map(results.map((r) => [r.race_id, r]));
  return { races, entries, resultByRaceId };
}

/** motor_power の出力（結果のあった最後の日が無ければ投げる）。shown は番付に載せる機、indexes は全機 */
export function motorPowerOutput({
  venueCode,
  window,
  races,
  resultByRaceId,
  shown,
  indexes,
}) {
  const lastDay =
    races
      .filter((r) => resultByRaceId.has(r.race_id))
      .map((r) => r.race_date)
      .sort()
      .at(-1) ?? null;
  if (lastDay === null) {
    throw new Error(
      `${STADIUM_NAMES[venueCode]} は ${window.since} 以降に結果のあるレースが無い`,
    );
  }
  const name = STADIUM_NAMES[venueCode];
  const toLabel = lastDay ? slash(lastDay) : "";
  return {
    dataset: "motor_power",
    period: {
      from: window.since,
      to: lastDay,
      label: window.clippedByGeneration
        ? `${slash(window.since)}（モーターの使用開始）〜${toLabel}`
        : `${slash(window.since)}〜${toLabel}（過去${MOTOR_POWER_DAYS}日）`,
    },
    scope: "90d",
    unit: "motor",
    value_type: "mean",
    rows: [...shown]
      .sort(
        (a, b) =>
          b.power_index - a.power_index || a.motor_number - b.motor_number,
      )
      .map((m) => ({
        name: `${name}${m.motor_number}号機`,
        k: null,
        n: m.sample_count,
        value: round(m.power_index, 1),
        extra: {
          venue_code: venueCode,
          motor_number: m.motor_number,
          label: formatPowerIndex(m.power_index),
          actual_rate2: round(m.actual_rate2, 1),
          avg_baseline_rate2: round(m.avg_baseline_rate2, 1),
          clipped_by_generation: window.clippedByGeneration,
          generation_start: window.generationStart,
        },
      })),
    excluded: indexes
      .filter((m) => m.sample_count < SMALL_SAMPLE_THRESHOLD)
      .map((m) => ({ motor_number: m.motor_number, n: m.sample_count })),
    min_n: SMALL_SAMPLE_THRESHOLD,
    baseline: { label: "選手の実力どおり", value: 0 },
    observed_at: new Date().toISOString(),
    source_sha: null,
  };
}
