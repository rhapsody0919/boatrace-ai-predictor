// 選手ページ（GS00 案2）の集計の表（マイグレーション 190）と書き手（scripts/lib/racerCareerJob.js）の再現テスト。
// - 190 を PGlite に当て（kb_archive は 074 をそのまま、本体は必要な列だけの表）、3つの RPC の数え方・境目・権限を確かめる
// - 優勝戦の判定（isCareerFinalStage: isFinalStage の v2＋公式が数える2つの名前）・グレードの補正（QC・CC・唐津）・期の区切り・半月の範囲・足し合わせ・消えたセルの扱い
// - kb 層の1回の計算と main 層の毎晩の計算を、偽の Supabase（RPC は PGlite に渡す）で通し、冪等・指紋の見張りを確かめる
// - レジストリ・vercel.json・api/cron の maxDuration と cron 式、CLI の引数
// 外部接続なし（本番 DB にも Slack にも繋がない）
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  finalStagesOf,
  gradeOverridesOf,
  halfMonthRanges,
  specialSeriesGroups,
  splitByRacerLinks,
} from "../lib/racerCareerJob.js";
import { KB_LAST_DATE } from "../lib/kbArchiveBoundary.js";




import { runRacerCareerTablesScenes1 } from "./verifyData/racer-career-tables-scenes-1.js";
import { runRacerCareerTablesScenes2 } from "./verifyData/racer-career-tables-scenes-2.js";
import { runRacerCareerTablesScenes3 } from "./verifyData/racer-career-tables-scenes-3.js";
import { runRacerCareerTablesScenes4 } from "./verifyData/racer-career-tables-scenes-4.js";

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

/** before(async () => { の中身を割った 1/3 */
async function careerSetup1() {
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
    CREATE TABLE race_series(venue_code SMALLINT, start_date DATE, end_date DATE, title TEXT, grade TEXT, class_code TEXT, PRIMARY KEY (venue_code, start_date));`);
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
}

/** before(async () => { の中身を割った 2/3 */
async function careerSetup2() {
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
  // 2025-12〜2026-02 の Lady・Rookie の節は races.race_grade も race_series.grade も NULL。class_code で G3・ippan に読み替える
  await db.query(
    `INSERT INTO race_series(venue_code, start_date, end_date, title, grade, class_code) VALUES
       (8,'2026-01-18','2026-01-23','オールレディース','', 'Lady'), (9,'2026-01-18','2026-01-23','ルーキーシリーズ',NULL,'Rookie')`,
  );
  await db.exec("UPDATE race_series SET grade = NULL WHERE venue_code = 8");
  await mainRace("2026-01-20-08-01", {
    grade: null,
    boats: six([951, 952, 953, 954, 955, 956]),
  });
  await mainRace("2026-01-20-09-01", {
    grade: null,
    boats: six([961, 962, 963, 964, 965, 966]),
  });
  // 着のコードの書き換えが 10/27 01:00 JST（UTC では 10/26）。JST の日付の窓（10/27〜）に入る
  await mainRace("2026-02-10-07-01", {
    boats: six([971, 972, 973, 974, 975, 976]),
    updatedAt: "2026-10-26T16:00:00Z",
  });
}

/** before(async () => { の中身を割った 3/3 */
async function careerSetup3() {
  // 直近の走。着のコードがまだ無い（K の未着）走は数えない
  await mainRace("2026-10-28-01-01", {
    boats: six(
      [101, 102, 103, 104, 105, 106],
      [null, null, null, null, null, null],
    ),
  });
}

before(async () => {
  await careerSetup1();
  await careerSetup2();
  await careerSetup3();
});

// ---------------------------------------------------------------------------
// 純関数
// ---------------------------------------------------------------------------
test("優勝戦の種別は isCareerFinalStage（isFinalStage v2＋2つの名前）で決める（stage_kind は使わない）", () => {
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
  // isFinalStage（v2）が拾わないが公式が優勝戦として数える2つの名前（2026-11-02、kb の照合で12行のずれ）
  assert.deepEqual(
    finalStagesOf(["オオムラGP", "関ヶ原決戦", "B組優勝戦", "グランプリ特", "グランプリD"]),
    ["B組優勝戦", "オオムラGP", "関ヶ原決戦"],
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
    // main はレースごとの題で日を拾う。同じ日が題を変えて2回来ても1日、丸一日の中止（12/27 が無い）でも節を割らない
    {
      venue_code: 24,
      race_date: "2025-12-26",
      title: "第14回クイーンズクライマックス",
    },
    {
      venue_code: 24,
      race_date: "2025-12-26",
      title: "第14回クイーンズクライマックス/G3QCシリーズ",
    },
    {
      venue_code: 24,
      race_date: "2025-12-28",
      title: "第14回クイーンズクライマックス/G3QCシリーズ",
    },
  ]);
  assert.deepEqual(
    groups.map((g) => [g.rule.id, g.venueDays, g.lastDay]),
    [
      ["qc", ["2024-12-30-07", "2024-12-31-07"], "2024-12-31-07"],
      ["cc", ["2024-11-24-19"], "2024-11-24-19"],
      ["karatsu-2024-battle", ["2024-10-12-23"], "2024-10-12-23"],
      ["qc", ["2025-12-26-24", "2025-12-28-24"], "2025-12-28-24"],
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
  // 基準のレース（トライアル）がまだ無い節は補正せず seedMissing を残す（開催中の QC。kb の計算はこれで止まる）
  const pending = gradeOverridesOf(groups, [
    { race_id: "2024-12-31-07-01", race_number: 1, stage: "一般", racer_ids: [1] },
  ]);
  assert.deepEqual(pending.raceIds, []);
  assert.equal(pending.report[0].seedMissing, true);
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

// ---- 後半の場面（verifyData/racer-career-tables-scenes-1.js・racer-career-tables-scenes-2.js・racer-career-tables-scenes-3.js・racer-career-tables-scenes-4.js） ----
runRacerCareerTablesScenes1({ SQL190, db, all });
runRacerCareerTablesScenes2({ db, quiet });
runRacerCareerTablesScenes3({ read, quiet });
runRacerCareerTablesScenes4();
