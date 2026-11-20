/**
 * verify-full-picture-scene2.js の後半の場面（13/13）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { got, run, pre } from "./full-picture-scene2-b-4.js";
import { date, technique } from "./full-picture-scene2-b-1.js";

let validate, realEnv;
let late, noObs, noDeadline, sameDay, empty, noRacers;

async function scene1() {
  // 既存の材料は展示の前と同じキーのまま（足すだけ）
  assert.ok(
    ["racer1", "motor"].every((k) => k in got.db) &&
      got.api.facts &&
      got.race.startTime === "16:06:00",
    "既存の材料はそのまま",
  );
  // 締切の後の観測（結果の取り込みで上書きされた値）は発走前の値でないので null
  late = await run({
    conditions: { ...pre, weather_observed_at: `${date}T07:08:00+00:00` },
  });
  assert.deepEqual(
    [
      late.db.exhibition.conditions.wind_speed,
      late.db.exhibition.conditions.wave_height,
      late.db.exhibition.conditions.observedAt,
    ],
    [null, null, `${date}T07:08:00+00:00`],
    "締切の後の観測の風・波は null",
  );
  assert.ok(
    late.missing.some(
      (x) =>
        x.source === "db.exhibition.conditions" && /締切の後/.test(x.reason),
    ),
    "締切の後の観測を missing に記録",
  );
  // 観測時刻が無い（scrape-to-json の経路）・締切が無いと発走前か確かめられないので null（/code-review 2026-10-25 #1）
  noObs = await run({
    conditions: { ...pre, weather_observed_at: null },
  });
  assert.equal(
    noObs.db.exhibition.conditions.wind_speed,
    null,
    "観測時刻の無い風は null",
  );
  assert.ok(
    noObs.missing.some(
      (x) =>
        x.source === "db.exhibition.conditions" &&
        /観測時刻が無く/.test(x.reason),
    ),
    "観測時刻が無いことを記録",
  );
  noDeadline = await run({ conditions: pre, startTime: null });
  assert.equal(
    noDeadline.db.exhibition.conditions.wave_height,
    null,
    "締切の無いレースの波は null",
  );
  assert.ok(
    noDeadline.missing.some(
      (x) =>
        x.source === "db.exhibition.conditions" &&
        /締切の時刻が無く/.test(x.reason),
    ),
    "締切が無いことを記録",
  );
  // 決まり手の表は最新の集計だけ。レースの日より後の集計なら記録する（固定の材料は 10/12、表は 10/25。/code-review #2）
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.technique.byPeriod" &&
        /より後の集計/.test(x.reason),
    ),
    "レースの日より後の集計を記録",
  );
  technique.venue_technique_period_stats =
    technique.venue_technique_period_stats.map((r) => ({
      ...r,
      last_updated: date,
    }));
  technique.winning_technique_stats = technique.winning_technique_stats.map(
    (r) => ({ ...r, last_updated: date }),
  );
  sameDay = await run({ conditions: pre });
  assert.ok(
    !sameDay.missing.some((x) =>
      x.source.startsWith("db.exhibition.technique"),
    ),
    "レースの日の集計なら欠けなし",
  );
  // 展示前（行も気象も無い）・集計表が空でも止まらず、全部 null と missing で出す
  technique.venue_technique_period_stats = [];
  technique.winning_technique_stats = [];
  empty = await run({ conditions: undefined, ex: [] });
  assert.deepEqual(validate(empty), [], "欠けた材料も契約に合う");
  noRacers = await run({ conditions: pre, racers: null });
  assert.ok(
    noRacers.db.exhibition.boats.every((b) => b.meet_finishes === null),
    "facts に racers が無ければ今節の着順は null",
  );
  assert.ok(
    noRacers.missing.some(
      (x) => x.source === "db.exhibition.boats.meet_finishes",
    ),
    "racers が無いことを記録",
  );
}

function scene2() {
  assert.ok(
    noRacers.db.exhibition.boats.every((b) => b.entry_tendency === null),
    "facts に racers が無ければ進入の分布は null",
  );
  assert.ok(
    noRacers.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.1.entry_tendency" &&
        /racers が無い/.test(x.reason),
    ),
    "進入の分布の欠けを記録",
  );
  assert.ok(
    empty.db.exhibition.boats.every(
      (b) => b.exhibition_course === null && b.start_timing === null,
    ),
    "展示前は進入・ST が null",
  );
  assert.ok(
    empty.db.exhibition.boats.every(
      (b) =>
        b.course === b.boat_number &&
        b.course_source === "boat_number" &&
        b.course_technique === null,
    ),
    "展示前は枠番で引き、選手が分からなければ null",
  );
  assert.deepEqual(empty.db.exhibition.conditions, {
    weather: null,
    wind_direction: null,
    wind_speed: null,
    wave_height: null,
    observedAt: null,
  });
  for (const s of [
    "db.exhibition.boats.1",
    "db.exhibition.boats.6",
    "db.exhibition.conditions",
    "db.exhibition.technique.byPeriod",
    "db.exhibition.technique.byBoat",
  ]) {
    assert.ok(
      empty.missing.some((x) => x.source === s),
      `欠けを missing に記録: ${s}`,
    );
  }
  for (const [k, v] of [
    ["VITE_SUPABASE_URL", realEnv.url],
    ["VITE_SUPABASE_ANON_KEY", realEnv.key],
  ]) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（validate・realEnv） */
export async function runFullPictureScene2B14(env) {
  ({ validate, realEnv } = env);
  await scene1();
  scene2();
}
