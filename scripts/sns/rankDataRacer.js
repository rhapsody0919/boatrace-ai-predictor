// rank-data.js の racerPage から移した、選手ページの dataset の出走表・履歴の表の読み取りと、行・出力の組み立て
import { STADIUM_NAMES } from "../../src/constants/index.js";
import { SMALL_SAMPLE_THRESHOLD } from "../../src/pure/basicInfoStats.js";
import { readAll, readAllIn } from "./rank-data-db.js";
import { round, slash } from "./rankDataFormat.js";

/**
 * 番付の行に載せる最少の走数。目安（根拠なし）: プロジェクトの小標本の線 SMALL_SAMPLE_THRESHOLD（=6、BOA-306）を
 * 借りた。選手ページの会場×枠番のカードには線が無い（1走でも率を出す）。関門にはしない
 */
export const RACER_PAGE_MIN_RUNS = SMALL_SAMPLE_THRESHOLD;

/** その日・会場の出走表から選手ごとの最初の行（racer_id → 行）を作る。出走表が無ければ投げる */
export async function readRacerCard({ day, vv, venueCode }) {
  const card = await readAll(
    "race_entries",
    "race_id, boat_number, racer_id, player_name, local_win_rate",
    ["race_id", "boat_number"],
    (q) => q.like("race_id", `${day}-${vv}-__`),
  );
  const racers = new Map();
  for (const e of card) {
    if (e.racer_id != null && !racers.has(e.racer_id))
      racers.set(e.racer_id, e);
  }
  if (racers.size === 0)
    throw new Error(`${day} の${STADIUM_NAMES[venueCode]}の出走表が無い`);
  return racers;
}

/** 選手ページの getRacerRaceHistory と同じ表・列（結果のキー名・表・列・並び順のキー） */
const HISTORY_TABLES = [
  ["raceRows", "races", "race_id, venue_code, race_grade", ["race_id"]],
  [
    "resultRows",
    "race_results",
    "race_id, rank1, rank2, rank3, rank4, rank5, rank6, winning_technique, payout_win, payout_place_1, payout_place_2, race_status, actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6",
    ["race_id"],
  ],
  [
    "exhibitionRows",
    "exhibition_data",
    "race_id, boat_number, exhibition_time",
    ["race_id", "boat_number"],
  ],
  [
    "conditionRows",
    "race_conditions",
    "race_id, race_stage, race_title, weather, wind_speed, wave_height",
    ["race_id"],
  ],
  [
    "stRows",
    "race_start_timings",
    "race_id, boat_number, start_timing, is_flying, finish_mark, entry_course",
    ["race_id", "boat_number"],
  ],
];

/** 履歴の表をレース ID でまとめて読む（表の順に同時に読む） */
export async function readRacerHistoryTables(raceIds) {
  const rows = await Promise.all(
    HISTORY_TABLES.map(([, table, columns, order]) =>
      readAllIn(table, columns, "race_id", raceIds, order),
    ),
  );
  return Object.fromEntries(HISTORY_TABLES.map(([key], i) => [key, rows[i]]));
}

/** 出走（entries）を選手ごとにまとめる（racer_id → 出走の配列） */
export function groupEntriesByRacer(entries) {
  const entriesOf = new Map();
  for (const e of entries) {
    if (!entriesOf.has(e.racer_id)) entriesOf.set(e.racer_id, []);
    entriesOf.get(e.racer_id).push(e);
  }
  return entriesOf;
}

/** racer_page の rows（1号艇の逃げ率・平均ST・当地勝率）。stats は選手ごとの集計 */
export function racerPageRows(stats, venueCode) {
  const base = (s) => ({
    racer_id: s.racerId,
    class: s.grade,
    venue_code: venueCode,
  });
  return [
    ...stats
      .filter((s) => s.boat1.n >= RACER_PAGE_MIN_RUNS)
      .map((s) => ({
        name: s.name,
        k: s.boat1.tech["逃げ"] ?? 0,
        n: s.boat1.n,
        value: round(((s.boat1.tech["逃げ"] ?? 0) / s.boat1.n) * 100, 1),
        extra: {
          ...base(s),
          metric: "nige_rate_boat1",
          unit: "%",
          wins: s.boat1.win,
        },
      })),
    ...stats
      .filter(
        (s) => s.boat1.avgSt !== null && s.boat1.stN >= RACER_PAGE_MIN_RUNS,
      )
      .map((s) => ({
        name: s.name,
        k: null,
        n: s.boat1.stN,
        value: round(s.boat1.avgSt, 3),
        extra: { ...base(s), metric: "avg_st_boat1", unit: "秒" },
      })),
    ...stats
      .filter((s) => s.localWinRate !== null)
      .map((s) => ({
        name: s.name,
        k: null,
        n: null,
        value: Number(s.localWinRate),
        extra: {
          ...base(s),
          metric: "local_win_rate",
          unit: "点",
          source: "出走表の公式の当地勝率",
        },
      })),
  ];
}

/** racer_page の出力 */
export function racerPageOutput({ since, day, rows, stats }) {
  return {
    dataset: "racer_page",
    period: {
      from: since,
      to: day,
      label: `${slash(since)}〜${slash(day)}（選手ページと同じ最大過去2年）`,
    },
    scope: "today",
    unit: "racer",
    value_type: "rate",
    rows,
    excluded: stats
      .filter((s) => s.boat1.n < RACER_PAGE_MIN_RUNS)
      .map((s) => ({ racer_id: s.racerId, name: s.name, n: s.boat1.n })),
    min_n: RACER_PAGE_MIN_RUNS,
    baseline: null,
    observed_at: new Date().toISOString(),
    source_sha: null,
  };
}
