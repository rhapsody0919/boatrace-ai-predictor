/**
 * verify-meet-exclusion.js の場面のデータ（節の種別・出走表・getMeetScoreboard の場面）と、その呼び出し。verify ではない。
 */
import { meetExclusionsOf } from "../../../src/pure/meetExclusion.js";
import {
  createFakeSupabase,
  installLocalStorage,
  registerFakeServiceSupabase,
  useFakeSupabase as setFakeSupabase,
} from "./fakeServiceSupabase.js";

// 節: 10/1〜10/2 が予選、10/3 が準優（1R）・優勝戦（2R）
const conditions = [
  { race_id: "2026-10-01-04-01", race_stage: "予選" },
  { race_id: "2026-10-01-04-02", race_stage: "予選" },
  { race_id: "2026-10-02-04-01", race_stage: "予選" },
  { race_id: "2026-10-02-04-02", race_stage: "予選" },
  { race_id: "2026-10-03-04-01", race_stage: "準優勝戦" },
  { race_id: "2026-10-03-04-02", race_stage: "優勝戦" },
];
export const entry = (race_id, boat_number, racer_id) => ({
  race_id,
  boat_number,
  racer_id,
});
export const st = (race_id, boat_number, extra = {}) => ({
  race_id,
  boat_number,
  is_flying: false,
  finish_mark: null,
  ...extra,
});

const base = {
  usesOfficialSeries: false,
  officialSeries: null,
  conditions,
  meetStarts: [],
  meetRows: [],
  prelimOfficial: null,
  date: "2026-10-02",
};
export const run = (over) => meetExclusionsOf({ ...base, ...over });
export const excluded = (out) => new Set(out.withdrawnRacerIds);

let count = 0;
export const check = (name, fn) => {
  fn();
  count += 1;
  console.log(`  ok ${name}`);
};
export const checked = () => count;

// getMeetScoreboard の場面（会場 04）。表示中のレースは 10/3 の1R
const SB_DISPLAY = "2026-10-03-04-01";
const sbConditions = conditions.map((c, i) => ({
  ...c,
  series_day: Math.floor(i / 2) + 1,
  is_final_day: false,
}));
const SB_RACERS = [5601, 5602, 5603, 5604, 5605, 5606];
const sbEntries = conditions.flatMap((c) =>
  SB_RACERS.map((racer_id, i) => ({
    race_id: c.race_id,
    boat_number: i + 1,
    racer_id,
    player_name: `選手${racer_id}`,
    motor_number: 10 + i,
  })),
);

// サービス層（getMeetScoreboard）を偽の supabase の上で呼ぶ。サービス層を import する前に偽の hook を入れる
registerFakeServiceSupabase();
installLocalStorage();
const { getMeetScoreboard } =
  await import("../../../src/services/meetQueries2.js");
const { clearCache } = await import("../../../src/services/core.js");

/** 場面（meetStarts・officialSeries・display・useOfficial）で getMeetScoreboard を呼んだ返り値 */
function scoreboardOf({
  meetStarts = [],
  officialSeries = [],
  display = SB_DISPLAY,
  useOfficial,
}) {
  clearCache();
  setFakeSupabase(
    createFakeSupabase({
      race_entries: sbEntries,
      race_conditions: sbConditions,
      race_start_timings: meetStarts,
      racer_series_points: officialSeries.map((r) => ({
        venue_code: 4,
        meet_start_date: "2026-10-01",
        ...r,
      })),
    }),
  );
  return getMeetScoreboard(display, 4, { useOfficial });
}
const official = (racer_id, remarks) => ({
  racer_id,
  remarks,
  placements: "",
  total_points: 0,
  penalty_points: 0,
  scraped_at: "2026-10-02T12:00:00Z",
});

const SCOREBOARD_CASES = [
  {
    name: "C1a getMeetScoreboard: 予選中の今節F（表示中のレースより前）は賞典除外（flying）で順位の対象から外す",
    meetStarts: [st("2026-10-01-04-01", 3, { is_flying: true })],
    withdrawn: [5603],
    reasons: { 5603: "flying" },
  },
  {
    // 優勝戦（2R）を表示。準優（1R）のFは予選終了より後なので外さない
    name: "C1b getMeetScoreboard: 予選終了より後のFは見ない（予選の締めを種別から取る）",
    display: "2026-10-03-04-02",
    meetStarts: [st("2026-10-03-04-01", 3, { is_flying: true })],
    withdrawn: [],
    reasons: {},
  },
  {
    // 備考があれば推定のFは見ない
    name: "C1c getMeetScoreboard: 公式の備考は予選の後（表示中が準優）に使い、賞典除外・途中帰郷を分ける",
    meetStarts: [st("2026-10-01-04-01", 3, { is_flying: true })],
    officialSeries: [
      official(5601, "賞典除外"),
      official(5602, "途中帰郷"),
      official(5604, null),
    ],
    withdrawn: [5601, 5602],
    reasons: { 5601: "awardExcluded", 5602: "officialWithdrawn" },
  },
];

/** 場面ごとに { c: 場面, board: getMeetScoreboard の返り値 } を順に返す */
export async function* scoreboardRuns() {
  for (const c of SCOREBOARD_CASES) yield { c, board: await scoreboardOf(c) };
}
