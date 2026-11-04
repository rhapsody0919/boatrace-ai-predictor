// 全選手・会場の同じコースの1着率の RPC（マイグレーション 199、get_course_win_rate_baseline、BOA-1290）の再現テスト。
// PGlite に本番と同じ形の縮約の表（racer_period_stats・races・race_results、RLS 有効・匿名に SELECT）を作り、199 を当てて確かめる。
//   - 期の選び方: calc_to < レースの日の新しい3つ（calc_from の順）。レースの日と同じ日に終わる期は入れない。terms は古い順
//   - 重みづけ: Σc{n}_p1 ÷ Σc{n}_entries（走の重み。選手ごとの率の平均ではない）。starts = 0 の行は数えない。B2 を含む
//   - 進入0のコースは winRate null（0% にしない）。期が無ければ terms [] と全コース null
//   - 当地: 実進入コースで数える（前付けの艇の1着は入ったコースの1着）。窓は [レースの日 − 730日, レースの日)。
//     中止（cancellation_status = confirmed）・不成立（no_race）・着順なし・実進入コースなし・別の会場は数えない
//   - p_venue_code が null なら venue は null
//   - STABLE・SECURITY INVOKER・search_path 固定、anon・authenticated が呼べる（RLS の下で読める）、2回当てても失敗しない
// 外部接続なし
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const migration = await readFile(
  new URL(
    "../../docs/db-migration/199_course_win_rate_baseline.sql",
    import.meta.url,
  ),
  "utf8",
);

/** 199 を呼んで jsonb を返す */
async function call(date, venue, role = null) {
  if (role) await db.exec(`SET ROLE ${role}`);
  try {
    const { rows } = await db.query(
      "SELECT public.get_course_win_rate_baseline($1::date, $2::smallint) AS r",
      [date, venue],
    );
    assert.equal(rows.length, 1);
    return rows[0].r;
  } finally {
    if (role) await db.exec("RESET ROLE");
  }
}

let periodSeq = 0;
/** 選手×期の1行。courses は { 1: [p1, entries], ... } */
async function period(
  racerId,
  calcFrom,
  calcTo,
  courses,
  { starts = 10, grade = "A1" } = {},
) {
  periodSeq += 1;
  const cols = [];
  const vals = [];
  for (const [c, [p1, entries]] of Object.entries(courses)) {
    cols.push(`c${c}_p1`, `c${c}_entries`);
    vals.push(p1, entries);
  }
  const base = [racerId, 2000 + periodSeq, 1, calcFrom, calcTo, grade, starts];
  const placeholders = [...base, ...vals].map((_, i) => `$${i + 1}`).join(",");
  await db.query(
    `INSERT INTO racer_period_stats(racer_id, period_year, period_no, calc_from, calc_to, grade, starts${cols.map((c) => `, ${c}`).join("")})
     VALUES (${placeholders})`,
    [...base, ...vals],
  );
}

let raceSeq = 0;
/** 1レース。courses は艇番1〜6の実進入コース（null は欠場など）、winner は1着の艇番 */
async function race(date, venue, courses, winner, extra = {}) {
  raceSeq += 1;
  const id = `${date}-${String(venue).padStart(2, "0")}-${String(raceSeq).padStart(4, "0")}`;
  await db.query(
    "INSERT INTO races(race_id, race_date, venue_code, race_number, cancellation_status) VALUES ($1,$2,$3,1,$4)",
    [id, date, venue, extra.cancellation ?? null],
  );
  await db.query(
    `INSERT INTO race_results(race_id, rank1, race_status,
       actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, winner, extra.status ?? "normal", ...courses],
  );
}

const WAKUNARI = [1, 2, 3, 4, 5, 6];

before(async () => {
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  const courseCols = [1, 2, 3, 4, 5, 6]
    .map((c) => `c${c}_p1 SMALLINT, c${c}_entries SMALLINT`)
    .join(", ");
  await db.exec(`
    CREATE TABLE racer_period_stats(racer_id INT, period_year SMALLINT, period_no SMALLINT,
      calc_from DATE, calc_to DATE, grade TEXT, starts SMALLINT, ${courseCols},
      PRIMARY KEY (racer_id, period_year, period_no));
    CREATE TABLE races(race_id VARCHAR PRIMARY KEY, race_date DATE, venue_code SMALLINT,
      race_number SMALLINT, cancellation_status TEXT);
    CREATE TABLE race_results(race_id VARCHAR PRIMARY KEY, rank1 SMALLINT, race_status TEXT,
      actual_course_1 SMALLINT, actual_course_2 SMALLINT, actual_course_3 SMALLINT,
      actual_course_4 SMALLINT, actual_course_5 SMALLINT, actual_course_6 SMALLINT);
  `);
  // 本番と同じく RLS 有効・匿名に SELECT のポリシーと権限（SECURITY INVOKER で読めることを確かめる）
  for (const t of ["racer_period_stats", "races", "race_results"]) {
    await db.exec(`
      ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY ${t}_read ON ${t} FOR SELECT TO anon, authenticated USING (true);
      GRANT SELECT ON ${t} TO anon, authenticated;`);
  }
  await db.exec(migration);
  // 2回当てても失敗しない（CREATE OR REPLACE と GRANT）
  await db.exec(migration);

  // 期: 2024-05（古い4つ目）・2024-11・2025-05・2025-11（calc_to 2026-04-30）
  // 選手 1: 1コース 0/2（率 0%）、選手 2: 1コース 9/18（率 50%）。走の重みなら 9/20=45%、率の平均なら 25%
  await period(1, "2025-11-01", "2026-04-30", { 1: [0, 2], 6: [0, 0] });
  await period(
    2,
    "2025-11-01",
    "2026-04-30",
    { 1: [9, 18], 6: [0, 0] },
    { grade: "B2" },
  );
  // starts = 0 の行は数えない（列に値が入っていても）
  await period(3, "2025-11-01", "2026-04-30", { 1: [50, 50] }, { starts: 0 });
  await period(1, "2025-05-01", "2025-10-31", { 1: [3, 10], 2: [1, 4] });
  await period(1, "2024-11-01", "2025-04-30", { 1: [2, 10] });
  // 4つ目に古い期（2026-11-04 のレースでは入らない）
  await period(1, "2024-05-01", "2024-10-31", { 1: [100, 100] });

  // 当地: 会場 1、レースの日 2026-11-04 → 窓 [2024-11-04, 2026-11-04)
  // 枠なり、1号艇が1着
  await race("2026-11-03", 1, WAKUNARI, 1);
  // 2号艇が1コースに入って1着（前付け）。1号艇は2コース
  await race("2026-10-01", 1, [2, 1, 3, 4, 5, 6], 2);
  // 窓の始まりちょうど（入る）。4号艇が1着、6号艇は欠場（実進入コースなし）
  await race("2024-11-04", 1, [1, 2, 3, 4, 5, null], 4);
  // 数えないもの
  await race("2026-11-04", 1, WAKUNARI, 1); // レースの日と同じ日
  await race("2024-11-03", 1, WAKUNARI, 1); // 窓の前（731日前）
  await race("2026-10-02", 1, WAKUNARI, 1, { cancellation: "confirmed" });
  await race("2026-10-03", 1, WAKUNARI, 1, { status: "no_race" });
  await race("2026-10-04", 1, WAKUNARI, null); // 着順なし
  await race("2026-10-05", 2, WAKUNARI, 1); // 別の会場
});

test("199: 期は calc_to < レースの日の新しい3つで、古い順に返す", async () => {
  const r = await call("2026-11-04", 1);
  assert.deepEqual(r.terms, [
    { calc_from: "2024-11-01", calc_to: "2025-04-30" },
    { calc_from: "2025-05-01", calc_to: "2025-10-31" },
    { calc_from: "2025-11-01", calc_to: "2026-04-30" },
  ]);
});

test("199: レースの日と同じ日に終わる期は入れない（境界）、翌日なら入る", async () => {
  const onEnd = await call("2026-04-30", null);
  assert.deepEqual(
    onEnd.terms.map((t) => t.calc_from),
    ["2024-05-01", "2024-11-01", "2025-05-01"],
  );
  // 2024-05〜2025-05 の3期: 1コースは 100/100 + 2/10 + 3/10
  assert.deepEqual(onEnd.national["1"], {
    wins: 105,
    entries: 120,
    winRate: 87.5,
  });
  const nextDay = await call("2026-05-01", null);
  assert.deepEqual(
    nextDay.terms.map((t) => t.calc_from),
    ["2024-11-01", "2025-05-01", "2025-11-01"],
  );
});

test("199: national は走の重み（Σp1÷Σ進入）、starts=0 を除き B2 を含む", async () => {
  const r = await call("2026-11-04", 1);
  // 1コース: 0/2 + 9/18（B2）+ 3/10 + 2/10 = 14/40。starts=0 の 50/50 と4つ目に古い期の 100/100 は入らない
  assert.deepEqual(r.national["1"], { wins: 14, entries: 40, winRate: 35 });
  assert.deepEqual(r.national["2"], { wins: 1, entries: 4, winRate: 25 });
  // 進入0のコースは null（0% にしない）
  assert.deepEqual(r.national["6"], { wins: 0, entries: 0, winRate: null });
  assert.deepEqual(Object.keys(r.national).sort(), [
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
  ]);
});

test("199: winRate は百分率を小数4桁で丸める", async () => {
  await period(9, "2025-11-01", "2026-04-30", { 3: [1, 3] });
  const r = await call("2026-11-04", null);
  assert.equal(r.national["3"].winRate, 33.3333);
  await db.exec("DELETE FROM racer_period_stats WHERE racer_id = 9");
});

test("199: 期が無ければ terms は [] で全コース null", async () => {
  const r = await call("2020-01-01", null);
  assert.deepEqual(r.terms, []);
  for (const c of ["1", "2", "3", "4", "5", "6"]) {
    assert.deepEqual(r.national[c], { wins: 0, entries: 0, winRate: null });
  }
});

test("199: 当地は実進入コースで数え、窓・中止・不成立・着順なし・別の会場を除く", async () => {
  const { venue } = await call("2026-11-04", 1);
  assert.equal(venue.venueCode, 1);
  assert.equal(venue.from, "2024-11-04");
  assert.equal(venue.to, "2026-11-03");
  // 数えるのは 2026-11-03・2026-10-01・2024-11-04 の3レース
  // 1コース: 11/03 の1号艇（1着）・10/01 の2号艇（1着）・11/04 の1号艇 → 2/3
  assert.deepEqual(venue.byCourse["1"], {
    wins: 2,
    entries: 3,
    winRate: 66.6667,
  });
  // 2コース: 11/03 の2号艇・10/01 の1号艇・11/04 の2号艇 → 0/3
  assert.deepEqual(venue.byCourse["2"], { wins: 0, entries: 3, winRate: 0 });
  assert.deepEqual(venue.byCourse["4"], {
    wins: 1,
    entries: 3,
    winRate: 33.3333,
  });
  // 6コース: 2024-11-04 の6号艇は欠場（実進入コースなし）→ 2走
  assert.deepEqual(venue.byCourse["6"], { wins: 0, entries: 2, winRate: 0 });
});

test("199: 当地に数えるレースが無ければ from・to は null で全コース entries 0", async () => {
  const { venue } = await call("2026-11-04", 24);
  assert.equal(venue.venueCode, 24);
  assert.equal(venue.from, null);
  assert.equal(venue.to, null);
  assert.deepEqual(venue.byCourse["1"], { wins: 0, entries: 0, winRate: null });
});

test("199: p_venue_code が null なら venue は null（national は返す）", async () => {
  const r = await call("2026-11-04", null);
  assert.equal(r.venue, null);
  assert.equal(r.national["1"].entries, 40);
});

test("199: STABLE・SECURITY INVOKER・search_path 固定、anon・authenticated が RLS の下で呼べる", async () => {
  const { rows } = await db.query(
    `SELECT p.provolatile, p.prosecdef, p.proconfig,
            has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
     FROM pg_proc p WHERE p.proname = 'get_course_win_rate_baseline'`,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provolatile, "s");
  assert.equal(rows[0].prosecdef, false);
  assert.deepEqual(rows[0].proconfig, ["search_path=public, pg_temp"]);
  assert.equal(rows[0].anon_exec, true);
  assert.equal(rows[0].auth_exec, true);
  const asAnon = await call("2026-11-04", 1, "anon");
  assert.deepEqual(asAnon.national["1"], {
    wins: 14,
    entries: 40,
    winRate: 35,
  });
  assert.equal(asAnon.venue.byCourse["1"].entries, 3);
});
