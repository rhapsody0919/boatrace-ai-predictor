#!/usr/bin/env node
/**
 * 選手の推移の線の下の段（節ごとのモーターの号機と会場内順位）の計算と取得（src/pure/racerMeetMotors.js・src/services/racerQueries7.js）の回帰テスト。
 * 偽の supabase の上で呼ぶ（verifyData/fakeServiceSupabase.js）。本番 DB には繋がない。
 *
 * 守ること（検証 scripts/analysis/motor-trend-window/racer_motor_change.py と同じ定義）:
 *   - 選手の節は、会場が替わるか前の走から4日以上あいたら次の節（3日あきは同じ節）
 *   - 順位は会場×節の全ての行のモーター2連率のパーセンタイル（同じ値は平均の順位、0・null は数えない）
 *   - 3区分は 1/3 以下が下・2/3 以下が中・それより上が上
 *   - 号機と2連率は節の最初の、行のある走から。2連率が 0・無いときは順位を出さない
 *   - 取得はその節の会場の初日から最終日までの行だけ（ほかの会場・節の外を混ぜない）。1000行で切れても取りこぼさない
 *   - 走が無ければ取得しない。取得の失敗は例外のまま
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

const { racerMeetsOf, motorRankPct, motorRankTier, meetMotorBand } = await import("../../src/pure/racerMeetMotors.js");

// --- 節の分け方
const ids = ["2026-09-01-02-03", "2026-09-01-02-09", "2026-09-04-02-05", "2026-09-08-02-01", "2026-09-09-05-02", "2026-09-10-05-07"];
const meets = racerMeetsOf(ids);
check("3日あきは同じ節・4日あきと会場の替わりで次の節", meets.length === 3 && meets[0].to === 2 && meets[1].from === 3 && meets[1].to === 3 && meets[2].venue === 5, JSON.stringify(meets));
check("節の初日・最終日と添字", meets[0].start === "2026-09-01" && meets[0].end === "2026-09-04" && meets[2].from === 4 && meets[2].to === 5);
check("走が無ければ節も無い", racerMeetsOf([]).length === 0);

// --- 順位（pandas の rank(pct=True) と同じ値）
check("一番上は 1", motorRankPct([10, 20, 30, 40], 40) === 1);
check("同じ値は平均の順位", motorRankPct([10, 20, 20, 40], 20) === 2.5 / 4);
check("0・null は数えない", motorRankPct([0, null, 10, 30], 30) === 1 && motorRankPct([10, 30], 0) === null);
check("行が無ければ null", motorRankPct([], 30) === null);
check("3区分の境", motorRankTier(1 / 3) === "low" && motorRankTier(0.34) === "mid" && motorRankTier(2 / 3) === "mid" && motorRankTier(0.67) === "high" && motorRankTier(null) === null);

const own = new Map([
  ["2026-09-01-02-09", { motorNumber: 18, motor2Rate: 45 }],
  ["2026-09-04-02-05", { motorNumber: 99, motor2Rate: 10 }],
  ["2026-09-08-02-01", { motorNumber: 52, motor2Rate: 0 }],
]);
const band = meetMotorBand(ids, own, (m) => (m.start === "2026-09-01" ? [10, 20, 30, 45, 50, 60] : [30]));
check("号機は節の最初の行のある走から", band[0].motorNumber === 18 && band[0].motor2Rate === 45, JSON.stringify(band[0]));
check("節の順位と区分", band[0].pct === 4 / 6 && band[0].tier === "mid", String(band[0].pct));
check("2連率 0 は順位を出さない", band[1].motorNumber === 52 && band[1].pct === null && band[1].tier === null);
check("行の無い節は号機も無い", band[2].motorNumber === null && band[2].tier === null);

// --- 取得
const V = 2;
const day = (n) => new Date(Date.UTC(2026, 8, 1) + n * 86400000).toISOString().slice(0, 10);
const rid = (n, no, v = V) => `${day(n)}-${String(v).padStart(2, "0")}-${String(no).padStart(2, "0")}`;
const entries = [];
// 9/01〜9/14 に会場 2 と 3 で毎日12レース×6艇。2連率は艇番と日で決まる
for (let n = 0; n < 14; n += 1)
  for (const v of [2, 3])
    for (let no = 1; no <= 12; no += 1)
      for (let boat = 1; boat <= 6; boat += 1)
        entries.push({ race_id: rid(n, no, v), boat_number: boat, racer_id: `${v}-${no}-${boat}`, motor_number: boat + no, motor_2rate: v === 3 ? 99 : 20 + boat * 5 + n });
// 選手 R は会場 2 の 9/02〜9/04（3号艇、2連率 50）と会場 3 の 9/10（1号艇）を走る
const runsOfR = [[1, 4, 2, 3], [2, 6, 2, 3], [3, 1, 2, 3], [9, 2, 3, 1]];
for (const [n, no, v, boat] of runsOfR) {
  const e = entries.find((x) => x.race_id === rid(n, no, v) && x.boat_number === boat);
  Object.assign(e, { racer_id: "R", motor_number: 41, motor_2rate: v === 2 ? 50 : 100 });
}
const fake = setFakeSupabase(createFakeSupabase({ race_entries: entries }, { scramble: true, project: true, maxRows: 1000 }));
const { getRacerMeetMotors } = await import("../../src/services/racerQueries7.js");
const raceIds = runsOfR.map(([n, no, v]) => rid(n, no, v));
const got = await getRacerMeetMotors("R", raceIds);
const pool = entries.filter((e) => e.race_id.slice(11, 13) === "02" && e.race_id >= day(1) && e.race_id <= `${day(3)}-99`).map((e) => e.motor_2rate);
check("節は2つ", got.length === 2, JSON.stringify(got));
check("順位はその節の会場の初日から最終日の行の中", got[0].pct === motorRankPct(pool, 50) && pool.length === 216, `${got[0].pct} ${pool.length}`);
check("号機は選手の行から", got[0].motorNumber === 41 && got[1].motorNumber === 41);
check("別の会場の節は別の行の中", got[1].pct === 1 && got[1].tier === "high", JSON.stringify(got[1]));
check("2連率は文字でも数として扱う", typeof got[0].motor2Rate === "number");

// 1000行を超える節（長い節）も取りこぼさない
fake.calls.length = 0;
const longIds = [rid(0, 1), rid(3, 1), rid(6, 1), rid(9, 1), rid(12, 1), rid(13, 1)];
for (const id of longIds) Object.assign(entries.find((x) => x.race_id === id && x.boat_number === 1), { racer_id: "L" });
const long = await getRacerMeetMotors("L", longIds);
const longPool = entries.filter((e) => e.race_id.slice(11, 13) === "02" && e.race_id >= day(0) && e.race_id <= `${day(13)}-99`);
check("長い節は1つ", long.length === 1 && long[0].end === day(13), JSON.stringify(long.map((m) => [m.start, m.end])));
check("1000行を超えても取り切る", longPool.length > 1000 && long[0].pct === motorRankPct(longPool.map((e) => e.motor_2rate), long[0].motor2Rate), `${long[0].pct}`);

check("走が無ければ取得しない", (await getRacerMeetMotors("X", [])).length === 0);
setFakeSupabase({ from: () => { throw new Error("読み取りの失敗"); } });
let threw = false;
try { await getRacerMeetMotors("Z", [rid(1, 1)]); } catch { threw = true; }
check("取得の失敗は例外のまま", threw);

if (failures.length > 0) {
  console.error(`verify-racer-meet-motors: NG\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
process.stdout.write("verify-racer-meet-motors: OK\n");
