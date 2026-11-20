/**
 * verify-data-health-job.js - 汎用の日次監視 data_health（完了の定義C。scripts/lib/dataHealth/・
 * api/cron/data-health.js・マイグレーション089）の検証。本番DB・Slackには接続しない。
 *
 * 確認すること:
 *   (a) 登録表の整合性（関数の実在・閾値・除外の宣言・空テーブルの扱い）
 *   (b) マイグレーション089・100: functions.js から生成したDDLとの一致（二重実装のずれの検知）、REVOKE・GRANT の内容、
 *       関数の本体に書き込み・DDL・動的SQLが無いこと
 *   (c) DB関数の意味論（PGlite。実際にPostgreSQLで、最小のスキーマ・固定のデータに適用して実行する）:
 *       存在充足率の分母（中止の除外・rank4〜6の分類）、出走表の拡張列、ピットレポートの対象レース、節・期別成績、
 *       空テーブル、月別、引数の検査（期間の上限・NULL）、権限（anon・authenticated・PUBLICが実行不可、service_roleのみ）、再適用（冪等）
 *   (d) 判定（純粋関数）: 閾値の境界・取得開始日・確定ラグ・母数の下限・未導入・空テーブルの分類・週次
 *   (e) 通知の一意性: 同じ未達を毎日通知しない・悪化・継続中の再通知・回復後の再発・共通原因の要約・until
 *   (f) 実行: shadow は通知しない、live は last_report.alerts に出す（scrape-monitor が拾う）、一部の関数の失敗は
 *       「検査を実行できなかった」通知、全ての失敗は実行の失敗、共通ラッパ経由の冪等（同じ対象日は1回）
 *   (g) scrape-monitor との接続: last_report.alerts が monitor の通知になり、同じ key は再通知されない
 *   (h) メタ監視: data_health の未処理を、日次の死活確認が検知する
 *   (i) 配線: レジストリ・vercel.json（JST 06:35・07:35・08:35）・api/cron の maxDuration
 *   (j) 変異検証: 判定・通知の一意性・実行を壊すと、上の検証が失敗する
 *
 * 実行: PGlite は devDependencies（npm ci で入る）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateChecks } from "../lib/dataHealth/checks.js";
import { DATA_HEALTH_FUNCTIONS, TABLE_ROWS_TABLES } from "../lib/dataHealth/functions.js";










import { show } from "./verifyData/data-health-job-fixtures.js";


import { runDataHealthJobScenes1, runDataHealthJobScenes2 } from "./verifyData/data-health-job-scenes-1.js";
import { runDataHealthJobScenes3 } from "./verifyData/data-health-job-scenes-2.js";
import { runDataHealthJobScenes4 } from "./verifyData/data-health-job-scenes-3.js";
import {
  runDataHealthJobScenes5,
  runDataHealthJobScenes6,
  runDataHealthJobScenes7,
  runDataHealthJobScenes8,
} from "./verifyData/data-health-job-scenes-4.js";
import { runDataHealthJobScenes9, runDataHealthJobScenes10 } from "./verifyData/data-health-job-scenes-5.js";
import {
  stripSqlComments,
  PGlite,
  runDataHealthJobTail1,
  runDataHealthJobTail2,
  runDataHealthJobTail3,
  runDataHealthJobTail4,
} from "./verifyData/data-health-job-tail.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const LIB = path.join(ROOT, "scripts/lib/dataHealth");
const printOut = console.log.bind(console);
const printErr = console.error.bind(console);
console.warn = () => {};
console.error = () => {};

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    printOut(`✅ ${label}`);
  } else {
    failures++;
    printErr(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// (a) 登録表の整合性
// ---------------------------------------------------------------------------
const problems = validateChecks({
  functions: DATA_HEALTH_FUNCTIONS,
  tableRowsTables: TABLE_ROWS_TABLES,
});
check("登録表: 整合性の違反なし", problems.length === 0, show(problems));
{
  const bad = validateChecks({
    checks: [
      {
        id: "x",
        label: "x",
        classification: "count",
        severity: "alert",
        fn: "no_such_fn",
        numerator: "a",
        denominator: "b",
        threshold: 0.9,
        lagDays: 9,
        requiresTable: "no_table",
        since: "2026/09/22",
      },
    ],
    policies: { races: { policy: "weird" } },
    functions: DATA_HEALTH_FUNCTIONS,
    tableRowsTables: TABLE_ROWS_TABLES,
  });
  check(
    "登録表の検査: 未登録の関数・理由のない閾値・lagDays・requiresTable・since・空テーブルの扱いの不正を検出する",
    bad.some((p) => p.includes("未登録の関数")) &&
      bad.some((p) => p.includes("note")) &&
      bad.some((p) => p.includes("lagDays")) &&
      bad.some((p) => p.includes("requiresTable")) &&
      bad.some((p) => p.includes("since")) &&
      bad.some((p) => p.includes("policy")) &&
      bad.some((p) => p.includes("未登録")),
    show(bad),
  );
}

// ---- 後半の場面（verifyData/data-health-job-tail.js） ----
runDataHealthJobTail1({ printErr, check });

// ---------------------------------------------------------------------------
// (b) マイグレーション089・100（data_health の関数を含むマイグレーション）
// ---------------------------------------------------------------------------
// data_health の関数を含むマイグレーション。新しい関数を別のファイルで足したら、ここに追記する
// （登録表 functions.js の migration と突き合わせ、取りこぼしを機械検査する）
// 適用の順に並べる（後ろのファイルが、前のファイルの CREATE OR REPLACE を上書きする。PGliteへもこの順で流す）
const MIGRATION_FILES = Object.freeze([
  "089_data_health_functions.sql",
  "100_data_health_entries_duplicates.sql",
  "105_data_health_coverage_exhibition_row.sql",
  "107_data_health_cancellation_with_result.sql",
  "121_data_health_pre_race_series_day.sql",
  "170_data_health_freshness.sql",
]);
const MIGRATION_FILE = MIGRATION_FILES[0];
const migrationSqlByFile = new Map(
  MIGRATION_FILES.map((f) => [
    f,
    fs.readFileSync(path.join(ROOT, "docs/db-migration", f), "utf8"),
  ]),
);
/** PGliteへの適用・GRANTの規律・変異検証は、全ファイルをまとめて見る */
const migrationSql = MIGRATION_FILES.map((f) => migrationSqlByFile.get(f)).join(
  "\n",
);

// ---- 後半の場面（verifyData/data-health-job-tail.js） ----
runDataHealthJobTail2({ printErr, check, MIGRATION_FILES });

// ---- 後半の場面（verifyData/data-health-job-scenes-1.js） ----
runDataHealthJobScenes1({ check, MIGRATION_FILES, MIGRATION_FILE, migrationSqlByFile, migrationSql, stripSqlComments, buildDb });

// ---- 後半の場面（verifyData/data-health-job-tail.js） ----
await runDataHealthJobTail3({ printErr, check, MIGRATION_FILES });

/** マイグレーション170（鮮度の関数・朝のジョブのモードの行）が読む・書く表の最小のスキーマ */
const FRESHNESS_STUB_SQL = `
${["outcome_distribution", "exhibition_time_top_stats", "losing_technique_stats", "nige_outcome_distribution", "winning_technique_stats", "top_start_stats"].map((t) => `CREATE TABLE ${t} (id serial, created_at timestamptz);`).join("\n")}
CREATE TABLE venue_technique_period_stats (venue_code smallint, last_updated date);
CREATE TABLE st_course_baseline (course smallint, window_end date);
CREATE TABLE nige_second_by_course (venue_code smallint, window_end date);
CREATE TABLE accuracy_cache (key text primary key, updated_at timestamptz);
CREATE TABLE race_history_cache (key text primary key, updated_at timestamptz);
CREATE TABLE racer_grade_cache (key text primary key, updated_at timestamptz);
CREATE TABLE model_performance_daily (model_id text, date date);
ALTER TABLE racer_series_points ADD COLUMN scraped_at timestamptz;
CREATE TABLE venues (code smallint, updated_at timestamptz);
CREATE TABLE racer_aggregated_stats (racer_id integer, calculated_at timestamptz);
CREATE TABLE venue_grade_boat_stats (venue_code smallint, updated_at timestamptz);
CREATE TABLE bet_recommendations (race_id varchar(20), model_id text, recommendation text, created_at timestamptz default now());
CREATE TABLE analogy_v16_snapshots (race_id varchar(20), stage text, primary key (race_id, stage));
CREATE TABLE poirot_predictions (race_id varchar(20), model_version text, primary key (race_id, model_version));
CREATE TABLE scrape_job_state (job text primary key, mode text not null default 'off', last_success_at timestamptz, last_tick_at timestamptz, updated_at timestamptz not null default now());
INSERT INTO scrape_job_state (job, mode) VALUES ('data_health', 'live');
`;

async function buildDb() {
  const db = new PGlite();
  await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE races (race_id varchar(20) primary key, race_date date not null, venue_code smallint not null, race_number smallint not null, race_grade text, cancellation_status text, start_time time);
CREATE TABLE race_results (race_id varchar(20) primary key, rank1 smallint, rank2 smallint, rank3 smallint, rank4 smallint, rank5 smallint, rank6 smallint, actual_course_1 smallint, winning_technique text);
CREATE TABLE race_conditions (race_id varchar(20) primary key, race_stage text, race_distance_m smallint, race_labels text[], series_day smallint);
CREATE TABLE race_start_timings (race_id varchar(20), boat_number smallint, start_timing numeric, finish_mark text, finish_rank smallint, primary key (race_id, boat_number));
CREATE TABLE exhibition_data (race_id varchar(20), boat_number smallint, exhibition_time numeric, start_timing numeric, today_weight numeric, primary key (race_id, boat_number));
CREATE TABLE race_odds (race_id varchar(20), captured_at timestamptz, trifecta_all jsonb, trio_all jsonb, exacta_all jsonb, quinella_all jsonb, wide_all jsonb, primary key (race_id, captured_at));
CREATE TABLE race_entries (race_id varchar(20), boat_number smallint, racer_id integer, weight_kg numeric, branch text, f_count smallint, l_count smallint, is_absent boolean, primary key (race_id, boat_number));
CREATE TABLE race_pit_reports (race_id varchar(20) primary key, status text);
CREATE TABLE race_series (venue_code smallint, start_date date, end_date date, primary key (venue_code, start_date));
CREATE TABLE racer_period_stats (racer_id integer, period_year smallint, period_no smallint, primary key (racer_id, period_year, period_no));
CREATE TABLE race_payouts (race_id varchar(20));
CREATE TABLE racer_profiles (racer_id integer);
CREATE TABLE racer_series_points (racer_id integer);
CREATE TABLE venue_entry_course_stats (venue_code smallint);
CREATE TABLE venue_motor_stats (venue_code smallint);
CREATE TABLE external_predictions (race_id varchar(20));
CREATE TABLE race_special_notes (race_id varchar(20));
`);
  await db.exec(FRESHNESS_STUB_SQL);
  await db.exec("BEGIN;\n" + migrationSql + "\nCOMMIT;");
  // 冪等（再適用しても失敗しない）
  await db.exec("BEGIN;\n" + migrationSql + "\nCOMMIT;");
  return db;
}

// ---- 後半の場面（verifyData/data-health-job-scenes-1.js・data-health-job-scenes-2.js・data-health-job-scenes-3.js・data-health-job-scenes-4.js） ----
await runDataHealthJobScenes2({ check, MIGRATION_FILES, MIGRATION_FILE, migrationSqlByFile, migrationSql, stripSqlComments, buildDb });
await runDataHealthJobScenes3({ check, migrationSqlByFile });
await runDataHealthJobScenes4({ LIB, check });
await runDataHealthJobScenes5({ check, migrationSql, withMutant, mutateEachFile, runEntriesDuplicates, runCancellationWithResult });

// (h)・(i) の本文の読みは verify に置く（(h)・(i) の塊は verifyData/ へ移すため。読む物と回数は前と同じ）
const LIVENESS_WF = fs.readFileSync(
  path.join(ROOT, ".github/workflows/scrape-monitor-liveness.yml"),
  "utf8",
);
const LIVENESS_SCRIPT = fs.readFileSync(
  path.join(ROOT, "scripts/maintenance/check-scrape-monitor-liveness.js"),
  "utf8",
);
const VERCEL_JSON_TEXT = fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8");
const CRON_SRC = fs.readFileSync(
  path.join(ROOT, "api/cron/data-health.js"),
  "utf8",
);
const MORNING_CRON_SRC = fs.readFileSync(
  path.join(ROOT, "api/cron/data-health-morning.js"),
  "utf8",
);
const JOB_SRC = fs.readFileSync(path.join(LIB, "job.js"), "utf8");

// ---- 後半の場面（verifyData/data-health-job-tail.js） ----
await runDataHealthJobTail4({ printErr, check, MIGRATION_FILES, LIVENESS_WF, LIVENESS_SCRIPT, VERCEL_JSON_TEXT, CRON_SRC, MORNING_CRON_SRC, JOB_SRC });

// ---------------------------------------------------------------------------
// (j) 変異検証: 壊した版で、上の検証が失敗する
// ---------------------------------------------------------------------------
/**
 * 変異ごとに別モジュールとして読み込むための通し番号。以前は import の URL を `?t=${Date.now()}` で区別していたが、
 * 同じファイルの変異が同じミリ秒に続くと URL が一致し、ESM のキャッシュから直前の変異が返る（BOA-648/BOA-671と同種）。
 * 時刻ではなく通し番号で区別する
 */
let mutantSeq = 0;
async function withMutant(fileName, replacements, run) {
  let mutated = fs.readFileSync(path.join(LIB, fileName), "utf8");
  for (const [from, to] of replacements) {
    if (!mutated.includes(from))
      throw new Error(
        `変異の対象が見つかりません（${fileName}）: ${from.slice(0, 70)}`,
      );
    mutated = mutated.replace(from, to);
  }
  const tmpFile = path.join(
    LIB,
    `${fileName.replace(/\.js$/, "")}.mutant-${process.pid}-${++mutantSeq}.tmp.mjs`,
  );
  fs.writeFileSync(tmpFile, mutated);
  try {
    return await run(await import(tmpFile));
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

// ---- 後半の場面（verifyData/data-health-job-scenes-4.js） ----
await runDataHealthJobScenes6({ check, migrationSql, withMutant, mutateEachFile, runEntriesDuplicates, runCancellationWithResult });

// SQL（PGliteの意味論）の変異: 関数の本体を壊すと、(c)の検証が失敗する
/**
 * 変異は、ファイルごとに当ててから繋ぎ直す。後のマイグレーションが CREATE OR REPLACE で置き換えた関数は、
 * 繋いだSQLの中に同じ本体が複数回現れる（例: data_health_coverage は089と105）。繋いだ文字列に
 * String.replace を1回当てると最初の1つ（＝古い方）しか壊れず、後から適用される正しい定義に上書きされて、
 * 変異を検知できなくなる。ファイル単位なら、各ファイルの1つ目＝そのファイルの唯一の定義に当たる（BOA-500）
 */
function mutateEachFile(mutate) {
  return MIGRATION_FILES.map((f) => mutate(migrationSqlByFile.get(f))).join(
    "\n",
  );
}
async function sqlMutantFails(label, mutate) {
  const mutated = mutateEachFile(mutate);
  if (mutated === migrationSql)
    throw new Error(`SQLの変異の対象が見つかりません: ${label}`);
  const mdb = new PGlite();
  await mdb.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE races (race_id varchar(20) primary key, race_date date not null, venue_code smallint not null, race_number smallint not null, race_grade text, cancellation_status text, start_time time);
CREATE TABLE race_results (race_id varchar(20) primary key, rank1 smallint, rank2 smallint, rank3 smallint, rank4 smallint, rank5 smallint, rank6 smallint, actual_course_1 smallint, winning_technique text);
CREATE TABLE race_conditions (race_id varchar(20) primary key, race_stage text, race_distance_m smallint, race_labels text[], series_day smallint);
CREATE TABLE race_start_timings (race_id varchar(20), boat_number smallint, start_timing numeric, finish_mark text, finish_rank smallint, primary key (race_id, boat_number));
CREATE TABLE exhibition_data (race_id varchar(20), boat_number smallint, exhibition_time numeric, start_timing numeric, today_weight numeric, primary key (race_id, boat_number));
CREATE TABLE race_odds (race_id varchar(20), captured_at timestamptz, trifecta_all jsonb, trio_all jsonb, exacta_all jsonb, quinella_all jsonb, wide_all jsonb, primary key (race_id, captured_at));
CREATE TABLE race_entries (race_id varchar(20), boat_number smallint, racer_id integer, weight_kg numeric, branch text, f_count smallint, l_count smallint, is_absent boolean, primary key (race_id, boat_number));
CREATE TABLE race_pit_reports (race_id varchar(20) primary key, status text);
CREATE TABLE race_series (venue_code smallint, start_date date, end_date date, primary key (venue_code, start_date));
CREATE TABLE racer_period_stats (racer_id integer, period_year smallint, period_no smallint, primary key (racer_id, period_year, period_no));
CREATE TABLE race_payouts (race_id varchar(20)); CREATE TABLE racer_profiles (racer_id integer); CREATE TABLE racer_series_points (racer_id integer);
CREATE TABLE venue_entry_course_stats (venue_code smallint); CREATE TABLE venue_motor_stats (venue_code smallint); CREATE TABLE external_predictions (race_id varchar(20)); CREATE TABLE race_special_notes (race_id varchar(20));
INSERT INTO races VALUES
 ('2026-09-18-01-01','2026-09-18',1,1,'SG',NULL,'10:00'),
 ('2026-09-18-01-02','2026-09-18',1,2,'SG','confirmed','10:30'),
 ('2026-09-18-03-07','2026-09-18',3,7,'G2',NULL,'14:00'),
 ('2026-09-18-03-06','2026-09-18',3,6,'G1',NULL,'13:30');
INSERT INTO race_results VALUES ('2026-09-18-01-01',1,2,3,4,5,6,1,'逃げ'), ('2026-09-18-01-02',1,2,3,4,5,6,1,'逃げ');
INSERT INTO race_pit_reports VALUES ('2026-09-18-03-07','published');
INSERT INTO race_series VALUES (1,'2026-09-16','2026-09-21');
`);
  await mdb.exec(FRESHNESS_STUB_SQL);
  try {
    await mdb.exec("BEGIN;\n" + mutated + "\nCOMMIT;");
    const cov = (
      await mdb.query(
        `select data_health_coverage('2026-09-18'::date,'2026-09-18'::date) as r`,
      )
    ).rows[0].r[0];
    const pit = (
      await mdb.query(
        `select data_health_pit_reports('2026-09-18'::date,'2026-09-18'::date) as r`,
      )
    ).rows[0].r[0];
    const ser = (
      await mdb.query(
        `select data_health_race_series('2026-09-18'::date,'2026-09-18'::date) as r`,
      )
    ).rows[0].r[0];
    const correct =
      cov.denom === 3 &&
      cov.result === 1 &&
      pit.expected === 2 &&
      pit.with_report === 1 &&
      ser.expected === 2 &&
      ser.covered === 1;
    return !correct;
  } catch {
    return true; // 壊した版が例外で落ちるのも「検証が失敗した」とみなす
  } finally {
    // close しないとPGliteのハンドルが残り、検証が全て成功してもプロセスが
    // 終了しない（CIではタイムアウト扱いになる）
    await mdb.close();
  }
}
// 出走表の複製検知（entries.duplicates）は、独立したPGliteで確かめる
// （複製のための日をまたぐ実データが要り、他の項目の期待件数を乱さないため）。
// 仕込み: 会場1 = 2レースが前日と完全一致（汚染）／会場2 = 1レースだけ一致（同じ節の偶然。正常）／
//         会場3 = 3レース一致だが、複製元の日が確定中止（順延。正常）
async function runEntriesDuplicates(sql) {
  const mdb = new PGlite();
  await mdb.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE scrape_job_state (job text primary key, mode text not null default 'off', last_success_at timestamptz, last_tick_at timestamptz, updated_at timestamptz not null default now());
CREATE TABLE races (race_id varchar(20) primary key, race_date date not null, venue_code smallint not null, race_number smallint not null, race_grade text, cancellation_status text, start_time time);
CREATE TABLE race_results (race_id varchar(20) primary key, rank1 smallint, rank2 smallint, rank3 smallint, rank4 smallint, rank5 smallint, rank6 smallint, actual_course_1 smallint, winning_technique text);
CREATE TABLE race_entries (race_id varchar(20), boat_number smallint, racer_id integer, weight_kg numeric, branch text, f_count smallint, l_count smallint, is_absent boolean, primary key (race_id, boat_number));
`);
  // 会場ごとに3レース×2日。racer_id の並びで「一致／不一致」を作る
  const rows = [];
  const entries = [];
  const results = [];
  const add = (date, venue, race, status, seed, withResult = true) => {
    const id = `${date}-${String(venue).padStart(2, "0")}-${String(race).padStart(2, "0")}`;
    rows.push(
      `('${id}','${date}',${venue},${race},'ippan',${status ? `'${status}'` : "NULL"},'10:00')`,
    );
    for (let b = 1; b <= 6; b++)
      entries.push(`('${id}',${b},${seed * 10 + b},52.0,'東京',0,0,false)`);
    if (withResult) results.push(`('${id}',1,2,3,4,5,6,1,'逃げ')`);
  };
  // 会場1: 05-01 の R1〜R3（seed 11,12,13）→ 05-02 は R1・R2 が同じ seed（汚染）、R3 は別
  for (const [race, seed] of [
    [1, 11],
    [2, 12],
    [3, 13],
  ])
    add("2026-05-01", 1, race, null, seed);
  for (const [race, seed] of [
    [1, 11],
    [2, 12],
    [3, 93],
  ])
    add("2026-05-02", 1, race, null, seed);
  // 会場2: R1 だけ同じ seed（1レースの偶然の一致。汚染ではない）
  for (const [race, seed] of [
    [1, 21],
    [2, 22],
    [3, 23],
  ])
    add("2026-05-01", 2, race, null, seed);
  for (const [race, seed] of [
    [1, 21],
    [2, 82],
    [3, 83],
  ])
    add("2026-05-02", 2, race, null, seed);
  // 会場3: 05-01 が確定中止（順延）→ 05-02 が同じ出走表でも正常。結果はあえて入れ、
  //        確定中止の除外だけが効いていることを確かめる
  for (const [race, seed] of [
    [1, 31],
    [2, 32],
    [3, 33],
  ])
    add("2026-05-01", 3, race, "confirmed", seed);
  for (const [race, seed] of [
    [1, 31],
    [2, 32],
    [3, 33],
  ])
    add("2026-05-02", 3, race, null, seed);
  // 会場4: 05-01 が未確定の順延スタブ（結果なし・cancellation_status も未設定。BOA-421の古い7件と同じ状態）
  //        → 05-02 が同じ出走表でも正常。結果の有無の除外だけが効いていることを確かめる
  for (const [race, seed] of [
    [1, 41],
    [2, 42],
    [3, 43],
  ])
    add("2026-05-01", 4, race, null, seed, false);
  for (const [race, seed] of [
    [1, 41],
    [2, 42],
    [3, 43],
  ])
    add("2026-05-02", 4, race, null, seed);
  await mdb.exec(`INSERT INTO races VALUES ${rows.join(",")};`);
  await mdb.exec(`INSERT INTO race_entries VALUES ${entries.join(",")};`);
  await mdb.exec(`INSERT INTO race_results VALUES ${results.join(",")};`);
  await mdb.exec("BEGIN;\n" + sql + "\nCOMMIT;");
  const r = (
    await mdb.query(
      `select data_health_entries_duplicates('2026-05-02'::date,'2026-05-02'::date) as r`,
    )
  ).rows[0].r;
  return r.find((x) => x.d === "2026-05-02");
}

// ---- 後半の場面（verifyData/data-health-job-scenes-4.js） ----
await runDataHealthJobScenes7({ check, migrationSql, withMutant, mutateEachFile, runEntriesDuplicates, runCancellationWithResult });

// 中止の誤検出（cancellation.with_result、BOA-512）は、独立したPGliteで確かめる。
// 仕込み（2026-09-12）: 1R = 確定中止かつ結果あり（誤検出）／2R = 確定中止・結果なし（本物の中止）／
//   3R = 確定中止・結果の行はあるが rank1 が NULL（中止・返還の行。マイグレーション078）／
//   4R = 中止でない・結果あり／5R = 中止の疑い（tentative）・結果あり（確定ではない）／6R = cancellation_status NULL・結果なし
//   2026-09-13: 確定中止なし（全て一致）
async function runCancellationWithResult(sql) {
  const mdb = new PGlite();
  await mdb.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE scrape_job_state (job text primary key, mode text not null default 'off', last_success_at timestamptz, last_tick_at timestamptz, updated_at timestamptz not null default now());
CREATE TABLE races (race_id varchar(20) primary key, race_date date not null, venue_code smallint not null, race_number smallint not null, cancellation_status text);
CREATE TABLE race_results (race_id varchar(20) primary key, rank1 smallint);
INSERT INTO races VALUES
 ('2026-09-12-10-01','2026-09-12',10,1,'confirmed'),
 ('2026-09-12-10-02','2026-09-12',10,2,'confirmed'),
 ('2026-09-12-10-03','2026-09-12',10,3,'confirmed'),
 ('2026-09-12-10-04','2026-09-12',10,4,NULL),
 ('2026-09-12-10-05','2026-09-12',10,5,'tentative'),
 ('2026-09-12-10-06','2026-09-12',10,6,NULL),
 ('2026-09-13-10-01','2026-09-13',10,1,NULL),
 ('2026-09-13-10-02','2026-09-13',10,2,NULL);
INSERT INTO race_results VALUES
 ('2026-09-12-10-01',1),
 ('2026-09-12-10-03',NULL),
 ('2026-09-12-10-04',2),
 ('2026-09-12-10-05',3),
 ('2026-09-13-10-01',1),
 ('2026-09-13-10-02',4);
`);
  try {
    await mdb.exec("BEGIN;\n" + sql + "\nCOMMIT;");
    return (
      await mdb.query(
        `select data_health_cancellation_with_result('2026-09-12'::date,'2026-09-13'::date) as r`,
      )
    ).rows[0].r;
  } finally {
    await mdb.close();
  }
}

// ---- 後半の場面（verifyData/data-health-job-scenes-4.js・data-health-job-scenes-5.js） ----
await runDataHealthJobScenes8({ check, migrationSql, withMutant, mutateEachFile, runEntriesDuplicates, runCancellationWithResult });
await runDataHealthJobScenes9({ printOut, check, migrationSql, sqlMutantFails, runCancellationWithResult });

if (failures > 0) {
  printErr(`\n${failures}件の検証に失敗しました`);
  process.exit(1);
}

// ---- 後半の場面（verifyData/data-health-job-scenes-5.js） ----
runDataHealthJobScenes10({ printOut, check, migrationSql, sqlMutantFails, runCancellationWithResult });
