// /today の X 投稿の型 b（コース別1着率）の材料の再現テスト。
// - マイグレーション 181（compute_today_course_win_stats）を PGlite に当て、級別の全国の値（各走の級）・選手の値・前付けの回数・窓・権限を確かめる
// - src/utils/todayCourseWin.js の buildCourseWinNotes（候補は率で絞らない・載せる条件・縮めた値・z・Bonferroni の線）
// - generate-morning-digest.js の fetchCourseWin は関数が無い・読めないときに一覧を止めない
// 外部接続なし
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  COURSE_WIN_PRIOR_STRENGTH,
  FRONT_ENTRY_MIN,
  bonferroniLine,
  buildCourseWinNotes,
  courseWinRowsFromJson,
  minRunsFor,
  normalQuantile,
  shrinkRate,
  zScore,
} from "../../src/utils/todayCourseWin.js";
import { fetchCourseWin } from "../daily/generate-morning-digest.js";

const db = new PGlite();
const all = async (sql, args = []) => (await db.query(sql, args)).rows;
/** 181 を呼び、jsonb の1つを行の配列にする（呼び出し側 fetchCourseWin と同じ変換） */
async function call(until, ids) {
  const rows = await all(
    "SELECT compute_today_course_win_stats($1::date, $2::int[]) AS r",
    [until, ids],
  );
  assert.equal(rows.length, 1);
  return courseWinRowsFromJson(rows[0].r);
}

let raceSeq = 0;
/** 1レースを入れる。boats は [枠番, racer_id, 級, 実進入コース]、winner は1着の枠番 */
async function race(date, boats, winner, extra = {}) {
  raceSeq += 1;
  const id = `${date}-01-${String(raceSeq).padStart(4, "0")}`;
  await db.query(
    "INSERT INTO races(race_id, race_date, venue_code, race_number) VALUES ($1,$2,1,1)",
    [id, date],
  );
  const course = Object.fromEntries(boats.map(([b, , , c]) => [b, c]));
  await db.query(
    `INSERT INTO race_results(race_id, rank1, winning_technique, is_cancelled, is_no_race,
       actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6)
     VALUES ($1,$2,$3,$4,false,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      winner,
      extra.technique ?? "逃げ",
      extra.cancelled ?? false,
      course[1] ?? null,
      course[2] ?? null,
      course[3] ?? null,
      course[4] ?? null,
      course[5] ?? null,
      course[6] ?? null,
    ],
  );
  for (const [boat, racer, grade] of boats)
    await db.query(
      "INSERT INTO race_entries(race_id, boat_number, racer_id, grade, is_absent) VALUES ($1,$2,$3,$4,$5)",
      [id, boat, racer, grade, extra.absent === boat],
    );
  return id;
}

before(async () => {
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  await db.exec(`
    CREATE TABLE races(race_id VARCHAR PRIMARY KEY, race_date DATE, venue_code INT, race_number INT);
    CREATE TABLE race_results(race_id VARCHAR PRIMARY KEY, rank1 SMALLINT, winning_technique VARCHAR,
      is_cancelled BOOLEAN, is_no_race BOOLEAN, actual_course_1 SMALLINT, actual_course_2 SMALLINT,
      actual_course_3 SMALLINT, actual_course_4 SMALLINT, actual_course_5 SMALLINT, actual_course_6 SMALLINT);
    CREATE TABLE race_entries(race_id VARCHAR, boat_number SMALLINT, racer_id INT, grade VARCHAR, is_absent BOOLEAN);`);
  await db.exec(
    await readFile(
      new URL(
        "../../docs/db-migration/181_today_course_win_stats.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  // 10/01: 選手 100（A1）が1コースで1着、選手 200（B1）が4コース。選手 300 が2号艇から1コースへ（前付け）
  await race(
    "2037-10-01",
    [
      [1, 100, "A1", 1],
      [4, 200, "B1", 4],
    ],
    1,
  );
  await race(
    "2037-10-01",
    [
      [1, 100, "A1", 2],
      [2, 300, "A2", 1],
    ],
    2,
  );
  // 10/02: 選手 100 は B1 として走った（級は各走で数える）。4号艇の 200 が1着
  await race(
    "2037-10-02",
    [
      [1, 100, "B1", 1],
      [4, 200, "B1", 4],
    ],
    4,
  );
  // 母集団の外: 中止・欠場・決まり手なし・p_until より後
  await race("2037-10-02", [[1, 100, "A1", 1]], 1, { cancelled: true });
  await race("2037-10-02", [[1, 100, "A1", 1]], 1, { absent: 1 });
  await race("2037-10-02", [[1, 100, "A1", 1]], 1, { technique: "" });
  await race("2037-10-04", [[1, 100, "A1", 1]], 1);
});

test("181: 級別の全国の値は各走の級で数え、窓は p_until までのデータの最初と最後の日", async () => {
  const rows = await call("2037-10-03", [100, 200, 300]);
  const grade = rows.filter((r) => r.scope === "grade");
  const pick = (g, c) => grade.find((r) => r.grade === g && r.course === c);
  assert.deepEqual(
    { runs: pick("A1", 1).runs, wins: pick("A1", 1).wins },
    { runs: 1, wins: 1 },
  );
  assert.deepEqual(
    { runs: pick("B1", 1).runs, wins: pick("B1", 1).wins },
    { runs: 1, wins: 0 },
  );
  // 2号艇から1コースに入った 300（A2）は1着（rank1=2）
  assert.deepEqual(
    { runs: pick("A2", 1).runs, wins: pick("A2", 1).wins },
    { runs: 1, wins: 1 },
  );
  assert.deepEqual(
    { runs: pick("B1", 4).runs, wins: pick("B1", 4).wins },
    { runs: 2, wins: 1 },
  );
  // 1号艇で2コースに入った 100 は A1 の2コースの走（1着ではない。級の行は全コース）
  assert.deepEqual(
    { runs: pick("A1", 2).runs, wins: pick("A1", 2).wins },
    { runs: 1, wins: 0 },
  );
  for (const r of rows) {
    assert.equal(r.window_start, "2037-10-01");
    assert.equal(r.window_end, "2037-10-02");
  }
});

test("181: 選手の行は1・4コースの走数・1着数・枠番と違うコースに入った回数（前付け）", async () => {
  const rows = (await call("2037-10-03", [100, 300]))
    .filter((r) => r.scope === "racer")
    .map(({ racer_id, course, runs, wins, off_frame_runs }) => ({
      racer_id,
      course,
      runs,
      wins,
      off_frame_runs,
    }));
  assert.deepEqual(rows, [
    { racer_id: 100, course: 1, runs: 2, wins: 1, off_frame_runs: 0 },
    // 2コースの行は返さない（選手の行は1・4コースだけ）
    { racer_id: 300, course: 1, runs: 1, wins: 1, off_frame_runs: 1 },
  ]);
  // 指定しない選手（200）の行は返さない
  const none = await call("2037-10-03", []);
  assert.equal(none.filter((r) => r.scope === "racer").length, 0);
  // 母集団が空（窓より前）なら配列は空・窓は null。行を作らないので組み立ては unavailable に倒れる
  const [empty] = await all(
    "SELECT compute_today_course_win_stats('2000-01-01', ARRAY[100]) AS r",
  );
  assert.deepEqual(empty.r, {
    window_start: null,
    window_end: null,
    grade: [],
    racer: [],
  });
});

test("181: 返り値は jsonb の1つ（集合で返すと PostgREST の上限1000行で黙って切れる。system-architect の審査 P0）", async () => {
  const [row] = await all(
    "SELECT pg_get_function_result('compute_today_course_win_stats(date, integer[])'::regprocedure) AS t",
  );
  assert.equal(row.t, "jsonb");
  assert.throws(() => courseWinRowsFromJson([{ scope: "grade" }]), /形が違う/);
  assert.throws(() => courseWinRowsFromJson(null), /形が違う/);
});

test("181: 匿名・ログインの役は呼べず、service_role だけが呼べる", async () => {
  const [row] = await all(`SELECT
    has_function_privilege('anon', 'compute_today_course_win_stats(date, integer[])', 'EXECUTE') AS anon,
    has_function_privilege('authenticated', 'compute_today_course_win_stats(date, integer[])', 'EXECUTE') AS auth,
    has_function_privilege('service_role', 'compute_today_course_win_stats(date, integer[])', 'EXECUTE') AS svc`);
  assert.deepEqual(row, { anon: false, auth: false, svc: true });
});

test("統計の部品: 分位点・Bonferroni の線・縮めた値・z・最低の走数", () => {
  assert.ok(Math.abs(normalQuantile(0.975) - 1.959964) < 1e-5);
  assert.ok(Math.abs(normalQuantile(0.00025) + 3.480756) < 1e-5);
  // K=100 で 3.48（hq §9 の例）、K で線が上がる
  assert.ok(Math.abs(bonferroniLine(100) - 3.4808) < 1e-3);
  assert.ok(bonferroniLine(1) < bonferroniLine(50));
  assert.throws(() => normalQuantile(1), /0〜1/);
  // 高橋 竜矢の写し（42/47、A1 69.2%）: z≈2.99、縮めると約8割
  assert.ok(Math.abs(zScore(42, 47, 0.692) - 2.99) < 0.01);
  const s = shrinkRate(42, 47, 0.692);
  assert.ok(s > 0.8 && s < 0.84, String(s));
  assert.equal(COURSE_WIN_PRIOR_STRENGTH, 40);
  // 1コースは30回、4コース A1（16%）は期待1着数5で 32回、A2（12.4%）は 41回
  assert.equal(minRunsFor(0.71), 30);
  assert.equal(minRunsFor(0.16), 32);
  assert.equal(minRunsFor(0.124), 41);
  assert.equal(minRunsFor(0), Infinity);
});

const WINDOW = { window_start: "2025-12-03", window_end: "2026-10-25" };
const gradeRow = (grade, course, runs, wins) => ({
  scope: "grade",
  grade,
  racer_id: null,
  course,
  runs,
  wins,
  off_frame_runs: null,
  ...WINDOW,
});
const racerRow = (racer_id, course, runs, wins, off = 0) => ({
  scope: "racer",
  grade: null,
  racer_id,
  course,
  runs,
  wins,
  off_frame_runs: off,
  ...WINDOW,
});
/** 行の配列を RPC の jsonb の形に戻す（テストの材料用） */
const asJson = (rows) => ({
  window_start: rows[0].window_start,
  window_end: rows[0].window_end,
  grade: rows
    .filter((r) => r.scope === "grade")
    .map(({ grade, course, runs, wins }) => ({ grade, course, runs, wins })),
  racer: rows
    .filter((r) => r.scope === "racer")
    .map(({ racer_id, course, runs, wins, off_frame_runs }) => ({
      racer_id,
      course,
      runs,
      wins,
      off_frame_runs,
    })),
});
const BASE = [
  gradeRow("A1", 1, 16129, 11456),
  gradeRow("A2", 1, 13822, 8353),
  gradeRow("B1", 1, 19169, 7685),
  gradeRow("B2", 1, 1371, 486),
  gradeRow("A1", 4, 11658, 1867),
  gradeRow("A2", 4, 11845, 1474),
  gradeRow("B1", 4, 24216, 1742),
];
const races = [
  { race_id: "R1", venue_code: 4, race_number: 12, start_time: "16:14:00" },
  { race_id: "R2", venue_code: 24, race_number: 10, start_time: "19:36:00" },
  { race_id: "R3", venue_code: 22, race_number: 12, start_time: "16:40:00" },
  { race_id: "R4", venue_code: 1, race_number: 1, start_time: "08:40:00" },
];
const entry = (race_id, boat_number, racer_id, grade, name = "選手") => ({
  race_id,
  boat_number,
  racer_id,
  grade,
  player_name: name,
});

test("buildCourseWinNotes: 率で絞らず載せる条件を満たす全員を候補にし、K の材料（段ごとの数）を残す", () => {
  const entries = [
    entry("R1", 1, 1, "A1", "高橋　竜矢"),
    entry("R1", 4, 2, "A1"),
    entry("R2", 1, 3, "A1"),
    entry("R2", 4, 4, "B1"),
    entry("R3", 1, 5, "B1"),
    entry("R3", 4, 6, "A2"),
    entry("R4", 1, 7, "A1"),
    entry("R4", 2, 8, "A2"),
  ];
  const rpcRows = [
    ...BASE,
    racerRow(1, 1, 47, 42),
    // 1コースの率が全国平均より低い人も候補に残す（70% で先に絞らない）
    racerRow(3, 1, 54, 30),
    racerRow(2, 4, 40, 9),
    // 4コースの B1 は段の外
    racerRow(4, 4, 70, 12),
    // 29回は割合を出さない
    racerRow(5, 1, 29, 25),
    // A2 の4コースは 41回以上
    racerRow(6, 4, 40, 15),
    racerRow(7, 1, 60, 50),
    // R4 の2号艇は前付け（2〜6号艇から1コースへ FRONT_ENTRY_MIN 回）
    racerRow(8, 1, 5, 2, FRONT_ENTRY_MIN),
  ];
  const notes = buildCourseWinNotes({
    races,
    entries,
    rpcRows,
    until: "2026-10-25",
  });
  assert.equal(notes.status, "ok");
  assert.deepEqual(notes.window, {
    start: "2025-12-03",
    end: "2026-10-25",
    until: "2026-10-25",
  });
  assert.deepEqual(
    notes.candidates.map((c) => [c.section, c.racer_id]),
    [
      ["c1", 1],
      ["c1", 3],
      ["c4", 2],
    ],
  );
  assert.deepEqual(notes.counts, { c1: 2, c4: 1 });
  assert.deepEqual(notes.front_races, ["R4"]);
  assert.deepEqual(notes.excluded_counts, {
    "c1:too_few_runs": 1,
    "c1:front_race": 1,
    "c4:grade_out": 1,
    "c4:too_few_runs": 1,
  });
  const takahashi = notes.candidates[0];
  assert.equal(takahashi.racer_name, "高橋 竜矢");
  assert.equal(takahashi.baseline_pct, 71.03);
  assert.equal(takahashi.z, Number(zScore(42, 47, 11456 / 16129).toFixed(3)));
  assert.equal(
    takahashi.gap_pt,
    Math.round(
      (shrinkRate(42, 47, 11456 / 16129) - 11456 / 16129) * 100 * 100,
    ) / 100,
  );
  assert.equal(notes.candidates[1].gap_pt < 0, true);
});

test("buildCourseWinNotes: 全国の行が無い日は unavailable、窓がそろわなければ投げる", () => {
  assert.deepEqual(
    buildCourseWinNotes({ races, entries: [], rpcRows: [], until: "x" }),
    { v: 1, status: "unavailable", reason: "no_grade_rows" },
  );
  assert.throws(
    () =>
      buildCourseWinNotes({
        races,
        entries: [],
        rpcRows: [
          ...BASE,
          { ...racerRow(1, 1, 40, 30), window_end: "2026-10-24" },
        ],
        until: "x",
      }),
    /窓がそろっていない/,
  );
});

test("fetchCourseWin: 関数が無い・読めない・材料が壊れているときは一覧を止めず unavailable（notes には理由のコードだけ）", async () => {
  const entries = [entry("R1", 1, 1, "A1")];
  const missing = await fetchCourseWin(
    "2026-10-27",
    races,
    entries,
    async () => ({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    }),
  );
  assert.deepEqual(missing, {
    v: 1,
    status: "unavailable",
    reason: "rpc_missing",
  });
  const failed = await fetchCourseWin(
    "2026-10-27",
    races,
    entries,
    async () => ({
      data: null,
      error: { code: "57014", message: "canceling statement due to timeout" },
    }),
  );
  // 匿名でも読める notes にはエラーの本文を入れない（system-architect の審査 P3）
  assert.deepEqual(failed, {
    v: 1,
    status: "unavailable",
    reason: "rpc_error",
  });
  // 行の配列（集合で返す旧い形）・窓がそろわない材料は止める
  for (const data of [
    [...BASE, racerRow(1, 1, 40, 30)],
    {
      ...asJson([...BASE, racerRow(1, 1, 40, 30)]),
      grade: null,
    },
  ]) {
    const broken = await fetchCourseWin(
      "2026-10-27",
      races,
      entries,
      async () => ({ data, error: null }),
    );
    assert.equal(broken.reason, "build_error");
  }
  // 窓は前々日まで、選手は今日の出走の重複なし
  let args = null;
  const ok = await fetchCourseWin(
    "2026-10-27",
    races,
    [...entries, entry("R2", 1, 1, "A1")],
    async (a) => {
      args = a;
      return { data: asJson([...BASE, racerRow(1, 1, 47, 42)]), error: null };
    },
  );
  assert.deepEqual(args, { p_until: "2026-10-25", p_racer_ids: [1] });
  assert.equal(ok.status, "ok");
  // 同じ選手が2レースに出ればレースごとに候補（2件）
  assert.equal(ok.candidates.length, 2);
});
