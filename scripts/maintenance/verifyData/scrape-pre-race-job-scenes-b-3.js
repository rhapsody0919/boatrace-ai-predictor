/**
 * verify-scrape-pre-race-job.js の後半の場面（3/4）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-pre-race-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { runForRaces as realRaceInfoRun } from "../../daily/update-race-info.js";
import { runForRaces as realExhibitionRun } from "../../daily/scrape-exhibition-data.js";
import { computeRaceInfoDigest, computeExhibitionDigest } from "../../lib/scrapeJobs/preRaceDigest.js";
import { createRaceInfoSlotHandler, createExhibitionSlotHandler } from "../../lib/scrapeJobs/preRaceHandlers.js";
import {
  compareRaceInfoShadowDigests,
  compareExhibitionShadowDigests,
} from "../check-pre-race-shadow.js";
import { checkShadowReadOnly } from "./cron-entry-checks.js";
import { runExhibition } from "./scrape-pre-race-job-scenes-b-1.js";

let check, show, RACE, RACE_11, freshDb, runRaceInfo;

export const riHandler = () => createRaceInfoSlotHandler();

// 予定の時刻（pollMinBefore。BOA-1145）を外した、取得の経路そのものの検証。予定の時刻の検証は (l)
export const exHandler = () => createExhibitionSlotHandler({ pollMinBefore: null });

/** 元の verify の1つの塊 { } を割った 1/2 */
function sprjb3Scene1() {
  const entry = (n, extra = {}) => ({
    race_id: RACE,
    boat_number: n,
    racer_id: 4000 + n,
    player_name: `選手${n}`,
    grade: "A1",
    age: 30,
    win_rate: 6.5,
    local_win_rate: 6.1,
    global_2rate: 50,
    local_2rate: 48.5,
    global_3rate: 70,
    local_3rate: 66,
    motor_number: 10 + n,
    motor_2rate: 40,
    motor_3rate: 60,
    boat_number_id: 20 + n,
    boat_2rate: 35,
    boat_3rate: 55,
    ...extra,
  });
  const entries = [1, 2, 3, 4, 5, 6].map((n) => entry(n));
  const condition = {
    race_id: RACE,
    series_day: 2,
    is_final_day: false,
    race_title: "杯",
    race_stage: "予選",
  };
  const base = computeRaceInfoDigest({
    entries,
    condition,
    raceGrade: "ippan",
  });
  check(
    "digest(A1): 艇の並び順に依らない。081の追加列・updated_at・null と undefined の差に依らない",
    base ===
      computeRaceInfoDigest({
        entries: [...entries].reverse().map((e) => ({
          ...e,
          weight_kg: 52,
          branch: "福岡",
          updated_at: "2026-09-16T00:00:00Z",
          hometown: undefined,
        })),
        condition: { ...condition, race_distance_m: 1800, race_labels: [] },
        raceGrade: "ippan",
      }),
  );
  const changes = [
    [
      "選手の勝率",
      (es) => es.map((e, i) => (i === 2 ? { ...e, win_rate: 6.6 } : e)),
    ],
    [
      "選手の登録番号",
      (es) => es.map((e, i) => (i === 0 ? { ...e, racer_id: 1 } : e)),
    ],
    [
      "モーター番号",
      (es) => es.map((e, i) => (i === 5 ? { ...e, motor_number: 99 } : e)),
    ],
    ["艇の数", (es) => es.slice(0, 5)],
  ];
  check(
    "digest(A1): 対象の列の値・艇の数の変化で変わる",
    changes.every(
      ([, mutate]) =>
        computeRaceInfoDigest({
          entries: mutate(entries),
          condition,
          raceGrade: "ippan",
        }) !== base,
    ) &&
      computeRaceInfoDigest({
        entries,
        condition: { ...condition, race_stage: "準優" },
        raceGrade: "ippan",
      }) !== base &&
      computeRaceInfoDigest({ entries, condition, raceGrade: "sg" }) !== base,
  );
  return { entry, condition };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function sprjb3Scene2({ entry, condition }) {
  let threw = "";
  try {
    computeRaceInfoDigest({
      entries: [entry(1), entry(1)],
      condition,
      raceGrade: null,
    });
  } catch (error) {
    threw = error.message;
  }
  check(
    "digest(A1): 艇番の重複は例外（比較が意味を持たない）",
    /重複/.test(threw),
    threw,
  );
  const ex = (n, extra = {}) => ({
    race_id: RACE,
    boat_number: n,
    exhibition_time: 6.7 + n / 100,
    start_timing: 0.1,
    tilt: -0.5,
    propeller_change: null,
    parts_changed: ["ピストン"],
    adjustment_weight: 0,
    today_weight: 52.5,
    prev_race_no: 4,
    prev_entry_course: 2,
    prev_start_timing: 0.15,
    prev_finish_rank: 3,
    ...extra,
  });
  const exRows = [1, 2, 3, 4, 5, 6].map((n) => ex(n));
  const exBase = computeExhibitionDigest(exRows);
  check(
    "digest(A2): 並び順・082の追加列・欠場艇の行に依らない。parts_changed の配列表記に依らない",
    exBase ===
      computeExhibitionDigest([
        ...[...exRows].reverse().map((r) => ({
          ...r,
          exhibition_course: 3,
          start_flag: null,
          prev_finish_mark: "3",
          is_absent: false,
        })),
        {
          race_id: RACE,
          boat_number: 7,
          exhibition_time: null,
          start_timing: null,
          is_absent: true,
        },
      ]),
  );
  check(
    "digest(A2): 展示タイム・ST・部品交換の変化で変わる",
    computeExhibitionDigest(
      exRows.map((r, i) => (i === 0 ? { ...r, exhibition_time: 6.9 } : r)),
    ) !== exBase &&
      computeExhibitionDigest(
        exRows.map((r, i) => (i === 3 ? { ...r, start_timing: 0.2 } : r)),
      ) !== exBase &&
      computeExhibitionDigest(
        exRows.map((r, i) =>
          i === 1 ? { ...r, parts_changed: ["キャブレター"] } : r,
        ),
      ) !== exBase,
  );
}

async function sprjb3Scene3() {
  {
    const s1 = sprjb3Scene1();
    sprjb3Scene2(s1);
  }
  // shadow の集計（check-pre-race-shadow.js）: shadow のダイジェストと、DBの行から計算したダイジェストの比較
  {
    const liveDb = freshDb();
    await runRaceInfo(realRaceInfoRun, liveDb, { mode: "live" });
    await runExhibition(realExhibitionRun, liveDb, { mode: "live" });
    const shadowRi = (
      await runRaceInfo(realRaceInfoRun, freshDb(), { mode: "shadow" })
    ).result;
    const shadowEx = (
      await runExhibition(realExhibitionRun, freshDb(), { mode: "shadow" })
    ).result;
    const dbOf = {
      entries: liveDb.state.tables.race_entries,
      conditions: liveDb.state.tables.race_conditions,
      races: liveDb.state.tables.races,
    };
    const ri = compareRaceInfoShadowDigests(
      [
        { race_id: RACE, result_digest: shadowRi.resultDigest },
        { race_id: RACE_11, result_digest: shadowRi.resultDigest },
        { race_id: "2026-09-16-23-10", result_digest: null },
      ],
      dbOf,
    );
    check(
      "check-pre-race-shadow（A1）: 一致は一致、比べる行が無いレースは『比べる行なし』、digest 未記録は別に数える（不一致に数えない）",
      ri.matched === 1 &&
        ri.mismatched.length === 0 &&
        ri.missing.length === 1 &&
        ri.noDigest.length === 1,
      show(ri),
    );
    const riBad = compareRaceInfoShadowDigests(
      [{ race_id: RACE, result_digest: "0000000000000000" }],
      dbOf,
    );
    check(
      "check-pre-race-shadow（A1）: ダイジェストが違えば不一致として数える",
      riBad.matched === 0 && riBad.mismatched.length === 1,
    );
    const ex = compareExhibitionShadowDigests(
      [
        { race_id: RACE, result_digest: shadowEx.resultDigest },
        { race_id: RACE_11, result_digest: shadowEx.resultDigest },
      ],
      liveDb.state.tables.exhibition_data,
    );
    check(
      "check-pre-race-shadow（A2）: 一致は一致、比べる行が無いレースは『比べる行なし』",
      ex.matched === 1 && ex.mismatched.length === 0 && ex.missing.length === 1,
      show(ex),
    );
    const exBad = compareExhibitionShadowDigests(
      [{ race_id: RACE, result_digest: "0000000000000000" }],
      liveDb.state.tables.exhibition_data,
    );
    check(
      "check-pre-race-shadow（A2）: ダイジェストが違えば不一致として数える",
      exBad.matched === 0 && exBad.mismatched.length === 1,
    );
    // 読み取りのみかは、偽の Supabase で集計を回し、呼んだ method で見る（verifyData/cron-entry-checks.js）
    await checkShadowReadOnly({ check, show });
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・RACE・RACE_11・freshDb・runRaceInfo） */
export async function runScrapePreRaceJobScenesB3(env) {
  ({ check, show, RACE, RACE_11, freshDb, runRaceInfo } = env);
  await sprjb3Scene3();
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・RACE・RACE_11・freshDb・runRaceInfo） */
export function runScrapePreRaceJobScenesB4(env) {
  ({ check, show, RACE, RACE_11, freshDb, runRaceInfo } = env);

}
