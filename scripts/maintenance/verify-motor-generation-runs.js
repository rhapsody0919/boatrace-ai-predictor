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
      entries.push({ race_id: rid(n, no), boat_number: boat, motor_number: motor, motor_2rate: 30 + boat, motor_3rate: 50 + boat });
      exhibition.push({ race_id: rid(n, no), boat_number: boat, exhibition_time: 6.7 + boat / 100 });
    }
  }
}
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
