#!/usr/bin/env node
/**
 * モーターの推移の線の取得（src/services/motorQueries8.js の getMotorGenerationRuns）の回帰テスト。
 * 偽の supabase の上で呼ぶ（verifyData/fakeServiceSupabase.js）。本番 DB には繋がない。
 *
 * 守ること:
 *   - 世代はそのレースの日以前で最新の使用開始日から（後の入れ替え・前の世代の走を混ぜない）
 *   - このレース自身と後のレースの走は入れない
 *   - 頼んだ号機の走だけを、古い順に1走1行。展示タイムは同じレース・同じ艇の行から
 *   - 1回の返す行が1000で切れても、走を取りこぼさない
 *   - 使用開始日が無ければ generationStart は null で走は空。取得の失敗は例外のまま
 *   - 走に乗った選手と着順（結果の rank から。結果が無ければ null）を付け、会場の節（世代の初めからレースの日まで）を返す
 *   - 着順の付かない走の公式の記号（race_start_timings.finish_mark）を同じ艇の行から付ける。空の記号は null
 */
import {
  createFakeSupabase,
  installLocalStorage,
  registerFakeServiceSupabase,
  setFakeSupabase,
} from "./verifyData/fakeServiceSupabase.js";

registerFakeServiceSupabase();
installLocalStorage();
const failures = [];
const check = (name, ok, detail = "") => { if (!ok) failures.push(`${name} ${detail}`); };
console.log = console.warn = () => {};

const V = 2;
const day = (n) => new Date(Date.UTC(2026, 7, 1) + n * 86400000).toISOString().slice(0, 10);
const rid = (n, no) => `${day(n)}-02-${String(no).padStart(2, "0")}`;
// 7/28〜11/17 の毎日12レース。各レースの1〜6号艇に号機 (no+boat) % 60 + 1 を割り当てる
const races = [];
const entries = [];
const exhibition = [];
for (let n = -4; n <= 108; n += 1) {
  for (let no = 1; no <= 12; no += 1) {
    races.push({ race_id: rid(n, no), race_date: day(n), venue_code: V });
    for (let boat = 1; boat <= 6; boat += 1) {
      const motor = ((n * 12 + no + boat * 7) % 60) + 1;
      entries.push({ race_id: rid(n, no), boat_number: boat, motor_number: motor, motor_2rate: 30 + boat, motor_3rate: 50 + boat, player_name: `選手${motor}-${boat}` });
      exhibition.push({ race_id: rid(n, no), boat_number: boat, exhibition_time: 6.7 + boat / 100 });
    }
  }
}
// 結果は奇数のレース番号だけ。着順は艇番を逆に並べる（1着が6号艇）
const results = races.filter((r) => Number(r.race_id.slice(-2)) % 2 === 1).map((r) => ({ race_id: r.race_id, rank1: 6, rank2: 5, rank3: 4, rank4: 3, rank5: 2, rank6: 1 }));
const series = [-20, 0, 6, 30, 90, 101].map((n) => ({ venue_code: V, start_date: day(n), end_date: day(n + 5), total_days: 6, grade: "一般", title: `節${n}` }))
  .concat([{ venue_code: 3, start_date: day(10), end_date: day(15), total_days: 6, grade: "G1", title: "他会場" }]);
// 公式の記号: レース番号＋艇番が5の倍数の艇だけ F、ほかは空
const markOf = (raceId, boat) => ((Number(raceId.slice(-2)) + boat) % 5 === 0 ? "F" : "");
const starts = races.flatMap((r) => [1, 2, 3, 4, 5, 6].map((boat) => ({ race_id: r.race_id, boat_number: boat, finish_mark: markOf(r.race_id, boat) })));
const tables = {
  venue_motor_start_dates: [
    { venue_code: V, start_date: "2025-08-01" },
    { venue_code: V, start_date: day(5) },
    { venue_code: V, start_date: day(200) },
    { venue_code: 3, start_date: day(50) },
  ],
  races,
  race_entries: entries,
  exhibition_data: exhibition,
  race_results: results,
  race_series: series,
  race_start_timings: starts,
};
const fake = setFakeSupabase(createFakeSupabase(tables, { scramble: true, project: true, maxRows: 1000 }));
const { getMotorGenerationRuns } = await import("../../src/services/motorQueries8.js");
const { clearCache } = await import("../../src/services/core.js");

const target = rid(100, 7);
const motors = [34, 12, 58];
const got = await getMotorGenerationRuns(V, motors, target);
check("世代はレースの日以前で最新の使用開始日", got.generationStart === day(5), String(got.generationStart));
const want = (m) =>
  entries
    .filter((e) => e.motor_number === m && e.race_id >= day(5) && e.race_id < target)
    .sort((a, b) => a.race_id.localeCompare(b.race_id));
for (const m of motors) {
  const runs = got.runsByMotor[m] ?? [];
  const exp = want(m);
  check(`${m}号機の走の数`, runs.length === exp.length && exp.length > 100, `${runs.length}/${exp.length}`);
  check(`${m}号機は古い順`, runs.every((r, i) => i === 0 || runs[i - 1].raceId < r.raceId));
  check(`${m}号機の展示は同じ艇の行`, runs.every((r, i) => r.exhibitionTime === 6.7 + exp[i].boat_number / 100 && r.motor2Rate === exp[i].motor_2rate));
  check(`${m}号機に前の世代・このレース以降が無い`, runs.every((r) => r.date >= day(5) && r.raceId < target));
}
const run0 = got.runsByMotor[34][0];
const e0 = want(34)[0];
check("走に乗った選手", run0.racerName === e0.player_name, String(run0.racerName));
check("着順は結果の rank から（無ければ null）", got.runsByMotor[34].every((r, i) => {
  const e = want(34)[i];
  return Number(r.raceId.slice(-2)) % 2 === 1 ? r.finish === 7 - e.boat_number : r.finish === null;
}));
check("公式の記号は同じ艇の行から（空は null）", motors.every((m) => got.runsByMotor[m].every((r, i) => {
  const e = want(m)[i];
  return r.finishMark === (markOf(r.raceId, e.boat_number) || null);
})) && motors.some((m) => got.runsByMotor[m].some((r) => r.finishMark === "F")));
check("会場の節は世代の初めからレースの日まで", got.meets.map((m) => m.start).join() === [6, 30, 90].map(day).join(), JSON.stringify(got.meets.map((m) => m.start)));
check("節はグレード・日数つき", got.meets[0].grade === "一般" && got.meets[0].days === 6 && got.meets[0].end === day(11));
check("頼んでいない号機は返さない", Object.keys(got.runsByMotor).sort().join() === "12,34,58");
check("race_entries は1000行を超えない幅で読む", fake.queriesOn("race_entries").every((q) => q.range && q.range[1] - q.range[0] < 1000));

clearCache();
fake.reset({ ...tables, venue_motor_start_dates: [] });
const none = await getMotorGenerationRuns(V, motors, target);
check("使用開始日が無ければ null で空", none.generationStart === null && Object.values(none.runsByMotor).every((r) => r.length === 0));

clearCache();
fake.reset(tables, { race_entries: new Error("timeout") });
let threw = false;
try { await getMotorGenerationRuns(V, motors, target); } catch { threw = true; }
check("取得の失敗は例外のまま", threw);

if (failures.length > 0) {
  console.error("verify-motor-generation-runs: 失敗");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
process.stdout.write("verify-motor-generation-runs: OK\n");
