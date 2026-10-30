// 選手ページ（GS00 案2）の集計の表（マイグレーション 190）と書き手（scripts/lib/racerCareerJob.js）の再現テスト。
// - 190 を PGlite に当て（kb_archive は 074 をそのまま、本体は必要な列だけの表）、3つの RPC の数え方・境目・権限を確かめる
// - 優勝戦の判定（isFinalStage の v2）・グレードの補正（QC・CC・唐津）・期の区切り・半月の範囲・足し合わせ・消えたセルの扱い
// - kb 層の1回の計算と main 層の毎晩の計算を、偽の Supabase（RPC は PGlite に渡す）で通し、冪等・指紋の見張りを確かめる
// - レジストリ・vercel.json・api/cron の maxDuration と cron 式、CLI の引数
// 外部接続なし（本番 DB にも Slack にも繋がない）
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  COUNT_COLUMNS,
  RULE_VERSION,
  chunk,
  existingChunkSize,
  finalStagesOf,
  gradeOverridesOf,
  halfMonthRanges,
  mergeCareerResult,
  runKbEra,
  runMainEra,
  runRacerCareerMainJob,
  specialSeriesGroups,
  splitByRacerLinks,
  staleRowsOf,
  writeCareerRows,
} from "../lib/racerCareerJob.js";
import { KB_LAST_DATE, MAIN_TABLES_START } from "../lib/kbArchiveBoundary.js";
import { MAIN_TABLES_START as KB_BACKFILL_MAIN_START } from "./kb-backfill.js";
import { createFakeSupabaseClient } from "../lib/scrapeJobs/testing/fakeSupabaseClient.js";
import { SCRAPE_JOBS } from "../lib/scrapeJobs/registry.js";
import { parseArgs } from "./racer-career-backfill.js";

const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");
const SQL190 = await read("../../docs/db-migration/190_racer_career_stats.sql");
const db = new PGlite();
const all = async (sql, args = []) => (await db.query(sql, args)).rows;
const quiet = () => {};

// ---------------------------------------------------------------------------
// 材料（kb と本体）
// ---------------------------------------------------------------------------
async function kbDay(day, venue, title, grade, races) {
  const vd = `${day}-${String(venue).padStart(2, "0")}`;
  await db.query(
    `INSERT INTO kb_archive_venue_days(venue_day_id, race_date, venue_code, title, has_k, has_b, race_grade)
     VALUES ($1,$2,$3,$4,true,true,$5)`,
    [vd, day, venue, title, grade],
  );
  for (const [no, stage, stageKind, boats] of races) {
    const id = `${vd}-${String(no).padStart(2, "0")}`;
    await db.query(
      `INSERT INTO kb_archive_races(race_id, venue_day_id, race_date, venue_code, race_number, stage, stage_kind, has_result)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,
      [id, vd, day, venue, no, stage, stageKind],
    );
    for (const [boat, racer, code, course] of boats)
      await db.query(
        `INSERT INTO kb_archive_boats(race_id, boat_number, racer_id, course, finish_raw) VALUES ($1,$2,$3,$4,$5)`,
        [id, boat, racer, course, code],
      );
  }
}

/** 6艇（枠番＝進入、着は枠番の順）。racers は6人 */
const six = (racers, codes = ["01", "02", "03", "04", "05", "06"]) =>
  racers.map((r, i) => [i + 1, r, codes[i], i + 1]);

async function mainRace(
  id,
  {
    grade = "ippan",
    stage = "予選",
    title = "一般戦",
    boats,
    updatedAt = null,
  },
) {
  const [date, , venue, no] = [
    id.slice(0, 10),
    null,
    Number(id.slice(11, 13)),
    Number(id.slice(14, 16)),
  ];
  await db.query(
    "INSERT INTO races(race_id, race_date, venue_code, race_number, race_grade) VALUES ($1,$2,$3,$4,$5)",
    [id, date, venue, no, grade],
  );
  await db.query(
    "INSERT INTO race_conditions(race_id, race_stage, race_title) VALUES ($1,$2,$3)",
    [id, stage, title],
  );
  const course = Object.fromEntries(boats.map(([b, , , c]) => [b, c]));
  await db.query(
    `INSERT INTO race_results(race_id, actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      id,
      course[1] ?? null,
      course[2] ?? null,
      course[3] ?? null,
      course[4] ?? null,
      course[5] ?? null,
      course[6] ?? null,
    ],
  );
  for (const [boat, racer, code] of boats) {
    await db.query(
      "INSERT INTO race_entries(race_id, boat_number, racer_id) VALUES ($1,$2,$3)",
      [id, boat, racer],
    );
    await db.query(
      "INSERT INTO race_start_timings(race_id, boat_number, official_finish_code, updated_at) VALUES ($1,$2,$3,$4)",
      [id, boat, code, updatedAt],
    );
  }
}

before(async () => {
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  await db.exec(
    await read("../../docs/db-migration/074_kb_archive_tables.sql"),
  );
  await db.exec(`
    CREATE TABLE races(race_id VARCHAR PRIMARY KEY, race_date DATE, venue_code SMALLINT, race_number SMALLINT, race_grade VARCHAR);
    CREATE TABLE race_entries(race_id VARCHAR, boat_number SMALLINT, racer_id INT, PRIMARY KEY (race_id, boat_number));
    CREATE TABLE race_start_timings(race_id VARCHAR, boat_number SMALLINT, official_finish_code TEXT, updated_at TIMESTAMPTZ,
      PRIMARY KEY (race_id, boat_number));
    CREATE TABLE race_results(race_id VARCHAR PRIMARY KEY, actual_course_1 SMALLINT, actual_course_2 SMALLINT, actual_course_3 SMALLINT,
      actual_course_4 SMALLINT, actual_course_5 SMALLINT, actual_course_6 SMALLINT);
    CREATE TABLE race_conditions(race_id VARCHAR PRIMARY KEY, race_stage VARCHAR, race_title VARCHAR);
    CREATE TABLE race_series(venue_code SMALLINT, start_date DATE, end_date DATE, title TEXT, grade TEXT, PRIMARY KEY (venue_code, start_date));`);
  await db.exec(SQL190);

  // --- kb ---
  // 一般の節。着のコードの全種類（NULL は数えない、知らないコード ZZ は other_code）。K0 は進入なし
  await kbDay("2019-04-10", 1, "一般戦", "ippan", [
    [
      1,
      "予選",
      "qualifier",
      [
        [1, 301, "F", 1],
        [2, 302, "L0", 2],
        [3, 303, "K0", null],
        [4, 304, "S0", null],
        [5, 305, "00", 5],
        [6, 306, null, null],
      ],
    ],
    [
      2,
      "予選",
      "qualifier",
      [
        [1, 301, "S1", 1],
        [2, 302, "ZZ", 2],
        [3, 303, "K1", 3],
        [4, 304, "L1", 4],
        [5, 305, "S2", 5],
        [6, 306, "01", 6],
      ],
    ],
  ]);
  // 期の区切り: 5/1 は その年の5月の期、11/1 は11月の期
  await kbDay("2019-05-01", 2, "一般戦", "ippan", [
    [1, "予選", "qualifier", six([301, 302, 303, 304, 305, 306])],
  ]);
  await kbDay("2019-11-01", 2, "一般戦", "ippan", [
    [1, "予選", "qualifier", six([301, 302, 303, 304, 305, 306])],
  ]);
  // stage_kind は other でも優勝戦（GP優勝戦。stage_kind は使わない）。SG
  await kbDay("2019-12-22", 4, "グランプリ", "SG", [
    [12, "GP優勝戦", "other", six([101, 102, 103, 104, 105, 106])],
  ]);
  // QC: トライアルと賞金女王決定に出る6人（101〜106）が G1、シリーズの6人（201〜206）が G3。題は全角でも当たる
  await kbDay(
    "2024-12-30",
    7,
    "第１３回クイーンズクライマックス／Ｇ３ＱＣシリーズ",
    "G1",
    [
      [1, "一般戦", "other", six([201, 202, 203, 204, 205, 206])],
      [11, "トライアル", "other", six([101, 102, 103, 104, 105, 106])],
    ],
  );
  await kbDay(
    "2024-12-31",
    7,
    "第１３回クイーンズクライマックス／Ｇ３ＱＣシリーズ",
    "G1",
    [
      [11, "優勝戦", "final", six([201, 202, 203, 204, 205, 206])],
      [12, "賞金女王決定", "other", six([101, 102, 103, 104, 105, 106])],
    ],
  );
  // CC: 最終日の12Rの組が SG、11Rの組がレディースCC（G2）。題の格は SG
  await kbDay("2024-11-23", 19, "第27回チャレンジカップ/G2レディースCC", "SG", [
    [1, "予選", "qualifier", six([501, 502, 503, 504, 505, 506])],
    [2, "予選", "qualifier", six([601, 602, 603, 604, 605, 606])],
  ]);
  await kbDay("2024-11-24", 19, "第27回チャレンジカップ/G2レディースCC", "SG", [
    [11, "優勝戦", "final", six([601, 602, 603, 604, 605, 606])],
    [12, "優勝戦", "final", six([501, 502, 503, 504, 505, 506])],
  ]);
  // 唐津のバトルトーナメント: 2024-10-12〜14 だけ G1（別の年の同じ題は ippan のまま）
  await kbDay(
    "2024-10-12",
    23,
    "ファン感謝3Daysボートレースバトルトーナメント",
    "ippan",
    [[1, "予選", "qualifier", six([701, 702, 703, 704, 705, 706])]],
  );
  await kbDay(
    "2022-01-08",
    23,
    "ファン感謝3daysボートレースバトルトーナメント",
    "ippan",
    [[1, "予選", "qualifier", six([701, 702, 703, 704, 705, 706])]],
  );
  // 境目: kb の 2025-12-02 は数え、2025-12-03 は（kb に入っていても）数えない
  await kbDay("2025-12-02", 5, "一般戦", "ippan", [
    [1, "予選", "qualifier", six([801, 802, 803, 804, 805, 806])],
  ]);
  await kbDay("2025-12-03", 5, "一般戦", "ippan", [
    [1, "予選", "qualifier", six([801, 802, 803, 804, 805, 806])],
  ]);

  // --- 本体 ---
  // 本体の 2025-12-02（kb と重なる日）は数えない
  await mainRace("2025-12-02-05-01", {
    boats: six([801, 802, 803, 804, 805, 806]),
  });
  // グレードが NULL なら race_series の格と題で補う。優勝戦。進入は race_results の枠番の列から（1号艇が2コース）
  await db.query(
    "INSERT INTO race_series(venue_code, start_date, end_date, title, grade) VALUES (5,'2025-12-01','2025-12-06','ＸＸ記念','G2')",
  );
  await mainRace("2025-12-06-05-12", {
    grade: null,
    stage: "優勝戦",
    title: null,
    boats: [
      [1, 801, "01", 2],
      [2, 802, "02", 1],
      [3, 803, "03", 3],
      [4, 804, "04", 4],
      [5, 805, "05", 5],
      [6, 806, "06", 6],
    ],
  });
  // QC（本体）。races.race_grade はシリーズも G1 で入る（2025 の実データ）。トライアルの組だけ G1 に残る
  await mainRace("2025-12-30-24-11", {
    grade: "G1",
    stage: "トライアル",
    title: "第１４回クイーンズクライマックス／Ｇ３ＱＣシリーズ",
    boats: six([101, 102, 103, 104, 105, 106]),
  });
  await mainRace("2025-12-30-24-01", {
    grade: "G1",
    stage: "Ｓ戦一般戦",
    title: "第１４回クイーンズクライマックス／Ｇ３ＱＣシリーズ",
    boats: six([201, 202, 203, 204, 205, 206]),
  });
  // 1月の走は前の年の11月の期。着のコードが 2026-10-29 に書き換わった（直近に出ていない選手 901 も毎晩の対象）
  await mainRace("2026-01-10-06-01", {
    boats: six([901, 902, 903, 904, 905, 906]),
    updatedAt: "2026-10-29T00:00:00Z",
  });
  // 直近の走。着のコードがまだ無い（K の未着）走は数えない
  await mainRace("2026-10-28-01-01", {
    boats: six(
      [101, 102, 103, 104, 105, 106],
      [null, null, null, null, null, null],
    ),
  });
});

// ---------------------------------------------------------------------------
// 純関数
// ---------------------------------------------------------------------------
test("優勝戦の種別は isFinalStage（v2）で決める（stage_kind は使わない）", () => {
  assert.deepEqual(
    finalStagesOf([
      "予選",
      "GP優勝戦",
      "準優進出戦",
      "準優勝戦",
      "賞金女王決定",
      "シリーズ優勝",
      "QC順位決定",
      null,
      "優勝戦",
      "優勝戦",
    ]),
    ["GP優勝戦", "シリーズ優勝", "優勝戦", "賞金女王決定"],
  );
  assert.throws(() => finalStagesOf(null), /配列ではない/);
});

test("特別な節: 連続した日を1つにまとめ、QC・CC・唐津の日付の範囲だけを拾う", () => {
  const groups = specialSeriesGroups([
    {
      venue_code: 7,
      race_date: "2024-12-30",
      title: "第１３回クイーンズクライマックス／Ｇ３ＱＣシリーズ",
    },
    {
      venue_code: 7,
      race_date: "2024-12-31",
      title: "第１３回クイーンズクライマックス／Ｇ３ＱＣシリーズ",
    },
    {
      venue_code: 19,
      race_date: "2024-11-24",
      title: "第27回チャレンジカップ/G2レディースCC",
    },
    {
      venue_code: 23,
      race_date: "2024-10-12",
      title: "ファン感謝3Daysボートレースバトルトーナメント",
    },
    {
      venue_code: 23,
      race_date: "2022-01-08",
      title: "ファン感謝3daysボートレースバトルトーナメント",
    },
    { venue_code: 1, race_date: "2024-12-30", title: "第5回太田双葉CCカップ" },
  ]);
  assert.deepEqual(
    groups.map((g) => [g.rule.id, g.venueDays, g.lastDay]),
    [
      ["qc", ["2024-12-30-07", "2024-12-31-07"], "2024-12-31-07"],
      ["cc", ["2024-11-24-19"], "2024-11-24-19"],
      ["karatsu-2024-battle", ["2024-10-12-23"], "2024-10-12-23"],
    ],
  );
});

test("選手のつながりで分け、基準のレースの組を primary にする。選手が分からないレースは補正しない", () => {
  const races = [
    { race_id: "a", racer_ids: [1, 2] },
    { race_id: "b", racer_ids: [2, 3] },
    { race_id: "c", racer_ids: [7, 8] },
    { race_id: "d", racer_ids: [] },
  ];
  const s = splitByRacerLinks(races, (r) => r.race_id === "a");
  assert.deepEqual([...s.primary].sort(), ["a", "b"]);
  assert.deepEqual([...s.judged].sort(), ["a", "b", "c"]);
  assert.deepEqual([s.primaryRacers, s.otherRacers], [3, 2]);
  const groups = specialSeriesGroups([
    {
      venue_code: 7,
      race_date: "2024-12-31",
      title: "クイーンズクライマックス/QCシリーズ",
    },
  ]);
  assert.throws(
    () =>
      gradeOverridesOf(groups, [
        {
          race_id: "2024-12-31-07-01",
          race_number: 1,
          stage: "一般",
          racer_ids: [1],
        },
      ]),
    /基準のレースが見つからない/,
  );
});

test("半月の範囲は切れ目なく続き、最後の日の翌日で終わる（年をまたぐ）", () => {
  const r = halfMonthRanges("2019-04-01", "2020-01-20");
  assert.deepEqual(r.slice(0, 2), [
    { from: "2019-04-01", to: "2019-04-16" },
    { from: "2019-04-16", to: "2019-05-01" },
  ]);
  assert.deepEqual(r.at(-3), { from: "2019-12-16", to: "2020-01-01" });
  assert.deepEqual(r.at(-2), { from: "2020-01-01", to: "2020-01-16" });
  assert.deepEqual(r.at(-1), { from: "2020-01-16", to: "2020-01-21" });
  for (let i = 1; i < r.length; i++) assert.equal(r[i].from, r[i - 1].to);
  assert.deepEqual(halfMonthRanges("2025-12-01", KB_LAST_DATE), [
    { from: "2025-12-01", to: "2025-12-03" },
  ]);
});

test("足し合わせ: 件数の区分は同じキーを足し、優勝戦の行は重なれば止める", () => {
  const zero = Object.fromEntries(COUNT_COLUMNS.map((c) => [c, 0]));
  const res = (p1) => ({
    venue: [
      {
        racer_id: 1,
        venue_code: 2,
        race_grade: "ippan",
        is_final: false,
        ...zero,
        p1,
      },
    ],
    term: [],
    course: [],
    finals: [],
  });
  const acc = new Map();
  mergeCareerResult(acc, res(2), "kb");
  mergeCareerResult(acc, res(3), "kb");
  assert.equal([...acc.get("venue").values()][0].p1, 5);
  assert.equal([...acc.get("venue").values()][0].era, "kb");
  const fin = {
    venue: [],
    term: [],
    course: [],
    finals: [{ race_id: "x", racer_id: 1 }],
  };
  mergeCareerResult(acc, fin, "kb");
  assert.throws(() => mergeCareerResult(acc, fin, "kb"), /キーが重なった/);
  assert.throws(
    () => mergeCareerResult(new Map(), { venue: [] }, "kb"),
    /term の配列が無い/,
  );
  assert.deepEqual(
    staleRowsOf(
      [
        { a: 1, b: true },
        { a: 2, b: false },
      ],
      [{ a: 1, b: true }],
      ["a", "b"],
    ),
    [{ a: 2, b: false }],
  );
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  // 1人100行なら2層で200行。1000行の上限を超えないよう、1回に読む選手は3人
  assert.equal(
    existingChunkSize(Array.from({ length: 100 }, () => ({ racer_id: 9 }))),
    3,
  );
});

// ---------------------------------------------------------------------------
// 定数・権限
// ---------------------------------------------------------------------------
test("境目の日: SQL の定数・kbArchiveBoundary・kb-backfill が同じ", () => {
  assert.equal(KB_BACKFILL_MAIN_START, MAIN_TABLES_START);
  const next = new Date(`${KB_LAST_DATE}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  assert.equal(next.toISOString().slice(0, 10), MAIN_TABLES_START);
  const kbDates = [...SQL190.matchAll(/<= DATE '(\d{4}-\d{2}-\d{2})'/g)].map(
    (m) => m[1],
  );
  const mainDates = [
    ...SQL190.matchAll(
      />= DATE '(\d{4}-\d{2}-\d{2})'|>= '(\d{4}-\d{2}-\d{2})'/g,
    ),
  ].map((m) => m[1] ?? m[2]);
  assert.ok(
    kbDates.length >= 4 && kbDates.every((d) => d === KB_LAST_DATE),
    `kb の日付 ${kbDates}`,
  );
  assert.ok(
    mainDates.length >= 4 && mainDates.every((d) => d === MAIN_TABLES_START),
    `本体の日付 ${mainDates}`,
  );
});

test("190: 5表は RLS 有効で匿名は読むだけ、3関数は service_role だけ・jsonb を返す", async () => {
  for (const t of [
    "racer_venue_stats",
    "racer_term_stats",
    "racer_course_stats",
    "racer_championships",
    "racer_career_meta",
  ]) {
    const [row] = await all(
      `SELECT c.relrowsecurity AS rls,
              has_table_privilege('anon', $1, 'SELECT') AS anon_select,
              has_any_column_privilege('anon', $1, 'INSERT') AS anon_insert,
              has_any_column_privilege('authenticated', $1, 'UPDATE') AS auth_update,
              has_table_privilege('anon', $1, 'DELETE') AS anon_delete
         FROM pg_class c WHERE c.relname = $1`,
      [t],
    );
    assert.deepEqual(
      row,
      {
        rls: true,
        anon_select: true,
        anon_insert: false,
        auth_update: false,
        anon_delete: false,
      },
      t,
    );
  }
  for (const f of [
    "racer_career_inputs(text, date, date, date)",
    "racer_career_special_races(text, text[])",
    "compute_racer_career_counts(text, date, date, integer[], text[], text[], text[])",
  ]) {
    const [row] = await all(
      `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', $1, 'EXECUTE') AS auth,
              has_function_privilege('service_role', $1, 'EXECUTE') AS svc,
              pg_get_function_result($1::regprocedure) AS result,
              (SELECT prosecdef FROM pg_proc WHERE oid = $1::regprocedure) AS definer`,
      [f],
    );
    assert.deepEqual(
      row,
      { anon: false, auth: false, svc: true, result: "jsonb", definer: false },
      f,
    );
  }
  await assert.rejects(
    db.query(
      "SELECT compute_racer_career_counts('main', '2025-12-03', '2026-01-01', NULL, '{}', '{}', '{}')",
    ),
    /p_racer_ids を渡す/,
  );
  await assert.rejects(
    db.query(
      "SELECT compute_racer_career_counts('kb', '2019-01-01', '2020-01-01', NULL, '{}', ARRAY['a'], '{}')",
    ),
    /長さが違う/,
  );
  await assert.rejects(
    db.query("SELECT racer_career_inputs('x', '2019-01-01', '2020-01-01')"),
    /kb か main/,
  );
});

test("190: 期の始まりは5/1か11/1だけ（表の CHECK）", async () => {
  await assert.rejects(
    db.query(
      "INSERT INTO racer_term_stats(racer_id, term_start, era, race_grade, is_final) VALUES (1, '2024-01-01', 'kb', 'ippan', false)",
    ),
    /check/i,
  );
});

// ---------------------------------------------------------------------------
// 書き手（偽の Supabase。RPC は PGlite）
// ---------------------------------------------------------------------------
function pgRpc(fn) {
  const sigs = {
    racer_career_inputs: [
      "SELECT racer_career_inputs($1, $2::date, $3::date, $4::date) AS r",
      (a) => [a.p_era, a.p_from, a.p_to, a.p_active_from],
    ],
    racer_career_special_races: [
      "SELECT racer_career_special_races($1, $2::text[]) AS r",
      (a) => [a.p_era, a.p_venue_days],
    ],
    compute_racer_career_counts: [
      "SELECT compute_racer_career_counts($1, $2::date, $3::date, $4::int[], $5::text[], $6::text[], $7::text[]) AS r",
      (a) => [
        a.p_era,
        a.p_from,
        a.p_to,
        a.p_racer_ids,
        a.p_final_stages,
        a.p_override_race_ids,
        a.p_override_grades,
      ],
    ],
  };
  const [sql, args] = sigs[fn];
  return async (a) => (await all(sql, args(a)))[0].r;
}

async function fakeClient(existing = {}) {
  return createFakeSupabaseClient({
    tables: {
      kb_archive_venue_days: await all(
        "SELECT venue_day_id, to_char(race_date, 'YYYY-MM-DD') AS race_date FROM kb_archive_venue_days",
      ),
      kb_archive_races: await all("SELECT race_id FROM kb_archive_races"),
      ...existing,
    },
    rpcs: Object.fromEntries(
      [
        "racer_career_inputs",
        "racer_career_special_races",
        "compute_racer_career_counts",
      ].map((f) => [f, pgRpc(f)]),
    ),
  });
}

const rowsOf = (client, table, pred = () => true) =>
  (client.data[table] ?? []).filter(pred);

test("kb 層: 着のコード・期・優勝戦・グレードの補正・境目を数え、もう一度走らせても書かない", async () => {
  const client = await fakeClient();
  const { meta } = await runKbEra({ client, dryRun: false, log: quiet });

  // 着のコード（NULL は数えない、ZZ は other_code）
  const v1 = rowsOf(client, "racer_venue_stats", (r) => r.venue_code === 1);
  const sum = (racer, col) =>
    v1.filter((r) => r.racer_id === racer).reduce((a, r) => a + r[col], 0);
  assert.deepEqual(
    [
      sum(301, "f"),
      sum(301, "s1"),
      sum(302, "l0"),
      sum(302, "other_code"),
      sum(303, "k0"),
      sum(303, "k1"),
    ],
    [1, 1, 1, 1, 1, 1],
  );
  assert.deepEqual(
    [
      sum(304, "s0"),
      sum(304, "l1"),
      sum(305, "code00"),
      sum(305, "s2"),
      sum(306, "p1"),
    ],
    [1, 1, 1, 1, 1],
  );
  assert.equal(
    v1
      .filter((r) => r.racer_id === 306)
      .reduce((a, r) => a + COUNT_COLUMNS.reduce((s, c) => s + r[c], 0), 0),
    1,
    "NULL の着は数えない",
  );

  // 期: 2019-04 は 2018-11 の期、5/1・11/1 はその月の期
  const terms301 = rowsOf(client, "racer_term_stats", (r) => r.racer_id === 301)
    .map((r) => r.term_start)
    .sort();
  assert.deepEqual(
    [...new Set(terms301)],
    ["2018-11-01", "2019-05-01", "2019-11-01"],
  );
  // 進入コース別: K0（進入なし）は数えない。301 の1コースは F・S1（2019-04）と 01（5月・11月）
  const c301 = rowsOf(
    client,
    "racer_course_stats",
    (r) => r.racer_id === 301 && r.course === 1,
  );
  assert.deepEqual(c301.map((r) => [r.term_start, r.f, r.s1, r.p1]).sort(), [
    ["2018-11-01", 1, 1, 0],
    ["2019-05-01", 0, 0, 1],
    ["2019-11-01", 0, 0, 1],
  ]);
  assert.equal(
    rowsOf(client, "racer_course_stats", (r) => r.racer_id === 303 && r.k0 > 0)
      .length,
    0,
  );

  // 優勝戦の出走: GP優勝戦（stage_kind=other）は SG。QC は賞金女王決定が G1・シリーズの優勝戦が G3。CC は12Rの組が SG・11R が G2
  const champ = (race, racer) =>
    rowsOf(
      client,
      "racer_championships",
      (r) => r.race_id === race && r.racer_id === racer,
    )[0];
  assert.equal(champ("2019-12-22-04-12", 101).race_grade, "SG");
  assert.equal(champ("2019-12-22-04-12", 101).finish_code, "01");
  assert.equal(champ("2024-12-31-07-12", 101).race_grade, "G1");
  assert.equal(champ("2024-12-31-07-11", 201).race_grade, "G3");
  assert.equal(champ("2024-11-24-19-12", 501).race_grade, "SG");
  assert.equal(champ("2024-11-24-19-11", 601).race_grade, "G2");
  assert.equal(rowsOf(client, "racer_championships").length, 6 * 5);
  // 優勝戦でないレースの補正: QC のトライアル G1・シリーズの一般戦 G3、CC 初日の 501 の組 SG・601 の組 G2、唐津 2024 は G1・2022 は ippan
  const grades = (racer, venue) => [
    ...new Set(
      rowsOf(
        client,
        "racer_venue_stats",
        (r) => r.racer_id === racer && r.venue_code === venue && !r.is_final,
      ).map((r) => r.race_grade),
    ),
  ];
  assert.deepEqual(
    [grades(101, 7), grades(201, 7), grades(501, 19), grades(601, 19)],
    [["G1"], ["G3"], ["SG"], ["G2"]],
  );
  assert.deepEqual(grades(701, 23).sort(), ["G1", "ippan"]);
  // 境目: kb の 2025-12-02 は数え、2025-12-03 は数えない
  const v5 = rowsOf(
    client,
    "racer_venue_stats",
    (r) => r.racer_id === 801 && r.venue_code === 5,
  );
  assert.deepEqual(
    v5.map((r) => [r.era, r.p1]),
    [["kb", 1]],
  );

  // 記録
  const m = rowsOf(client, "racer_career_meta")[0];
  assert.equal(m.era, "kb");
  assert.equal(m.rule_version, RULE_VERSION);
  assert.equal(m.source_to, "2025-12-02");
  assert.deepEqual(
    [
      m.fingerprint.venue_days,
      m.fingerprint.races,
      m.fingerprint.max_race_date,
    ],
    [12, 17, "2025-12-03"],
  );
  assert.equal(
    meta.source_rows,
    Object.values(m.fingerprint.boats_by_year).reduce((a, b) => a + b, 0),
  );

  // もう一度走らせても、件数の表は書かない（変更の無い行は書かない）・消さない
  const before = client.writes.length;
  await runKbEra({ client, dryRun: false, log: quiet });
  const again = client.writes
    .slice(before)
    .filter((w) => w.table !== "racer_career_meta" && w.count > 0);
  assert.deepEqual(again, []);

  // 元の艇が消えたら、件数が0になったセルを消す（2022 の唐津の節を消す）
  await db.exec(
    "DELETE FROM kb_archive_boats WHERE race_id LIKE '2022-01-08-23-%'",
  );
  await runKbEra({ client, dryRun: false, log: quiet });
  assert.deepEqual(grades(701, 23), ["G1"]);
  await db.exec(`INSERT INTO kb_archive_boats(race_id, boat_number, racer_id, course, finish_raw)
    SELECT '2022-01-08-23-01', n, 700 + n, n, lpad(n::text, 2, '0') FROM generate_series(1, 6) n`);
});

test("消えるセルが多すぎれば何も書かずに止める", async () => {
  const zero = Object.fromEntries(COUNT_COLUMNS.map((c) => [c, 0]));
  const existing = Array.from({ length: 100 }, (_, i) => ({
    racer_id: i,
    venue_code: 1,
    era: "kb",
    race_grade: "ippan",
    is_final: false,
    ...zero,
    p1: 1,
  }));
  const client = createFakeSupabaseClient({
    tables: { racer_venue_stats: existing },
  });
  const acc = new Map([
    ["venue", new Map()],
    ["term", new Map()],
    ["course", new Map()],
    ["finals", new Map()],
  ]);
  await assert.rejects(
    writeCareerRows(client, { era: "kb", acc, dryRun: false }),
    /消えるセルが 100\/100 件で多すぎる/,
  );
  assert.equal(client.data.racer_venue_stats.length, 100);
});

test("main 層: 全選手の計算・境目・race_series の補い・未着の走・毎晩の対象（直近の出走と着の書き換え）", async () => {
  const client = await fakeClient();
  const full = await runMainEra({
    client,
    today: "2026-10-30",
    dryRun: false,
    all: true,
    log: quiet,
  });
  assert.equal(full.complete, true);
  // 本体の 2025-12-02 は数えない（801 の main は 12-06 の優勝戦だけ）
  const v801 = rowsOf(client, "racer_venue_stats", (r) => r.racer_id === 801);
  assert.deepEqual(
    v801.map((r) => [r.era, r.race_grade, r.is_final, r.p1]),
    [["main", "G2", true, 1]],
  );
  const c = rowsOf(
    client,
    "racer_championships",
    (r) => r.race_id === "2025-12-06-05-12" && r.racer_id === 801,
  )[0];
  assert.deepEqual(
    [c.series_title, c.course, c.race_grade],
    ["ＸＸ記念", 2, "G2"],
  );
  // QC（本体）: シリーズは G3 に直る
  assert.deepEqual(
    [
      ...new Set(
        rowsOf(
          client,
          "racer_venue_stats",
          (r) => r.racer_id === 201 && r.era === "main",
        ).map((r) => r.race_grade),
      ),
    ],
    ["G3"],
  );
  // 1月の走は前の年の11月の期。未着（10/28、コード NULL）の走は数えない
  assert.deepEqual(
    rowsOf(client, "racer_term_stats", (r) => r.racer_id === 901).map(
      (r) => r.term_start,
    ),
    ["2025-11-01"],
  );
  assert.equal(
    rowsOf(
      client,
      "racer_term_stats",
      (r) =>
        r.racer_id === 101 && r.era === "main" && r.term_start === "2026-05-01",
    ).length,
    0,
  );
  const meta = rowsOf(client, "racer_career_meta", (r) => r.era === "main")[0];
  assert.ok(meta.report.full_computed_at);

  // 毎晩: 直近3日（10/27〜）に出走表に載った 101〜106 と、着のコードが 10/29 に書き換わった 901〜906 だけ
  client.rpcCalls.length = 0;
  const nightly = await runMainEra({
    client,
    today: "2026-10-30",
    dryRun: false,
    log: quiet,
  });
  assert.equal(nightly.racers, 12);
  const ids = client.rpcCalls
    .filter((c) => c.name === "compute_racer_career_counts")
    .flatMap((c) => c.args.p_racer_ids);
  assert.deepEqual(
    ids,
    [101, 102, 103, 104, 105, 106, 901, 902, 903, 904, 905, 906],
  );
  // 部分の計算でも、全選手を計算した時刻は消さない
  assert.equal(
    rowsOf(client, "racer_career_meta", (r) => r.era === "main")[0].report
      .full_computed_at,
    meta.report.full_computed_at,
  );
  // 毎晩は、対象の選手の kb 層の行に触れない
  assert.equal(
    rowsOf(client, "racer_venue_stats", (r) => r.era === "kb").length,
    0,
  );
});

test("毎晩の Cron: kb 層が未計算なら知らせるだけ、計算後に kb_archive が変われば error", async () => {
  const client = await fakeClient();
  const first = await runRacerCareerMainJob({
    client,
    today: "2026-10-30",
    dryRun: false,
    log: quiet,
  });
  assert.equal(first.outcome, "ok");
  assert.equal(first.report.kb.state, "not_computed");
  assert.equal(first.rowsExpected, 1);
  assert.equal(first.incomplete, false);

  await runKbEra({ client, dryRun: false, log: quiet });
  assert.equal(
    (
      await runRacerCareerMainJob({
        client,
        today: "2026-10-30",
        dryRun: false,
        log: quiet,
      })
    ).report.kb.state,
    "same",
  );

  client.data.kb_archive_races.push({ race_id: "2025-11-30-01-01" });
  const changed = await runRacerCareerMainJob({
    client,
    today: "2026-10-30",
    dryRun: false,
    log: quiet,
  });
  assert.equal(changed.outcome, "error");
  assert.match(changed.error, /racer-career-backfill\.js --era=kb を再実行/);

  // 時間切れ（shouldStop）なら記録を書かず、補足の起動に回す
  const stopped = await runRacerCareerMainJob({
    client: await fakeClient(),
    today: "2026-10-30",
    dryRun: false,
    shouldStop: () => true,
    log: quiet,
  });
  assert.equal(stopped.incomplete, true);
  // shadow（dryRun）は表に書かない
  const shadow = await fakeClient();
  await runRacerCareerMainJob({
    client: shadow,
    today: "2026-10-30",
    dryRun: true,
    log: quiet,
  });
  assert.equal(
    rowsOf(shadow, "racer_venue_stats").length +
      rowsOf(shadow, "racer_career_meta").length,
    0,
  );
  await assert.rejects(
    runRacerCareerMainJob({
      client,
      today: "20261030",
      dryRun: true,
      log: quiet,
    }),
    /YYYY-MM-DD/,
  );
});

// ---------------------------------------------------------------------------
// 実行の基盤・CLI
// ---------------------------------------------------------------------------
test("レジストリ・vercel.json・api/cron: 23:30 と 01:00 JST、maxDuration 300", async () => {
  const def = SCRAPE_JOBS.racer_career_main;
  assert.deepEqual(
    {
      kind: def.kind,
      targetTimeJst: def.targetTimeJst,
      maxDurationSec: def.maxDurationSec,
    },
    { kind: "daily", targetTimeJst: "23:30", maxDurationSec: 300 },
  );
  const src = await read("../../api/cron/racer-career-main.js");
  assert.equal(Number(/maxDuration:\s*(\d+)/.exec(src)[1]), def.maxDurationSec);
  const mod = await import("../../api/cron/racer-career-main.js");
  assert.equal(typeof mod.default, "function");
  const vercel = JSON.parse(await read("../../vercel.json"));
  const schedules = vercel.crons
    .filter((c) => c.path === "/api/cron/racer-career-main")
    .map((c) => c.schedule);
  // UTC → JST: 14:30 → 23:30、16:00 → 01:00
  assert.deepEqual(schedules, ["30 14 * * *", "0 16 * * *"]);
});

test("CLI の引数: --era は必須、kb に --all・--today は付けない", () => {
  assert.deepEqual(parseArgs(["--era=kb", "--apply"]), {
    era: "kb",
    apply: true,
    all: false,
    today: null,
    allowMassDelete: false,
  });
  assert.deepEqual(parseArgs(["--era=main", "--all", "--today=2026-10-30"]), {
    era: "main",
    apply: false,
    all: true,
    today: "2026-10-30",
    allowMassDelete: false,
  });
  assert.throws(() => parseArgs([]), /--era=kb か --era=main/);
  assert.throws(() => parseArgs(["--era=kb", "--all"]), /--era=main だけ/);
  assert.throws(() => parseArgs(["--era=main", "--today=1030"]), /YYYY-MM-DD/);
  assert.throws(
    () => parseArgs(["--era=main", "--force"]),
    /知らないオプション/,
  );
});

test("照合の関門（verify-racer-career-gate.js）の比べ方: 2層を足し、期・コード・優勝・優出の数え方ごとに比べる", async () => {
  const { compareCareerToOfficial } =
    await import("./verify-racer-career-gate.js");
  // BOA-1193 の純関数の代わり（この試験は比べ方だけを見る。定義そのものは BOA-1193 の verify が固定する）
  const START = new Set([
    "01",
    "02",
    "03",
    "04",
    "05",
    "06",
    "F",
    "L1",
    "K1",
    "S1",
    "S2",
  ]);
  const PTS = { "01": 10, "02": 8, "03": 6, "04": 4, "05": 2, "06": 1 };
  const career = {
    isStart: (c) => START.has(c),
    winRate: (rows) => {
      const s = rows.filter((r) => START.has(r.finishRaw));
      return s.length === 0
        ? null
        : Math.round(
            (s.reduce((a, r) => a + (PTS[r.finishRaw] ?? 0), 0) / s.length) *
              100,
          ) / 100;
    },
  };
  const zero = Object.fromEntries(COUNT_COLUMNS.map((c) => [c, 0]));
  const termRows = [
    {
      racer_id: 1,
      term_start: "2025-11-01",
      race_grade: "ippan",
      is_final: false,
      ...zero,
      p1: 1,
      k0: 1,
    }, // kb
    {
      racer_id: 1,
      term_start: "2025-11-01",
      race_grade: "ippan",
      is_final: false,
      ...zero,
      p2: 1,
      f: 1,
    }, // main
    {
      racer_id: 2,
      term_start: "2025-11-01",
      race_grade: "ippan",
      is_final: false,
      ...zero,
      p1: 1,
    }, // 公式の名簿に無い
  ];
  const courseRows = [
    { racer_id: 1, course: 1, term_start: "2025-11-01", ...zero, p1: 1 },
    { racer_id: 1, course: 2, term_start: "2025-11-01", ...zero, p2: 1, f: 1 },
  ];
  const champRows = [
    { racer_id: 1, race_date: "2026-04-30", finish_code: "01" },
    { racer_id: 1, race_date: "2026-01-02", finish_code: "S0" },
    { racer_id: 1, race_date: "2026-05-01", finish_code: "01" }, // 次の期
  ];
  const off = {
    racer_id: 1,
    calc_from: "2025-11-01",
    starts: 3,
    first_count: 1,
    second_count: 1,
    win_rate: 6.0,
    finals: 1,
    wins: 1,
  };
  for (let c = 1; c <= 6; c++)
    for (const col of [
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
      "f",
      "l0",
      "l1",
      "k0",
      "k1",
      "s0",
      "s1",
      "s2",
    ])
      off[`c${c}_${col}`] = 0;
  off.c1_p1 = 1;
  off.c2_p2 = 1;
  off.c2_f = 1;
  const ok = compareCareerToOfficial({
    termRows,
    courseRows,
    champRows,
    official: [off],
    career,
  });
  assert.equal(ok.compared, 1);
  assert.deepEqual(ok.mismatches, []);
  // 優出: S0 を含めると2、含めないと1（公式は1）
  assert.deepEqual(ok.finalsMatch, { all_codes: 0, without_absent: 1 });
  assert.deepEqual(ok.extra, ["2|2025-11-01"]);
  // 1つ食い違えば、その選手×期と項目を出す
  const ng = compareCareerToOfficial({
    termRows,
    courseRows,
    champRows,
    official: [{ ...off, starts: 4, win_rate: 6.01, c3_p1: 1 }],
    career,
  });
  assert.deepEqual(Object.keys(ng.mismatches[0].diff).sort(), [
    "course",
    "starts",
    "win_rate",
  ]);
  assert.deepEqual(ng.mismatches[0].diff.course, {
    c3_p1: { ours: 0, official: 1 },
  });
  assert.equal(ng.perTerm["2025-11-01"].mismatched, 1);
});
