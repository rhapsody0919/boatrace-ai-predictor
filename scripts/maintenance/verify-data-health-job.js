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
import {
  COUNT_CHECKS,
  EMPTY_TABLE_POLICIES,
  MORNING_FRESHNESS_CHECKS,
  NIGHTLY_FRESHNESS_CHECKS,
  validateChecks,
} from "../lib/dataHealth/checks.js";
import {
  DATA_HEALTH_FUNCTIONS,
  MAX_RANGE_DAYS,
  MORNING_FRESHNESS_ITEMS,
  NIGHTLY_FRESHNESS_ITEMS,
  TABLE_ROWS_TABLES,
  functionByName,
  renderFunctionDdl,
  renderInlineSql,
  signatureOf,
} from "../lib/dataHealth/functions.js";
import { buildQueries } from "../analysis/data-health-report.js";
import {
  buildCoverageSql,
  literalCoverageSlots,
} from "../lib/dataHealth/coverageSpec.js";
import {
  createRpcCaller,
  runDataHealthChecks,
  runDataHealthJob,
  runDataHealthMorningJob,
} from "../lib/dataHealth/job.js";
import {
  evaluateFreshnessCheck,
  formatBreach,
  formatObserved,
} from "../lib/dataHealth/evaluate.js";
import { runScrapeJob } from "../lib/scrapeJobs/cronWrapper.js";
import { createMemoryStore } from "../lib/scrapeJobs/testing/memoryStore.js";
import { SCRAPE_JOBS, validateRegistry } from "../lib/scrapeJobs/registry.js";
import {
  THRESHOLDS,
  applyDedupe,
  evaluateJobStates,
} from "../lib/scrapeJobs/monitor.js";
import { evaluateDataHealthLiveness } from "./check-scrape-monitor-liveness.js";
import { selectFunctions } from "./render-data-health-functions.js";

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
const show = (v) => JSON.stringify(v);
const near = (a, b) => a !== null && a !== undefined && Math.abs(a - b) < 1e-9;

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
check(
  "登録表: 完了の定義の項目（結果・実進入・決まり手・レース種別・ST・展示・オッズ・全券種・出走表の拡張列・節・期別成績・ピットレポート）が揃う",
  [
    "coverage.result",
    "coverage.rank4_6",
    "coverage.actual_course",
    "coverage.winning_technique",
    "coverage.race_stage",
    "coverage.st_row",
    "coverage.exhibition_time",
    "coverage.odds",
    "coverage.odds_all",
    "pre_race.weight_kg",
    "pre_race.f_count",
    "pre_race.l_count",
    "race_series.covered",
    "racer_period_stats.covered",
    "pit_reports.report",
  ].every((id) => COUNT_CHECKS.some((c) => c.id === id)),
);
check(
  "登録表: race_special_notes は info（0件でも警告しない）、race_series・racer_period_stats は pending（未導入）",
  EMPTY_TABLE_POLICIES.race_special_notes.policy === "info" &&
    EMPTY_TABLE_POLICIES.race_series.policy === "pending" &&
    EMPTY_TABLE_POLICIES.racer_period_stats.policy === "pending",
);
{
  // 分母の定義は data-health-report.js と共有（同じテンプレートから作る）
  const q = buildQueries({
    coverageStart: "2026-09-07",
    windowStart: "2026-09-14",
    endDate: "2026-09-20",
  });
  check(
    "分母の定義の共有: data-health-report.js の coverage SQL は、共有テンプレート（coverageSpec.js）と同一",
    q.coverage ===
      buildCoverageSql(literalCoverageSlots("2026-09-07", "2026-09-20")),
  );
  const fnSql = renderInlineSql(functionByName("data_health_coverage"), {
    from: "2026-09-07",
    to: "2026-09-20",
  });
  check(
    "分母の定義の共有: 関数 data_health_coverage の本体にも、同じ SQL（rank4〜6の完走艇数・全券種オッズ）が入る",
    fnSql.includes(q.coverage) && q.coverage.includes("fin_known"),
  );
}

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
const stripSqlComments = (sql) => sql.replace(/--[^\n]*/g, "");
check(
  "マイグレーション: functions.js の migration が、全て MIGRATION_FILES に載っている（検証から漏れたファイルが無い）",
  DATA_HEALTH_FUNCTIONS.every((f) => MIGRATION_FILES.includes(f.migration)),
);
for (const file of MIGRATION_FILES) {
  const sql = migrationSqlByFile.get(file);
  const num = file.slice(0, 3);
  for (const fn of DATA_HEALTH_FUNCTIONS.filter((f) => f.migration === file)) {
    check(
      `マイグレーション${num}: ${fn.name} のDDLが、functions.js から生成したものと一字一句一致する（手で書き写していない）`,
      sql.includes(renderFunctionDdl(fn)),
    );
  }
  check(
    `マイグレーション${num}: functions.js の migration がこのファイルの関数は、全てファイルに入る（ファイルにあって登録表に無い関数も無い）`,
    (() => {
      const inFile = [
        ...sql.matchAll(/CREATE OR REPLACE FUNCTION (\w+)\(/g),
      ].map((m) => m[1]);
      const registered = DATA_HEALTH_FUNCTIONS.filter(
        (f) => f.migration === file,
      ).map((f) => f.name);
      // 後のマイグレーションが CREATE OR REPLACE で置き換えた関数は、古いファイルにも残る（適用済みの履歴は
      // 書き換えない）。登録表は「今のDDLがあるファイル」を指すので、古い側では「置き換え済み」として除く
      // （例: data_health_coverage は089にもあるが、今のDDLは105。BOA-500）
      const superseded = DATA_HEALTH_FUNCTIONS.filter(
        (f) =>
          f.migration !== file &&
          inFile.includes(f.name) &&
          f.migration.slice(0, 3) > num,
      ).map((f) => f.name);
      const remaining = inFile.filter((n) => !superseded.includes(n));
      return show([...remaining].sort()) === show([...registered].sort());
    })(),
  );
}
for (const fn of DATA_HEALTH_FUNCTIONS) {
  const sig = signatureOf(fn);
  const ddl = renderFunctionDdl(fn);
  check(
    `${fn.name}: PUBLIC・anon・authenticated から EXECUTE を剥奪し、service_role のみに付与する`,
    ddl.includes(
      `REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC, anon, authenticated;`,
    ) &&
      ddl.includes(`GRANT EXECUTE ON FUNCTION ${sig} TO service_role;`) &&
      !/GRANT[^;]*\b(anon|authenticated|PUBLIC)\b/.test(
        ddl.replace(/REVOKE[^;]*;/g, ""),
      ),
  );
  check(
    `${fn.name}: SECURITY INVOKER・STABLE・search_path 固定・statement_timeout・COMMENT がある`,
    /SECURITY INVOKER/.test(ddl) &&
      /\bSTABLE\b/.test(ddl) &&
      /SET search_path = public, pg_temp/.test(ddl) &&
      /SET statement_timeout = '\d+s'/.test(ddl) &&
      ddl.includes(`COMMENT ON FUNCTION ${sig} IS `) &&
      !/SECURITY DEFINER/.test(ddl),
  );
  const bodyOnly = stripSqlComments(
    ddl.slice(
      ddl.indexOf("$data_health$") + 13,
      ddl.lastIndexOf("$data_health$"),
    ),
  );
  const forbidden = bodyOnly.match(
    /\b(insert|update|delete|truncate|drop|alter|create|copy|grant|revoke|execute|perform|set_config|pg_sleep)\b/i,
  );
  check(
    `${fn.name}: 本体に書き込み・DDL・動的SQL・set_config が無い（読み取りの集計のみ）`,
    forbidden === null,
    forbidden?.[0],
  );
  check(
    `${fn.name}: 呼び出し元が渡すSQL文字列の引数が無い（引数は日付のみ）`,
    fn.args.every((a) => a.type === "date"),
  );
}
check(
  "マイグレーション(089・100): verify:migration-rls と同じ規律（anon・authenticated・PUBLIC への GRANT なし）",
  !/GRANT[^;]*\b(anon|authenticated|PUBLIC)\b/i.test(
    stripSqlComments(migrationSql).replace(/REVOKE[^;]*;/g, ""),
  ),
);
{
  let msg = "";
  try {
    selectFunctions(["--migration", MIGRATION_FILE]);
    selectFunctions(["data_health_coverage"]);
    selectFunctions(["no_such_function"]);
  } catch (e) {
    msg = e.message;
  }
  check(
    "DDLの生成CLI: 未登録の関数名は、エラーにする（黙って空を出さない）",
    msg.includes("未登録の関数"),
    msg,
  );
}

// ---------------------------------------------------------------------------
// (c) DB関数の意味論（PGlite）
// ---------------------------------------------------------------------------
let PGlite;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
} catch {
  printErr(
    "@electric-sql/pglite が見つかりません。次を実行してから再実行してください:\n  npm ci（または npm i --no-save @electric-sql/pglite）",
  );
  process.exit(2);
}

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
CREATE TABLE scrape_job_state (job text primary key, mode text not null default 'off');
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

const db = await buildDb();
check(
  "PGlite: マイグレーション089・100を適用でき、再適用しても失敗しない（冪等）",
  true,
);
const q = async (sql, params) => (await db.query(sql, params)).rows;
const call = async (name, ...args) => {
  const placeholders = args.map((_, i) => `$${i + 1}::date`).join(", ");
  const rows = await q(`select ${name}(${placeholders}) as r`, args);
  return rows[0].r;
};

// D1=2026-09-18 の4レース、D2=2026-09-19 の1レース
await db.exec(`
INSERT INTO races VALUES
 ('2026-09-18-01-01','2026-09-18',1,1,'SG',NULL,'10:00'),
 ('2026-09-18-01-02','2026-09-18',1,2,'SG','confirmed','10:30'),
 ('2026-09-18-02-01','2026-09-18',2,1,'ippan',NULL,'10:00'),
 ('2026-09-18-02-02','2026-09-18',2,2,'ippan',NULL,'10:30'),
 ('2026-09-18-03-07','2026-09-18',3,7,'G2',NULL,'14:00'),
 ('2026-09-18-03-08','2026-09-18',3,8,'G1',NULL,'14:30'),
 ('2026-09-18-03-06','2026-09-18',3,6,'G1',NULL,'13:30'),
 ('2026-09-19-01-01','2026-09-19',1,1,'ippan',NULL,'10:00');
-- 1レース目: 6艇が完走し、全項目がそろう
INSERT INTO race_results VALUES ('2026-09-18-01-01',1,2,3,4,5,6,1,'逃げ');
INSERT INTO race_conditions VALUES ('2026-09-18-01-01','予選',1800,'{}',2);
INSERT INTO race_start_timings SELECT '2026-09-18-01-01', g, 0.15, g::text, g FROM generate_series(1,6) g;
INSERT INTO exhibition_data (race_id, boat_number, exhibition_time) SELECT '2026-09-18-01-01', g, 6.70 FROM generate_series(1,6) g;
INSERT INTO race_odds VALUES ('2026-09-18-01-01', now(), '{"1-2-3":1}', '{"1=2=3":1}', '{"1-2":1}', '{"1=2":1}', '{"1=2":1}');
-- 2レース目（確定中止）: 結果・オッズが入っていても、分母・分子に含めない
INSERT INTO race_results VALUES ('2026-09-18-01-02',1,2,3,4,5,6,1,'逃げ');
INSERT INTO race_odds VALUES ('2026-09-18-01-02', now(), '{"1-2-3":1}', '{"1=2=3":1}', '{"1-2":1}', '{"1=2":1}', '{"1=2":1}');
-- 3レース目: 結果はあるが着順4位以降・艇別の着欄が無い（判定不能）
INSERT INTO race_results VALUES ('2026-09-18-02-01',1,2,3,NULL,NULL,NULL,NULL,NULL);
-- 4レース目: 結果なし（欠損）
-- 出走表: 1レース目（6艇。体重は全艇、F数は4艇）・3レース目（6艇。全てNULL）・確定中止の2レース目（数えない）
INSERT INTO race_entries SELECT '2026-09-18-01-01', g, 1000+g, 52.0, '東京', CASE WHEN g<=4 THEN 0 END, 0, false FROM generate_series(1,6) g;
INSERT INTO race_entries SELECT '2026-09-18-02-01', g, 2000+g, NULL, NULL, NULL, NULL, NULL FROM generate_series(1,6) g;
INSERT INTO race_entries SELECT '2026-09-18-01-02', g, 3000+g, 50.0, '東京', 0, 0, false FROM generate_series(1,6) g;
-- ピットレポート: SG全レース(1R)・G2の7R・G1の8R が対象（G1の6Rと一般戦は対象外）。8Rは公開済み、1Rは対象外の表示
INSERT INTO race_pit_reports VALUES ('2026-09-18-03-08','published'), ('2026-09-18-01-01','not_target');
-- 節: 会場1の節だけ取り込み済み。会場2・3は未取り込み
INSERT INTO race_series VALUES (1,'2026-09-16','2026-09-21');
-- 期別成績: 会場1の1レース目の選手のうち1001・1002だけ（1001は2期分）
INSERT INTO racer_period_stats VALUES (1001,2026,1),(1001,2026,2),(1002,2026,2);
`);

{
  const rows = await call("data_health_coverage", "2026-09-18", "2026-09-19");
  const d1 = rows.find((r) => r.d === "2026-09-18");
  check(
    "data_health_coverage: 日別の行が返る（2日分。日付はテキスト）",
    rows.length === 2 &&
      rows[0].d === "2026-09-18" &&
      rows[1].d === "2026-09-19",
    show(rows.map((r) => r.d)),
  );
  check(
    "data_health_coverage: 確定中止のレースを、分母（denom）・分子から外す（結果・オッズが入っていても数えない）",
    d1.total === 7 &&
      d1.excluded === 1 &&
      d1.denom === 6 &&
      d1.result === 2 &&
      d1.odds === 1 &&
      d1.odds_all === 1 &&
      d1.trifecta_all === 1,
    show(d1),
  );
  check(
    "data_health_coverage: rank4〜6は、艇別の着欄で完走艇数を確定したレースは分母に入り（determined）、確定できず欠けがあるレースは判定不能として分母外、結果なしは no_result",
    d1.rank_determined === 1 &&
      d1.rank_denom === 1 &&
      d1.rank4_6 === 1 &&
      d1.rank_undetermined === 1 &&
      d1.rank_no_result === 4,
    show(d1),
  );
}
{
  const rows = await call(
    "data_health_pre_race_fields",
    "2026-09-18",
    "2026-09-19",
  );
  const d1 = rows.find((r) => r.d === "2026-09-18");
  check(
    "data_health_pre_race_fields: 出走行（確定中止を除く）と、体重・F数の取得済み件数、レース条件の距離・ラベル・日目（BOA-510）",
    d1.entries === 12 &&
      d1.weight_kg === 6 &&
      d1.f_count === 4 &&
      d1.l_count === 6 &&
      d1.branch === 6 &&
      d1.is_absent === 6 &&
      d1.races === 6 &&
      d1.race_distance_m === 1 &&
      d1.race_labels === 1 &&
      d1.series_day === 1,
    show(d1),
  );
}
{
  const rows = await call(
    "data_health_pit_reports",
    "2026-09-18",
    "2026-09-19",
  );
  const d1 = rows.find((r) => r.d === "2026-09-18");
  check(
    "data_health_pit_reports: 対象は SG全レース・G1/G2の7R以降（確定中止・G1の6R・一般戦は除く）。行のあるレースと公開済みを数える",
    rows.length === 1 &&
      d1.expected === 3 &&
      d1.with_report === 2 &&
      d1.published === 1,
    show(rows),
  );
}
{
  const rows = await call(
    "data_health_race_series",
    "2026-09-18",
    "2026-09-19",
  );
  const d1 = rows.find((r) => r.d === "2026-09-18");
  const d2 = rows.find((r) => r.d === "2026-09-19");
  check(
    "data_health_race_series: 開催のあった会場×日のうち、節が覆っているものを数える（確定中止のみの会場は含まない）",
    d1.expected === 3 &&
      d1.covered === 1 &&
      d2.expected === 1 &&
      d2.covered === 1,
    show(rows),
  );
}
{
  const rows = await call(
    "data_health_racer_period_stats",
    "2026-09-18",
    "2026-09-19",
  );
  const d1 = rows.find((r) => r.d === "2026-09-18");
  check(
    "data_health_racer_period_stats: 出走した選手（重複なし・確定中止を除く）のうち、成績がある選手を数える（複数期でも1人）",
    d1.expected === 12 && d1.with_stats === 2,
    show(d1),
  );
}
{
  const o = await call("data_health_table_rows");
  check(
    "data_health_table_rows: テーブルごとの行の有無（空のテーブルは false）。登録したテーブルが全て返る",
    o.races === true &&
      o.race_payouts === false &&
      o.race_special_notes === false &&
      TABLE_ROWS_TABLES.every((t) => typeof o[t] === "boolean") &&
      Object.keys(o).length === TABLE_ROWS_TABLES.length,
    show(o),
  );
}
{
  const rows = await call("data_health_monthly_result", "2026-09-30");
  const m = rows.find((r) => r.month === "2026-09");
  check(
    "data_health_monthly_result: 月別（全期間、p_to 以前）の分母（確定中止を除く）と結果あり",
    rows.length === 1 &&
      m.total === 8 &&
      m.excluded === 1 &&
      m.denom === 7 &&
      m.with_result === 2,
    show(rows),
  );
}
{
  const tryCall = async (sql, params) => {
    try {
      await q(sql, params);
      return null;
    } catch (e) {
      return e.message;
    }
  };
  check(
    "引数の検査: 期間が32日を超える・from > to・NULL は、例外にする（範囲の広い読み取りを入口で拒否する）",
    (
      await tryCall(
        `select data_health_coverage('2026-08-01'::date, '2026-09-19'::date)`,
      )
    )?.includes("期間が不正") &&
      (
        await tryCall(
          `select data_health_coverage('2026-09-19'::date, '2026-09-18'::date)`,
        )
      )?.includes("期間が不正") &&
      (
        await tryCall(
          `select data_health_coverage(NULL::date, '2026-09-18'::date)`,
        )
      )?.includes("期間が不正") &&
      (await tryCall(`select data_health_monthly_result(NULL::date)`)) !==
        null &&
      (await tryCall(
        `select data_health_coverage('2026-08-19'::date, '2026-09-19'::date)`,
      )) === null,
  );
  check(
    `引数の検査: 上限は ${MAX_RANGE_DAYS}日（両端を含む）`,
    (await tryCall(
      `select data_health_coverage('2026-08-19'::date, '2026-09-19'::date)`,
    )) === null &&
      (await tryCall(
        `select data_health_coverage('2026-08-18'::date, '2026-09-19'::date)`,
      )) !== null,
  );
  check(
    "SQL文字列を渡せる関数が無い（data_health_ の関数は、全て日付の引数のみ）",
    (
      await q(
        `select proname, pg_get_function_identity_arguments(oid) as args from pg_proc where proname like 'data_health\\_%'`,
      )
    ).every((r) => /^(|p_from date, p_to date|p_to date)$/.test(r.args)),
  );
}
{
  const privileges = await q(`
    select p.proname,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
        has_function_privilege('service_role', p.oid, 'EXECUTE') as service_exec,
        p.prosecdef as definer, p.provolatile as volatility,
        (select count(*) from aclexplode(p.proacl) a where a.grantee = 0)::int as public_grants
    from pg_proc p where p.proname like 'data_health\\_%' order by 1`);
  check(
    "権限: 全関数で anon・authenticated・PUBLIC は EXECUTE 不可、service_role のみ可。SECURITY INVOKER・STABLE",
    privileges.length === DATA_HEALTH_FUNCTIONS.length &&
      privileges.every(
        (p) =>
          p.anon_exec === false &&
          p.auth_exec === false &&
          p.service_exec === true &&
          p.public_grants === 0 &&
          p.definer === false &&
          p.volatility === "s",
      ),
    show(privileges),
  );
}

// ---------------------------------------------------------------------------
// (c2) 鮮度の関数（マイグレーション170）: 夜の集計（p_to=前日）・朝の生成（p_to=当日）
// 既存の検証が使う固定のデータ（2026-09-18 の races 等）を壊さないよう、トランザクションの中で入れて戻す
// ---------------------------------------------------------------------------
{
  await db.exec(`BEGIN;
INSERT INTO outcome_distribution (created_at) VALUES ('2026-09-18 22:00+09');
-- 境界: 前日 21:00 JST ちょうどは ok、1分前は未達
INSERT INTO top_start_stats (created_at) VALUES ('2026-09-18 21:00+09');
INSERT INTO exhibition_time_top_stats (created_at) VALUES ('2026-09-18 20:59+09');
INSERT INTO venue_technique_period_stats VALUES (1, '2026-09-19');
INSERT INTO st_course_baseline VALUES (1, '2026-09-17');
INSERT INTO nige_second_by_course VALUES (1, '2026-09-18');
INSERT INTO accuracy_cache VALUES ('accuracy_summary', '2026-09-19 00:30+09'), ('in_caution_accuracy', '2026-09-19 02:00+09');
INSERT INTO model_performance_daily VALUES ('moriarty', '2026-09-17'), ('unified', '2026-09-18');
INSERT INTO bet_recommendations (race_id, model_id, recommendation) VALUES ('2026-09-18-01-01', 'moriarty', 'bet');
INSERT INTO analogy_v16_snapshots VALUES ('2026-09-18-02-01', 'racecard'), ('2026-09-18-01-01', 'exhibition');
`);
  const night = await call("data_health_nightly_freshness", "2026-09-18");
  const morning = await call("data_health_morning_freshness", "2026-09-18");
  const morningNoRace = await call(
    "data_health_morning_freshness",
    "2026-09-25",
  );
  await db.exec("ROLLBACK;");
  const okOf = (o, k) => o[k]?.ok;
  check(
    "鮮度の関数（夜）: 全ての項目（NIGHTLY_FRESHNESS_ITEMS）と _since（前日 21:00 JST）を返す",
    NIGHTLY_FRESHNESS_ITEMS.every((i) => typeof night[i.key] === "object") &&
      Date.parse(night._since) === Date.parse("2026-09-18T12:00:00Z"),
    show(night),
  );
  check(
    "鮮度の関数（夜）: since は前日 21:00 JST 以降なら ok（ちょうどは ok、1分前は未達）。行が無い表は未達で observed=null",
    okOf(night, "outcome_distribution") === true &&
      okOf(night, "top_start_stats") === true &&
      okOf(night, "exhibition_time_top_stats") === false &&
      okOf(night, "losing_technique_stats") === false &&
      night.losing_technique_stats.observed === null,
    show(night),
  );
  check(
    "鮮度の関数（夜）: accuracy_cache はキーごと（別のキー in_caution_accuracy の更新では ok にならない）",
    okOf(night, "accuracy_summary") === true &&
      okOf(night, "unified_model_accuracy") === false,
    show([night.accuracy_summary, night.unified_model_accuracy]),
  );
  check(
    "鮮度の関数（夜）: date_end は前日まで進んだら ok（window_end 09-17 は未達・09-18 は ok）、date_next は当日の日付で ok",
    okOf(night, "st_course_baseline") === false &&
      okOf(night, "nige_second_by_course") === true &&
      okOf(night, "venue_technique_period_stats") === true,
    show([night.st_course_baseline, night.nige_second_by_course]),
  );
  check(
    "鮮度の関数（夜）: モリアーティの日別成績は moriarty の行だけを見る（unified の 09-18 では ok にならない）。賭けた日なので applicable",
    night.model_performance_daily.applicable === true &&
      okOf(night, "model_performance_daily") === false,
    show(night.model_performance_daily),
  );
  check(
    "鮮度の関数（夜）: 得点率は SG・G1 の4日目以降が無い日（09-18 の SG は2日目）は applicable=false。前日に結果のある日は集計の差分の表も applicable",
    night.racer_series_points.applicable === false &&
      night.racer_aggregated_stats.applicable === true &&
      night.st_course_baseline.applicable === true,
    show([night.racer_series_points, night.racer_aggregated_stats]),
  );
  check(
    "鮮度の関数（朝）: ソナーは当日の中止でないレースの出走表の段だけを数える（展示の段・中止のレースは数えない）",
    morning.sonar_racecard.applicable === true &&
      morning.sonar_racecard.observed === 1 &&
      morning.sonar_racecard.ok === true &&
      morning.poirot_predictions.ok === false &&
      morning.poirot_predictions.observed === 0,
    show(morning),
  );
  check(
    "鮮度の関数（朝）: 当日にレースが無ければ applicable=false（通知しない）",
    MORNING_FRESHNESS_ITEMS.every(
      (i) => morningNoRace[i.key].applicable === false,
    ),
    show(morningNoRace),
  );
  const modes = await q("select job, mode from scrape_job_state order by job");
  check(
    "マイグレーション170: data_health_morning の行を、data_health と同じ mode で足す（再適用しても1行のまま）",
    show(modes) ===
      show([
        { job: "data_health", mode: "live" },
        { job: "data_health_morning", mode: "live" },
      ]),
    show(modes),
  );
}

// 鮮度の判定（純粋関数）
{
  const items = NIGHTLY_FRESHNESS_ITEMS;
  const chk = NIGHTLY_FRESHNESS_CHECKS.find(
    (c) => c.id === "nightly.course_baseline",
  );
  const r = (o) => evaluateFreshnessCheck(chk, o, items);
  const fresh = { applicable: true, ok: true, observed: "2026-09-21" };
  const okRes = r({ st_course_baseline: fresh, nige_second_by_course: fresh });
  const stale = r({
    st_course_baseline: { applicable: true, ok: false, observed: "2026-09-19" },
    nige_second_by_course: fresh,
  });
  const na = r({
    st_course_baseline: { applicable: false, ok: false, observed: null },
    nige_second_by_course: { applicable: false, ok: false, observed: null },
  });
  const missing = r({ st_course_baseline: fresh });
  check(
    "鮮度の判定: 全て ok は ok、1つでも未達は breach（missing=未達の項目数）、全て applicable=false は not_applicable、項目の欠けは error",
    okRes.status === "ok" &&
      stale.status === "breach" &&
      stale.missing === 1 &&
      show(stale.staleItems) === show(["st_course_baseline"]) &&
      na.status === "not_applicable" &&
      missing.status === "error",
    show([okRes, stale, na, missing]),
  );
  check(
    "鮮度の判定: 通知の文に、項目・条件・最終の観測値（JST）を出す",
    formatBreach(stale).includes("st_course_baseline") &&
      formatBreach(stale).includes("前日の分まで進んでいない") &&
      formatBreach(stale).includes("09-19") &&
      formatObserved("2026-09-18T15:32:00+00:00") === "09-19 00:32 JST" &&
      formatObserved(null) === "記録なし" &&
      formatObserved(3) === "3件",
    formatBreach(stale),
  );
  check(
    "登録表: 鮮度の項目は、関数の項目にあるキーだけを参照する（朝は空テーブルを持たない）",
    validateChecks({
      checks: MORNING_FRESHNESS_CHECKS,
      policies: {},
      functions: DATA_HEALTH_FUNCTIONS,
      tableRowsTables: [],
    }).length === 0 &&
      validateChecks({
        checks: [{ ...chk, items: ["no_such_item"], workflow: "x" }],
        policies: {},
        functions: DATA_HEALTH_FUNCTIONS,
        tableRowsTables: [],
      }).length === 2,
  );
}

// 鮮度の実行: 夜は data_health（評価の終端=前日）、朝は data_health_morning（評価の終端=当日・空テーブルを見ない）
{
  const nightStale = Object.fromEntries(
    NIGHTLY_FRESHNESS_ITEMS.map((i) => [
      i.key,
      { applicable: true, ok: false, observed: "2026-10-18T16:00:00+00:00" },
    ]),
  );
  const calls = [];
  const caller = async (fn, args) => {
    calls.push({ name: fn.name, args });
    if (fn.name === "data_health_nightly_freshness") return nightStale;
    if (fn.name === "data_health_table_rows")
      return Object.fromEntries(TABLE_ROWS_TABLES.map((t) => [t, true]));
    if (fn.items) return allFresh(fn.items);
    return [];
  };
  const { report, alerts } = await runDataHealthChecks({
    targetDate: "2026-10-20",
    now: new Date("2026-10-19T21:35:00Z"),
    mode: "live",
    callFunction: caller,
    checks: NIGHTLY_FRESHNESS_CHECKS,
  });
  const nightCall = calls.find(
    (c) => c.name === "data_health_nightly_freshness",
  );
  check(
    "鮮度の実行（夜）: 関数に p_to=前日 を渡し、11本が全て未達なら共通原因の要約を先頭に、11件を通知する（2026-10-20 朝の型）",
    nightCall?.args.p_to === "2026-10-19" &&
      alerts.length === 12 &&
      alerts[0].key === "dh:summary:2026-10-20" &&
      alerts.some((a) => a.key === "dh:nightly.accuracy:2026-10-20"),
    show({ nightCall, n: alerts.length, keys: alerts.map((a) => a.key) }),
  );
  const morningCalls = [];
  const sonarZero = async (fn, args) => {
    morningCalls.push({ name: fn.name, args });
    return {
      sonar_racecard: { applicable: true, ok: false, observed: 0 },
      poirot_predictions: { applicable: true, ok: false, observed: 0 },
      moriarty_recommendations: { applicable: true, ok: false, observed: 0 },
    };
  };
  const out = await runDataHealthMorningJob(
    {
      targetDate: "2026-10-20",
      now: () => new Date("2026-10-19T22:55:00Z"),
      mode: "live",
      state: null,
      client: {},
    },
    { callFunction: sonarZero },
  );
  check(
    "朝のジョブ: 関数を1回だけ p_to=当日 で呼び、空テーブルの関数は呼ばない。ソナーの0件だけ通知し、ポアロ・モリアーティは info（通知しない・last_report に載る）",
    morningCalls.length === 1 &&
      morningCalls[0].name === "data_health_morning_freshness" &&
      morningCalls[0].args.p_to === "2026-10-20" &&
      out.report.alerts.length === 1 &&
      out.report.alerts[0].key === "dh:morning.sonar:2026-10-20" &&
      out.report.checks.filter((c) => c.status === "breach").length === 3,
    show({
      morningCalls,
      alerts: out.report.alerts,
      checks: out.report.checks,
    }),
  );
  const shadow = await runDataHealthMorningJob(
    {
      targetDate: "2026-10-20",
      now: () => new Date("2026-10-19T22:55:00Z"),
      mode: "shadow",
      state: null,
      client: {},
    },
    { callFunction: sonarZero },
  );
  check(
    "朝のジョブ: shadow は通知せず、wouldAlert に残す",
    shadow.report.alerts.length === 0 && shadow.report.wouldAlert.length === 1,
    show(shadow.report),
  );
}

// ---------------------------------------------------------------------------
// (d)(e) 判定・通知の一意性（純粋関数）
// ---------------------------------------------------------------------------
async function evaluateScenarios(evalMod) {
  const results = [];
  const t = (label, pass, detail = "") => results.push({ label, pass, detail });
  const {
    evaluateCountCheck,
    evaluateEmptyTables,
    reconcileAlerts,
    isDueToday,
    commonCauseAlert,
  } = evalMod;
  const base = {
    id: "t.x",
    label: "テスト項目",
    classification: "count",
    severity: "alert",
    fn: "f",
    numerator: "n",
    denominator: "d",
  };
  // 列名: 分子 n・分母 den
  const chk = { ...base, denominator: "den" };
  const rowsOf = (list) => list.map(([d, den, n]) => ({ d, den, n }));
  const END = "2026-09-20";

  // 閾値の境界: 99/100 は達成（<）、98/100 は未達
  {
    const ok = evaluateCountCheck(
      chk,
      rowsOf([
        ["2026-09-19", 100, 99],
        ["2026-09-20", 100, 99],
      ]),
      { end: END },
    );
    const ng = evaluateCountCheck(
      chk,
      rowsOf([
        ["2026-09-19", 100, 98],
        ["2026-09-20", 100, 99],
      ]),
      { end: END },
    );
    t(
      "閾値の境界: ちょうど99%は達成、99%未満は未達",
      ok.status === "ok" && ng.status === "breach",
      show([ok.status, ng.status]),
    );
    t(
      "未達: 欠損数・最も低い日・期間が出る",
      ng.missing === 3 &&
        ng.worst.key === "2026-09-19" &&
        near(ng.worst.rate, 0.98) &&
        ng.from === "2026-09-14" &&
        ng.to === END,
      show(ng),
    );
  }
  // 母数の下限
  {
    const r = evaluateCountCheck(chk, rowsOf([["2026-09-20", 10, 5]]), {
      end: END,
    });
    t(
      "母数の下限: 期待件数が30件未満なら判定しない（未達にしない）",
      r.status === "insufficient",
      show(r),
    );
    const r2 = evaluateCountCheck(
      { ...chk, minDenominator: 5 },
      rowsOf([["2026-09-20", 10, 5]]),
      { end: END },
    );
    t(
      "母数の下限: 項目ごとに変えられる（minDenominator）",
      r2.status === "breach",
      show(r2),
    );
  }
  // 取得開始日
  {
    const rows = rowsOf([
      ["2026-09-15", 100, 0],
      ["2026-09-16", 100, 0],
      ["2026-09-17", 100, 100],
      ["2026-09-18", 100, 100],
    ]);
    const r = evaluateCountCheck({ ...chk, since: "2026-09-17" }, rows, {
      end: END,
    });
    t(
      "取得開始日: それより前の行を分母から外す（取得開始前の欠損を未達にしない）",
      r.status === "ok" && r.denominator === 200 && r.from === "2026-09-17",
      show(r),
    );
    const r2 = evaluateCountCheck({ ...chk, since: "2026-09-22" }, rows, {
      end: END,
    });
    t(
      "取得開始日: 評価の終端より後なら「対象外」（未達にも達成にもしない）",
      r2.status === "not_applicable",
      show(r2),
    );
  }
  // 確定ラグ
  {
    const rows = rowsOf([
      ["2026-09-19", 100, 100],
      ["2026-09-20", 100, 0],
    ]);
    const r = evaluateCountCheck({ ...chk, lagDays: 1 }, rows, { end: END });
    t(
      "確定ラグ: 終端の日（Kファイルの同期前）を評価しない",
      r.status === "ok" && r.to === "2026-09-19" && r.denominator === 100,
      show(r),
    );
    const r0 = evaluateCountCheck(chk, rows, { end: END });
    t("確定ラグなしなら、終端の日も評価する", r0.status === "breach", show(r0));
  }
  // 未導入
  {
    const c = { ...chk, requiresTable: "race_series" };
    const rows = rowsOf([["2026-09-20", 100, 0]]);
    const empty = evaluateCountCheck(c, rows, {
      end: END,
      tableRows: { race_series: false },
    });
    const has = evaluateCountCheck(c, rows, {
      end: END,
      tableRows: { race_series: true },
    });
    t(
      "未導入: テーブルが空の間は「未導入」で警告しない。行が入れば評価する",
      empty.status === "not_introduced" && has.status === "breach",
      show([empty.status, has.status]),
    );
  }
  // 期待件数0
  {
    const r = evaluateCountCheck(chk, rowsOf([["2026-09-20", 0, 0]]), {
      end: END,
    });
    t(
      "期待件数が0件: 対象なし（未達にしない）",
      r.status === "no_target",
      show(r),
    );
  }
  // 月別（行ごと）
  {
    const c = {
      ...chk,
      aggregate: "perRow",
      keyColumn: "month",
      severity: "info",
    };
    const rows = [
      { month: "2026-08", den: 100, n: 99 },
      { month: "2026-09", den: 100, n: 90 },
    ];
    const r = evaluateCountCheck(c, rows, { end: END });
    t(
      "月別: 行ごとに判定し、閾値未満の月を列挙する",
      r.status === "breach" &&
        r.belowRows.length === 1 &&
        r.belowRows[0].key === "2026-09",
      show(r),
    );
  }
  // 空テーブル
  {
    const res = evaluateEmptyTables(
      {
        a: { policy: "forbid" },
        b: { policy: "info" },
        c: { policy: "pending" },
        d: { policy: "forbid" },
        e: { policy: "forbid" },
      },
      { a: false, b: false, c: false, d: true },
    );
    const by = Object.fromEntries(res.map((r) => [r.table, r.status]));
    t(
      "空テーブル: forbid は空を異常、info は情報、pending は未導入、行があれば ok、関数が返さないテーブルは unknown（異常にしない）",
      by.a === "empty" &&
        by.b === "empty_info" &&
        by.c === "not_introduced" &&
        by.d === "ok" &&
        by.e === "unknown",
      show(by),
    );
  }
  // 週次
  {
    const c = { ...chk, cadence: { weeklyOn: 1 } };
    t(
      "週次: 指定の曜日（月曜）にだけ実行する",
      isDueToday(c, "2026-09-21") === true &&
        isDueToday(c, "2026-09-22") === false &&
        isDueToday(chk, "2026-09-22") === true,
    );
  }
  // 通知の一意性
  {
    const now = new Date("2026-09-21T21:35:00Z");
    const b = (missing) => ({ key: "coverage.x", text: "未達", missing });
    const day1 = reconcileAlerts({
      breaches: [b(5)],
      okKeys: new Set(),
      previous: {},
      targetDate: "2026-09-22",
      now,
    });
    t(
      "通知: 初回の未達は通知する。key に対象日、until（有効期限）が付く",
      day1.alerts.length === 1 &&
        day1.alerts[0].key === "dh:coverage.x:2026-09-22" &&
        new Date(day1.alerts[0].until) > now &&
        day1.emitted["coverage.x"].firstAt === "2026-09-22",
      show(day1),
    );
    const day2 = reconcileAlerts({
      breaches: [b(5)],
      okKeys: new Set(),
      previous: day1.emitted,
      targetDate: "2026-09-23",
      now,
    });
    t(
      "通知の一意性: 同じ未達（欠損数が同じ）は、翌日は通知しない",
      day2.alerts.length === 0 &&
        day2.emitted["coverage.x"].lastAt === "2026-09-22",
      show(day2),
    );
    const dec = reconcileAlerts({
      breaches: [b(3)],
      okKeys: new Set(),
      previous: day1.emitted,
      targetDate: "2026-09-23",
      now,
    });
    const worse = reconcileAlerts({
      breaches: [b(4)],
      okKeys: new Set(),
      previous: dec.emitted,
      targetDate: "2026-09-24",
      now,
    });
    t(
      "通知: 欠損が減っても通知しない。減った後に増えたら（悪化）通知する",
      dec.alerts.length === 0 &&
        worse.alerts.length === 1 &&
        worse.alerts[0].text.includes("悪化"),
      show([dec.alerts, worse.alerts]),
    );
    const week = reconcileAlerts({
      breaches: [b(5)],
      okKeys: new Set(),
      previous: day1.emitted,
      targetDate: "2026-09-29",
      now,
    });
    const sixDays = reconcileAlerts({
      breaches: [b(5)],
      okKeys: new Set(),
      previous: day1.emitted,
      targetDate: "2026-09-28",
      now,
    });
    t(
      "通知: 未達が続くときは、7日ごとに再通知する（6日目は通知しない）",
      week.alerts.length === 1 &&
        week.alerts[0].text.includes("継続中") &&
        sixDays.alerts.length === 0,
      show([week.alerts.length, sixDays.alerts.length]),
    );
    const recovered = reconcileAlerts({
      breaches: [],
      okKeys: new Set(["coverage.x"]),
      previous: day1.emitted,
      targetDate: "2026-09-23",
      now,
    });
    const relapse = reconcileAlerts({
      breaches: [b(5)],
      okKeys: new Set(),
      previous: recovered.emitted,
      targetDate: "2026-09-24",
      now,
    });
    t(
      "通知: 回復すると状態を消し、再発は初回として通知する",
      Object.keys(recovered.emitted).length === 0 &&
        relapse.alerts.length === 1,
      show([recovered.emitted, relapse.alerts.length]),
    );
    {
      const key1 = day1.emitted["coverage.x"].alertKey;
      const notDelivered = reconcileAlerts({
        breaches: [b(5)],
        okKeys: new Set(),
        previous: day1.emitted,
        targetDate: "2026-09-23",
        now,
        deliveredKeys: new Set(),
      });
      const delivered = reconcileAlerts({
        breaches: [b(5)],
        okKeys: new Set(),
        previous: day1.emitted,
        targetDate: "2026-09-23",
        now,
        deliveredKeys: new Set([key1]),
      });
      const unknown = reconcileAlerts({
        breaches: [b(5)],
        okKeys: new Set(),
        previous: day1.emitted,
        targetDate: "2026-09-23",
        now,
        deliveredKeys: null,
      });
      const twoDays = reconcileAlerts({
        breaches: [b(5)],
        okKeys: new Set(),
        previous: day1.emitted,
        targetDate: "2026-09-24",
        now,
        deliveredKeys: new Set(),
      });
      t(
        "通知の配信確認: 前日の通知が scrape-monitor の通知済みの記録に無ければ再通知する。あれば通知しない。記録を読めない（null）・2日以上前の通知は判定しない",
        notDelivered.alerts.length === 1 &&
          notDelivered.alerts[0].text.includes("届いていない") &&
          delivered.alerts.length === 0 &&
          unknown.alerts.length === 0 &&
          twoDays.alerts.length === 0,
        show([
          notDelivered.alerts.length,
          delivered.alerts.length,
          unknown.alerts.length,
          twoDays.alerts.length,
        ]),
      );
    }
    const skipped = reconcileAlerts({
      breaches: [],
      okKeys: new Set(),
      previous: day1.emitted,
      targetDate: "2026-09-23",
      now,
    });
    t(
      "通知: 今回実行しなかった・実行できなかった項目の状態は残す（消さない）",
      skipped.emitted["coverage.x"] !== undefined,
      show(skipped),
    );
    const cc = commonCauseAlert({ count: 6, targetDate: "2026-09-22", now });
    t(
      "共通原因の要約: 件数と、共通の原因を疑う文言が入る",
      cc.key === "dh:summary:2026-09-22" &&
        cc.text.includes("6項目") &&
        cc.text.includes("共通"),
      show(cc),
    );
  }
  return results;
}

const evalMod = await import(path.join(LIB, "evaluate.js"));
{
  const results = await evaluateScenarios(evalMod);
  for (const r of results) check(r.label, r.pass, r.detail);
}

// ---------------------------------------------------------------------------
// (f) 実行
// ---------------------------------------------------------------------------
const TARGET = "2026-09-22"; // 評価の終端は 09-21
const NOW = new Date("2026-09-21T21:35:00Z"); // 06:35 JST（09-22）

// 関数の結果（日別の行）を作るヘルパ。全て満たす日を基準にする
const coverageRow = (d, over = {}) => ({
  d,
  total: 100,
  excluded: 0,
  denom: 100,
  result: 100,
  rank_denom: 100,
  rank4_6: 100,
  actual_course: 100,
  winning_technique: 100,
  race_stage: 100,
  st_row: 100,
  st_value: 100,
  exhibition_row: 100,
  exhibition_time: 100,
  odds: 100,
  odds_all: 100,
  trifecta_all: 100,
  trio_all: 100,
  exacta_all: 100,
  quinella_all: 100,
  wide_all: 100,
  ...over,
});
const dates = [
  "2026-09-15",
  "2026-09-16",
  "2026-09-17",
  "2026-09-18",
  "2026-09-19",
  "2026-09-20",
  "2026-09-21",
];
const ALL_TABLES_OK = Object.fromEntries(
  TABLE_ROWS_TABLES.map((t) => [t, true]),
);
/** 鮮度の関数の、全項目が ok の戻り値 */
const allFresh = (items) =>
  Object.fromEntries(
    items.map((i) => [
      i.key,
      { applicable: true, ok: true, observed: "2026-09-21T16:00:00+00:00" },
    ]),
  );
function makeCaller({
  coverage = dates.map((d) => coverageRow(d)),
  tableRows = {
    ...ALL_TABLES_OK,
    race_special_notes: false,
    race_series: false,
    racer_period_stats: false,
  },
  fail = {},
  overrides = {},
} = {}) {
  const calls = [];
  const fn = async (f, args) => {
    calls.push({ name: f.name, args });
    if (fail[f.name]) throw new Error(fail[f.name]);
    if (overrides[f.name]) return overrides[f.name];
    if (f.name === "data_health_coverage") return coverage;
    if (f.name === "data_health_table_rows") return tableRows;
    if (f.items) return allFresh(f.items);
    return [];
  };
  fn.calls = calls;
  return fn;
}

async function scenariosForJob(jobMod) {
  const results = [];
  const t = (label, pass, detail = "") => results.push({ label, pass, detail });
  const { runDataHealthChecks: run } = jobMod;

  // 正常
  {
    const caller = makeCaller();
    const out = await run({
      targetDate: TARGET,
      now: NOW,
      mode: "live",
      callFunction: caller,
    });
    t(
      "正常: 全項目が達成なら、通知は0件。関数は、データセットごとに1回だけ呼ぶ（逐次）",
      out.alerts.length === 0 &&
        out.breaches.length === 0 &&
        new Set(caller.calls.map((c) => c.name)).size === caller.calls.length,
      show(out.report.summary),
    );
    t(
      "正常: 期間は直近7日（終端は対象日の前日）、月別（週次）は火曜には実行しない",
      caller.calls.find((c) => c.name === "data_health_coverage").args
        .p_from === "2026-09-15" &&
        caller.calls.find((c) => c.name === "data_health_coverage").args
          .p_to === "2026-09-21" &&
        !caller.calls.some((c) => c.name === "data_health_monthly_result"),
      show(caller.calls),
    );
    const monday = await run({
      targetDate: "2026-09-28",
      now: NOW,
      mode: "live",
      callFunction: makeCaller(),
    });
    t(
      "週次: 月曜には月別を実行する",
      monday.report.checks.some((c) => c.id === "result.monthly"),
    );
    t(
      "正常: 未導入（節・期別成績）と、取得開始前（出走表の拡張列・ピットレポート）は、警告しない",
      out.report.checks.find((c) => c.id === "race_series.covered").status ===
        "not_introduced" &&
        out.report.checks.find((c) => c.id === "pre_race.weight_kg").status ===
          "not_applicable",
    );
  }
  // 閾値未達
  {
    const rows = dates.map((d) =>
      coverageRow(
        d,
        d === "2026-09-18" ? { exhibition_time: 90, exhibition_row: 90 } : {},
      ),
    );
    const out = await run({
      targetDate: TARGET,
      now: NOW,
      mode: "live",
      callFunction: makeCaller({ coverage: rows }),
    });
    t(
      "閾値未達: 該当の項目だけが通知になる（他の項目は通知しない）",
      out.alerts.length === 2 &&
        out.alerts.every((a) => a.text.includes("展示")) &&
        out.breaches.length === 2,
      show(out.alerts.map((a) => a.text)),
    );
    t(
      "閾値未達: 通知の key は monitor の再通知抑制に使える形（dh:項目:対象日）",
      out.alerts.every((a) =>
        /^dh:coverage\.exhibition_(row|time):2026-09-22$/.test(a.key),
      ),
      show(out.alerts.map((a) => a.key)),
    );
  }
  // 確定ラグ: 終端の日のKファイル由来の欠損は通知しない
  {
    const rows = dates.map((d) =>
      coverageRow(
        d,
        d === "2026-09-21" ? { actual_course: 0, rank4_6: 0 } : {},
      ),
    );
    const out = await run({
      targetDate: TARGET,
      now: NOW,
      mode: "live",
      callFunction: makeCaller({ coverage: rows }),
    });
    t(
      "確定ラグ: 前日分の実進入・着順4位以降（Kファイルの同期前）の欠損は、通知しない",
      out.alerts.length === 0,
      show(out.alerts),
    );
    const rows2 = dates.map((d) =>
      coverageRow(d, d === "2026-09-20" ? { actual_course: 0 } : {}),
    );
    const out2 = await run({
      targetDate: TARGET,
      now: NOW,
      mode: "live",
      callFunction: makeCaller({ coverage: rows2 }),
    });
    t(
      "確定ラグ: 前々日の実進入の欠損は通知する",
      out2.alerts.some((a) => a.text.includes("実進入")),
      show(out2.alerts),
    );
  }
  // 順延日（確定中止に入れれば分母から外れる）と、開催の無い日
  {
    const rows = dates.map((d) =>
      d === "2026-09-21"
        ? coverageRow(d, {
            total: 100,
            excluded: 100,
            denom: 0,
            result: 0,
            rank_denom: 0,
            rank4_6: 0,
            actual_course: 0,
            winning_technique: 0,
            race_stage: 0,
            st_row: 0,
            st_value: 0,
            exhibition_row: 0,
            exhibition_time: 0,
            odds: 0,
            odds_all: 0,
            trifecta_all: 0,
            trio_all: 0,
            exacta_all: 0,
            quinella_all: 0,
            wide_all: 0,
          })
        : coverageRow(d),
    );
    const out = await run({
      targetDate: TARGET,
      now: NOW,
      mode: "live",
      callFunction: makeCaller({ coverage: rows }),
    });
    t(
      "順延日・開催の無い日: 確定中止で分母が0の日は、欠損にしない",
      out.alerts.length === 0,
      show(out.alerts),
    );
  }
  // 空テーブル
  {
    const caller = makeCaller({
      tableRows: {
        ...ALL_TABLES_OK,
        races: false,
        race_special_notes: false,
        race_series: false,
        racer_period_stats: false,
      },
    });
    const out = await run({
      targetDate: TARGET,
      now: NOW,
      mode: "live",
      callFunction: caller,
    });
    t(
      "空テーブル: 空であってはならないテーブル（races）が0件なら通知する。race_special_notes（info）・未導入は通知しない",
      out.alerts.length === 1 &&
        out.alerts[0].text.includes("races") &&
        out.report.emptyTables.some(
          (e) => e.table === "race_special_notes" && e.status === "empty_info",
        ),
      show(out.alerts),
    );
  }
  // 共通原因の要約
  {
    const rows = dates.map((d) =>
      d === "2026-09-21"
        ? coverageRow(d, {
            result: 0,
            winning_technique: 0,
            st_row: 0,
            st_value: 0,
            exhibition_row: 0,
            exhibition_time: 0,
          })
        : coverageRow(d),
    );
    const out = await run({
      targetDate: TARGET,
      now: NOW,
      mode: "live",
      callFunction: makeCaller({ coverage: rows }),
    });
    t(
      "共通原因: 4項目以上が同時に未達なら、先頭に要約の通知が付く",
      out.alerts.length >= 5 && out.alerts[0].key.startsWith("dh:summary:"),
      show(out.alerts.map((a) => a.key)),
    );
  }
  // info の項目: 閾値未満でも通知しない（last_report に載せるだけ）
  //
  // 題材は合成の項目にする。以前は実在の result.monthly を使っていたが、BOA-468で解消して
  // severity を info → alert に上げたところ、**実在の info 項目が0件になり、この検証が
  // 題材ごと消えた**（2026-09-28）。検証したいのは severity の挙動であって特定の項目ではないので、
  // checks を差し替えて、同じ項目の info 版と alert 版を突き合わせる形にした。
  {
    const monthlyCheck = COUNT_CHECKS.find((c) => c.id === "result.monthly");
    const overrides = {
      data_health_monthly_result: [
        { month: "2026-01", denom: 1000, with_result: 800 },
      ],
    };
    const asInfo = await run({
      targetDate: "2026-09-28",
      now: NOW,
      mode: "live",
      checks: [{ ...monthlyCheck, id: "synthetic.info", severity: "info" }],
      callFunction: makeCaller({ overrides }),
    });
    const infoCheck = asInfo.report.checks.find(
      (c) => c.id === "synthetic.info",
    );
    t(
      "info の項目: 閾値未満でも通知しない（last_report に status=breach として載せる）",
      asInfo.alerts.length === 0 &&
        infoCheck.status === "breach" &&
        infoCheck.below.length === 1,
      show(asInfo.report.checks),
    );

    // 対照: 同じ項目・同じデータでも alert なら通知する（info の抑制が「常に通知しない」ではないことの歯）
    const asAlert = await run({
      targetDate: "2026-09-28",
      now: NOW,
      mode: "live",
      checks: [{ ...monthlyCheck, id: "synthetic.alert", severity: "alert" }],
      callFunction: makeCaller({ overrides }),
    });
    t(
      "対照: 同じ未達でも severity が alert なら通知する",
      asAlert.alerts.length === 1 &&
        asAlert.report.checks.find((c) => c.id === "synthetic.alert")
          ?.status === "breach",
      show(asAlert.alerts.map((a) => a.key)),
    );
  }
  // shadow
  {
    const rows = dates.map((d) =>
      coverageRow(d, d === "2026-09-18" ? { odds: 50 } : {}),
    );
    const out = await run({
      targetDate: TARGET,
      now: NOW,
      mode: "shadow",
      callFunction: makeCaller({ coverage: rows }),
      previousEmitted: {
        old: { firstAt: "2026-09-01", lastAt: "2026-09-01", missing: 1 },
      },
    });
    t(
      "shadow: 通知（alerts）は出さず、出すはずだった内容を wouldAlert に残す。通知の状態（emitted）は更新しない",
      out.report.alerts.length === 0 &&
        out.report.wouldAlert.length === 1 &&
        show(out.report.emitted) ===
          show({
            old: { firstAt: "2026-09-01", lastAt: "2026-09-01", missing: 1 },
          }),
      show(out.report),
    );
  }
  // 一部の関数の失敗
  {
    const out = await run({
      targetDate: TARGET,
      now: NOW,
      mode: "live",
      callFunction: makeCaller({
        fail: { data_health_pit_reports: "statement timeout" },
      }),
    });
    t(
      "一部の関数の失敗: 他の項目は判定を続け、失敗した関数は「検査を実行できなかった」通知にする",
      out.alerts.length === 1 &&
        out.alerts[0].text.includes("検査を実行できませんでした") &&
        out.alerts[0].text.includes("statement timeout") &&
        out.report.checks.find((c) => c.id === "coverage.result").status ===
          "ok",
      show(out.alerts),
    );
    const again = await run({
      targetDate: "2026-09-23",
      now: NOW,
      mode: "live",
      callFunction: makeCaller({
        fail: { data_health_pit_reports: "statement timeout" },
      }),
      previousEmitted: out.report.emitted,
    });
    t(
      "一部の関数の失敗: 失敗が続いても、翌日は通知しない（一意性）",
      again.alerts.length === 0,
    );
  }
  // 全ての失敗
  {
    let thrown = null;
    try {
      await run({
        targetDate: TARGET,
        now: NOW,
        mode: "live",
        callFunction: async () => {
          throw new Error("マイグレーション089が未適用");
        },
      });
    } catch (e) {
      thrown = e;
    }
    t(
      "全ての関数が失敗: 成功にせず例外にする（実行の失敗として記録される）",
      thrown !== null &&
        thrown.message.includes("全て失敗") &&
        thrown.message.includes("089"),
      thrown?.message,
    );
  }
  return results;
}

const jobMod = await import(path.join(LIB, "job.js"));
{
  const results = await scenariosForJob(jobMod);
  for (const r of results) check(r.label, r.pass, r.detail);
}

// 共通ラッパ経由
const liveRow = { job: "data_health", mode: "live", consecutive_failures: 0 };
async function wrapperRun({ rows, at = NOW, caller, worker = "verify" }) {
  const store = createMemoryStore({ rows });
  const res = await runScrapeJob({
    job: "data_health",
    run: (ctx) => runDataHealthJob(ctx, { callFunction: caller }),
    store,
    client: {},
    now: () => at,
    worker,
  });
  return { res, store };
}
{
  const badRows = dates.map((d) =>
    coverageRow(d, d === "2026-09-18" ? { odds: 50 } : {}),
  );
  const { res, store } = await wrapperRun({
    rows: { data_health: { ...liveRow } },
    caller: makeCaller({ coverage: badRows }),
  });
  const row = store.state.get("data_health");
  check(
    "共通ラッパ: live で成功し、対象日（06:30指定→当日）を処理済みにして、last_report に結果・通知・状態を残す。rowsWritten は0（データテーブルへ書かない）",
    res.status === 200 &&
      row.last_target_date === TARGET &&
      row.last_report.alerts.length === 1 &&
      row.last_report.emitted["coverage.odds"] !== undefined &&
      row.last_rows_written === 0,
    show(res),
  );
  const second = await wrapperRun({
    rows: { data_health: { ...row } },
    at: new Date("2026-09-21T22:35:00Z"),
    caller: makeCaller({ coverage: badRows }),
  });
  check(
    "共通ラッパ: 補足の起動（07:35 JST）は、処理済みの対象日を再処理しない（冪等・DBを読まない）",
    second.res.body.skipped === "already_done",
    show(second.res.body),
  );
  const nextDay = await wrapperRun({
    rows: { data_health: { ...row } },
    at: new Date("2026-09-22T21:35:00Z"),
    caller: makeCaller({ coverage: badRows }),
  });
  check(
    "共通ラッパ: 翌日の実行で、同じ未達は通知しない（前回の last_report.emitted を引き継ぐ）",
    nextDay.res.status === 200 &&
      nextDay.store.state.get("data_health").last_report.alerts.length === 0 &&
      nextDay.store.state.get("data_health").last_report.emitted[
        "coverage.odds"
      ] !== undefined,
    show(nextDay.res.body),
  );
  const off = await wrapperRun({ rows: {}, caller: makeCaller() });
  check(
    "共通ラッパ: 行が無い（off）間は何もしない（関数を呼ばない）",
    off.res.body.skipped === "mode_off",
    show(off.res.body),
  );
  const failing = await wrapperRun({
    rows: { data_health: { ...liveRow } },
    caller: async () => {
      throw new Error("db down");
    },
  });
  const failedRow = failing.store.state.get("data_health");
  check(
    "共通ラッパ: 全ての関数が失敗したら HTTP 500・連続失敗を記録し、対象日を処理済みにしない（補足の起動が再試行する）",
    failing.res.status === 500 &&
      failedRow.consecutive_failures === 1 &&
      !failedRow.last_target_date &&
      String(failedRow.last_error).includes("全て失敗"),
    show(failing.res.body),
  );
}

// 前日の通知の配信確認（scrape-monitor の通知済みの記録を読む）
{
  const badRows = dates.map((d) =>
    coverageRow(d, d === "2026-09-18" ? { odds: 50 } : {}),
  );
  const first = await wrapperRun({
    rows: { data_health: { ...liveRow } },
    caller: makeCaller({ coverage: badRows }),
  });
  const row = first.store.state.get("data_health");
  const alertKey = row.last_report.emitted["coverage.odds"].alertKey;
  const nextDayAt = new Date("2026-09-22T21:35:00Z");
  const runNext = async (notified) => {
    const store = createMemoryStore({ rows: { data_health: { ...row } } });
    const client = {
      from(table) {
        const q = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({
            data:
              table === "scrape_job_state" && notified !== undefined
                ? { last_report: { notified } }
                : null,
            error: null,
          }),
        };
        return q;
      },
    };
    const res = await runScrapeJob({
      job: "data_health",
      run: (ctx) =>
        runDataHealthJob(ctx, {
          callFunction: makeCaller({ coverage: badRows }),
        }),
      store,
      client,
      now: () => nextDayAt,
      worker: "verify",
    });
    return { res, row: store.state.get("data_health") };
  };
  const undelivered = await runNext({});
  const delivered = await runNext({
    [`report:data_health:${alertKey}`]: "2026-09-21T22:00:30Z",
  });
  const noRecord = await runNext(undefined);
  check(
    "配信確認: 前日の通知が scrape-monitor の通知済みの記録に無ければ、翌日に再通知する。あれば通知しない。記録を読めなければ通知しない",
    undelivered.row.last_report.alerts.length === 1 &&
      undelivered.row.last_report.alerts[0].text.includes("届いていない") &&
      delivered.row.last_report.alerts.length === 0 &&
      noRecord.row.last_report.alerts.length === 0,
    show([
      undelivered.row.last_report.alerts.length,
      delivered.row.last_report.alerts.length,
      noRecord.row.last_report.alerts.length,
    ]),
  );
}

// createRpcCaller（supabase-js の rpc と同じ形 {data, error} を返す最小のクライアント）
{
  const rpcCalls = [];
  const client = {
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      if (name === "data_health_pit_reports")
        return {
          data: null,
          error: {
            code: "PGRST202",
            message:
              "Could not find the function public.data_health_pit_reports",
          },
        };
      if (name === "data_health_race_series")
        return {
          data: null,
          error: {
            code: "57014",
            message: "canceling statement due to statement timeout",
          },
        };
      return { data: [{ d: args.p_from }], error: null };
    },
  };
  const rpc = createRpcCaller(client);
  const ok = await rpc(functionByName("data_health_coverage"), {
    p_from: "2026-09-15",
    p_to: "2026-09-21",
  });
  const errOf = async (name) => {
    try {
      await rpc(functionByName(name), { p_from: "a", p_to: "b" });
      return null;
    } catch (e) {
      return e;
    }
  };
  const missing = await errOf("data_health_pit_reports");
  const timeout = await errOf("data_health_race_series");
  check(
    "RPC呼び出し: 引数（p_from・p_to）を渡し、関数が無い（089の未適用）エラーには原因の案内を付ける。その他のDBエラーは、関数名つきで例外にする",
    ok[0].d === "2026-09-15" &&
      missing?.message.includes("089が未適用") &&
      timeout?.message.includes("data_health_race_series") &&
      timeout.message.includes("statement timeout") &&
      !timeout.message.includes("089が未適用") &&
      rpcCalls.length === 3,
    show([ok, missing?.message, timeout?.message]),
  );
}

// ---------------------------------------------------------------------------
// (g) scrape-monitor との接続
// ---------------------------------------------------------------------------
{
  const badRows = dates.map((d) =>
    coverageRow(d, d === "2026-09-18" ? { odds: 50 } : {}),
  );
  const { store } = await wrapperRun({
    rows: { data_health: { ...liveRow } },
    caller: makeCaller({ coverage: badRows }),
  });
  const row = store.state.get("data_health");
  // scrape-monitor の最初の tick（07:00 JST）と、その後の tick
  const tick1 = new Date("2026-09-21T22:00:30Z");
  const alerts1 = evaluateJobStates([row], tick1).filter(
    (a) => a.kind === "job_report",
  );
  check(
    "monitor: last_report.alerts が、job_report の通知（key に report:data_health:）になる",
    alerts1.length === 1 &&
      alerts1[0].key.startsWith("report:data_health:dh:coverage.odds:") &&
      alerts1[0].text.startsWith("data_health:") &&
      alerts1[0].text.includes("オッズ"),
    show(alerts1),
  );
  const first = applyDedupe(alerts1, {}, tick1);
  const later = new Date("2026-09-21T22:05:30Z");
  const second = applyDedupe(
    evaluateJobStates([row], later).filter((a) => a.kind === "job_report"),
    first.notified,
    later,
  );
  check(
    "monitor: 同じ通知は、次の tick（5分後）で再通知しない",
    first.toSend.length === 1 && second.toSend.length === 0,
  );
  const afterUntil = new Date("2026-09-22T05:00:00Z"); // 14:00 JST。until（起動+4時間）の後
  check(
    "monitor: until（4時間）を過ぎた通知は出さない（6時間おきの再通知が、1日1回の通知を繰り返さない）",
    evaluateJobStates([row], afterUntil).filter((a) => a.kind === "job_report")
      .length === 0,
  );
  const shadowRow = {
    ...row,
    mode: "shadow",
    last_report: { ...row.last_report, alerts: [] },
  };
  check(
    "monitor: shadow の間は、通知は出ない",
    evaluateJobStates([shadowRow], tick1).filter((a) => a.kind === "job_report")
      .length === 0,
  );
  // 日次の期限超過
  const overdue = evaluateJobStates(
    [{ ...liveRow, last_target_date: "2026-09-21" }],
    new Date("2026-09-22T00:31:00Z"),
  ).filter((a) => a.kind === "daily_overdue");
  const notOverdue = evaluateJobStates(
    [{ ...liveRow, last_target_date: "2026-09-21" }],
    new Date("2026-09-21T23:59:00Z"),
  ).filter((a) => a.kind === "daily_overdue");
  check(
    "monitor: 指定時刻（06:30 JST）から3時間（09:30 JST）を過ぎても対象日を処理していなければ、日次の期限超過として通知する",
    overdue.length === 1 &&
      overdue[0].text.includes("data_health") &&
      notOverdue.length === 0 &&
      THRESHOLDS.dailyOverdueHours === 3,
    show(overdue),
  );
}

// ---------------------------------------------------------------------------
// (h) メタ監視
// ---------------------------------------------------------------------------
{
  const NOW_JST_0930 = new Date("2026-09-22T00:30:00Z");
  const done = {
    job: "data_health",
    mode: "live",
    last_target_date: "2026-09-22",
    last_success_at: "2026-09-21T21:35:10Z",
  };
  const stale = { ...done, last_target_date: "2026-09-21" };
  check(
    "メタ監視: live で対象日を処理済みなら正常、未処理なら異常（監視のCron・デプロイ・089の未適用の案内付き）",
    evaluateDataHealthLiveness({ now: NOW_JST_0930, jobStates: [done] })
      .status === "ok" &&
      evaluateDataHealthLiveness({ now: NOW_JST_0930, jobStates: [stale] })
        .status === "alert" &&
      evaluateDataHealthLiveness({
        now: NOW_JST_0930,
        jobStates: [stale],
      }).message.includes("089"),
  );
  check(
    "メタ監視: off・行なしは判定しない。指定時刻から3時間以内・運用窓の外は判定しない",
    evaluateDataHealthLiveness({
      now: NOW_JST_0930,
      jobStates: [{ ...stale, mode: "off" }],
    }).status === "ok" &&
      evaluateDataHealthLiveness({ now: NOW_JST_0930, jobStates: [] })
        .status === "ok" &&
      evaluateDataHealthLiveness({
        now: new Date("2026-09-21T22:30:00Z"),
        jobStates: [stale],
      }).status === "ok" &&
      evaluateDataHealthLiveness({
        now: new Date("2026-09-22T15:30:00Z"),
        jobStates: [stale],
      }).status === "skip",
  );
  check(
    "メタ監視: shadow は、対象日を処理済みにしない設計のため、最終成功の時刻で鮮度を見る",
    evaluateDataHealthLiveness({
      now: NOW_JST_0930,
      jobStates: [
        {
          job: "data_health",
          mode: "shadow",
          last_success_at: "2026-09-21T21:35:10Z",
        },
      ],
    }).status === "ok" &&
      evaluateDataHealthLiveness({
        now: NOW_JST_0930,
        jobStates: [
          {
            job: "data_health",
            mode: "shadow",
            last_success_at: "2026-09-20T21:35:10Z",
          },
        ],
      }).status === "alert",
  );
  const wf = fs.readFileSync(
    path.join(ROOT, ".github/workflows/scrape-monitor-liveness.yml"),
    "utf8",
  );
  const script = fs.readFileSync(
    path.join(ROOT, "scripts/maintenance/check-scrape-monitor-liveness.js"),
    "utf8",
  );
  check(
    "メタ監視: 日次のワークフローが確認スクリプトを呼び、スクリプトが data_health の鮮度を確認して異常時に exit 1、Slack通知の文言に data_health の案内がある",
    wf.includes("check-scrape-monitor-liveness.js") &&
      wf.includes("data_health") &&
      script.includes("evaluateDataHealthLiveness({ now, jobStates: data })") &&
      script.includes("process.exit(1)"),
  );
}

// ---------------------------------------------------------------------------
// (i) 配線
// ---------------------------------------------------------------------------
{
  const def = SCRAPE_JOBS.data_health;
  check(
    "レジストリ: data_health は daily・指定時刻 06:30・hosts なし（取得先に触れない）で、整合性の検査を通る",
    def?.kind === "daily" &&
      def.targetTimeJst === "06:30" &&
      def.hosts.length === 0 &&
      validateRegistry().length === 0,
    show(validateRegistry()),
  );
  const vercel = JSON.parse(
    fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"),
  );
  const cron = vercel.crons.filter((c) => c.path === "/api/cron/data-health");
  const m = /^(\d+) ([\d,-]+) \* \* \*$/.exec(cron[0]?.schedule ?? "");
  // "21-23" のような範囲、または "21,22" の一覧を、UTCの時の配列にする
  const hoursUtc = m
    ? m[2].includes("-")
      ? Array.from(
          {
            length: Number(m[2].split("-")[1]) - Number(m[2].split("-")[0]) + 1,
          },
          (_, k) => Number(m[2].split("-")[0]) + k,
        )
      : m[2].split(",").map(Number)
    : [];
  const jst = hoursUtc.map(
    (h) => `${String((h + 9) % 24).padStart(2, "0")}:${m[1].padStart(2, "0")}`,
  );
  check(
    "vercel.json: data-health は JST 06:35・07:35・08:35（指定時刻 06:30 の後の本番1回と補足2回。オッズの窓・毎分のジョブが動く 07:00 の前に本番）",
    cron.length === 1 && show(jst) === show(["06:35", "07:35", "08:35"]),
    show(cron),
  );
  check(
    "vercel.json: functions が api/cron/*.js を syd1 に固定している（DBと同じリージョン）",
    show(vercel.functions?.["api/cron/*.js"]?.regions) === show(["syd1"]),
  );
  const src = fs.readFileSync(
    path.join(ROOT, "api/cron/data-health.js"),
    "utf8",
  );
  const mod = await import("../../api/cron/data-health.js");
  check(
    "api/cron/data-health.js: maxDuration がレジストリと一致し、ハンドラーをexportする。未認証は401（DBに触れない）",
    new RegExp(`maxDuration: ${def.maxDurationSec}`).test(src) &&
      mod.config.maxDuration === def.maxDurationSec &&
      typeof mod.default === "function",
  );
  let status = null;
  await mod.default(
    { headers: {}, query: {} },
    {
      status(s) {
        status = s;
        return { json() {} };
      },
    },
  );
  check(
    "api/cron/data-health.js: 認証なしのリクエストは401",
    status === 401,
    String(status),
  );
  // 朝の監視 data_health_morning（07:50指定、07:55・08:55 JST）
  const mdef = SCRAPE_JOBS.data_health_morning;
  check(
    "レジストリ: data_health_morning は daily・指定時刻 07:50（龍神ソナーの締め）・hosts なし",
    mdef?.kind === "daily" &&
      mdef.targetTimeJst === "07:50" &&
      mdef.hosts.length === 0,
    show(mdef),
  );
  const mcron = vercel.crons.filter(
    (c) => c.path === "/api/cron/data-health-morning",
  );
  check(
    "vercel.json: data-health-morning は JST 07:55・08:55（締め 07:50 の後の本番1回と補足1回）",
    mcron.length === 1 && mcron[0].schedule === "55 22,23 * * *",
    show(mcron),
  );
  const msrc = fs.readFileSync(
    path.join(ROOT, "api/cron/data-health-morning.js"),
    "utf8",
  );
  const mmod = await import("../../api/cron/data-health-morning.js");
  let mstatus = null;
  await mmod.default(
    { headers: {}, query: {} },
    {
      status(s) {
        mstatus = s;
        return { json() {} };
      },
    },
  );
  check(
    "api/cron/data-health-morning.js: maxDuration がレジストリと一致し、job='data_health_morning' で runDataHealthMorningJob を呼ぶ。未認証は401",
    new RegExp(`maxDuration: ${mdef.maxDurationSec}`).test(msrc) &&
      mmod.config.maxDuration === mdef.maxDurationSec &&
      msrc.includes('job: "data_health_morning"') &&
      msrc.includes("runDataHealthMorningJob") &&
      mstatus === 401,
    String(mstatus),
  );
  check(
    "非DB: job.js は書き込みのAPI（insert・update・upsert・delete）を持たない（書き込みは共通ラッパの last_report のみ）",
    !/\.(insert|update|upsert|delete)\(/.test(
      fs.readFileSync(path.join(LIB, "job.js"), "utf8"),
    ),
  );
}

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

const evalMutants = [
  [
    "閾値の比較を < から <= にする（ちょうど閾値も未達）",
    [['rate < threshold ? "breach"', 'rate <= threshold ? "breach"']],
  ],
  [
    "取得開始日を無視する",
    [["if (check.since && check.since > from) from = check.since;", ""]],
  ],
  [
    "確定ラグを無視する",
    [["to = addDaysToDateString(end, -(check.lagDays ?? 0));", "to = end;"]],
  ],
  [
    "母数の下限を無視する",
    [["if (denominator < minDenominator) {", "if (false) {"]],
  ],
  [
    "未導入の判定を外す",
    [
      [
        "if (!tableRows || tableRows[check.requiresTable] !== true) {",
        "if (false) {",
      ],
    ],
  ],
  [
    "pending を空テーブルの異常として扱う",
    [
      [
        'if (p.policy === "pending") return { ...base, status: "not_introduced" };',
        'if (p.policy === "pending") return { ...base, status: "empty" };',
      ],
    ],
  ],
  [
    "悪化の判定を外す（欠損が増えても通知しない）",
    [
      [
        "const worsened = prev !== undefined && b.missing > prev.missing;",
        "const worsened = false;",
      ],
    ],
  ],
  [
    "毎回通知する（状態を見ない）",
    [
      [
        "if (prev === undefined || worsened || remind || undelivered) {",
        "if (true) {",
      ],
    ],
  ],
  [
    "継続中の再通知をしない",
    [["daysBetween(prev.lastAt, targetDate) >= REMIND_DAYS", "false"]],
  ],
  [
    "回復しても状態を消さない",
    [["if (!okKeys.has(key)) emitted[key] = state;", "emitted[key] = state;"]],
  ],
  [
    "前日の通知が届いていなくても再通知しない（配信確認を外す）",
    [["!deliveredKeys.has(prev.alertKey)", "false"]],
  ],
  [
    "週次の曜日を無視する",
    [
      [
        "return weekdayOf(targetDate) === check.cadence.weeklyOn;",
        "return true;",
      ],
    ],
  ],
];
for (const [label, reps] of evalMutants) {
  const failed = await withMutant("evaluate.js", reps, async (mod) => {
    try {
      return (await evaluateScenarios(mod)).filter((r) => !r.pass);
    } catch (e) {
      return [{ label: `例外: ${e.message}` }];
    }
  });
  check(
    `変異検証（判定・通知の一意性）: ${label}`,
    failed.length > 0,
    "この変異を検知できない（検証が通ってしまう）",
  );
}

const jobMutants = [
  [
    "shadow でも通知を出す",
    [['alerts: mode === "live" ? alerts : [],', "alerts,"]],
  ],
  [
    "shadow でも状態（emitted）を更新する",
    [['emitted: mode === "live" ? emitted : previousEmitted,', "emitted,"]],
  ],
  [
    "全ての関数が失敗しても成功にする",
    [["if (Object.keys(errors).length === attempted) {", "if (false) {"]],
  ],
  [
    "info の項目も通知する",
    [
      [
        'if (r.status === "breach" && r.severity === "alert") {',
        'if (r.status === "breach") {',
      ],
    ],
  ],
  [
    "失敗した関数の検査を通知しない",
    [
      [
        "if (errors[name]) {\n      breaches.push({",
        "if (false) {\n      breaches.push({",
      ],
    ],
  ],
  ["空テーブルを通知しない", [['if (r.status === "empty") {', "if (false) {"]]],
  [
    "共通原因の要約を付けない",
    [
      [
        "breaches.length >= COMMON_CAUSE_MIN_BREACHES && reconciled.length > 0",
        "false",
      ],
    ],
  ],
];
for (const [label, reps] of jobMutants) {
  const failed = await withMutant("job.js", reps, async (mod) => {
    try {
      return (await scenariosForJob(mod)).filter((r) => !r.pass);
    } catch (e) {
      return [{ label: `例外: ${e.message}` }];
    }
  });
  check(
    `変異検証（実行）: ${label}`,
    failed.length > 0,
    "この変異を検知できない（検証が通ってしまう）",
  );
}

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
CREATE TABLE scrape_job_state (job text primary key, mode text not null default 'off');
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
{
  const d = await runEntriesDuplicates(migrationSql);
  check(
    "data_health_entries_duplicates: 2レース以上が過去日と完全一致する会場×日だけを汚染と数える（1レースの偶然の一致・確定中止の複製元・結果の無い複製元は数えない）",
    d.venue_days === 4 && d.clean_venue_days === 3,
    show(d),
  );
}
for (const [label, mutate] of [
  [
    "出走表の複製検知: 1レースの一致でも汚染として数える",
    (x) => x.replace("having count(*) >= 2", "having count(*) >= 1"),
  ],
  [
    "出走表の複製検知: 複製元の確定中止（順延）を除外しない",
    (x) =>
      x.replace(
        "where r.race_date between (p_from - 21) and p_to\n    and r.cancellation_status is distinct from 'confirmed'",
        "where r.race_date between (p_from - 21) and p_to",
      ),
  ],
  [
    "出走表の複製検知: 複製元に結果があることを求めない",
    (x) => x.replace("and b.sig = a.sig and b.has_result", "and b.sig = a.sig"),
  ],
]) {
  const mutated = mutateEachFile(mutate);
  if (mutated === migrationSql)
    throw new Error(`SQLの変異の対象が見つかりません: ${label}`);
  let detected = false;
  try {
    const d = await runEntriesDuplicates(mutated);
    detected = !(d.venue_days === 4 && d.clean_venue_days === 3);
  } catch {
    detected = true;
  }
  check(
    `変異検証（SQL）: ${label}`,
    detected,
    "この変異を検知できない（検証が通ってしまう）",
  );
}

// 中止の誤検出（cancellation.with_result、BOA-512）は、独立したPGliteで確かめる。
// 仕込み（2026-09-12）: 1R = 確定中止かつ結果あり（誤検出）／2R = 確定中止・結果なし（本物の中止）／
//   3R = 確定中止・結果の行はあるが rank1 が NULL（中止・返還の行。マイグレーション078）／
//   4R = 中止でない・結果あり／5R = 中止の疑い（tentative）・結果あり（確定ではない）／6R = cancellation_status NULL・結果なし
//   2026-09-13: 確定中止なし（全て一致）
async function runCancellationWithResult(sql) {
  const mdb = new PGlite();
  await mdb.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE scrape_job_state (job text primary key, mode text not null default 'off');
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
// jsonb はキーの順を並べ替えるため、列ごとの値で比べる
const cancellationWithResultOk = (r) =>
  show(
    (r ?? []).map((x) => [
      x.d,
      x.races,
      x.confirmed_with_result,
      x.consistent_races,
    ]),
  ) ===
  show([
    ["2026-09-12", 6, 1, 5],
    ["2026-09-13", 2, 0, 2],
  ]);
{
  const r = await runCancellationWithResult(migrationSql);
  check(
    "data_health_cancellation_with_result: 確定中止かつ rank1 のある結果だけを誤検出と数える（本物の中止・rank1 が NULL の返還の行・tentative・中止でないレースは数えない）。分母は全レース",
    cancellationWithResultOk(r),
    show(r),
  );
  const { evaluateCountCheck } = evalMod;
  const chk = COUNT_CHECKS.find((c) => c.id === "cancellation.with_result");
  const breach = evaluateCountCheck(chk, r, { end: "2026-09-13" });
  const clean = evaluateCountCheck(chk, r.slice(1), { end: "2026-09-13" });
  check(
    "cancellation.with_result: 誤検出が1件でもあれば未達（閾値100%・母数の下限1）、0件なら正常",
    chk?.severity === "alert" &&
      chk.days === 14 &&
      breach.status === "breach" &&
      breach.missing === 1 &&
      breach.worst?.key === "2026-09-12" &&
      clean.status === "ok",
    show({ breach, clean }),
  );
}
for (const [label, mutate] of [
  [
    "中止の誤検出: rank1 を見ず、結果の行があれば数える（返還の行を誤検出にする）",
    (x) =>
      x.replaceAll(
        "r.cancellation_status = 'confirmed' and rr.rank1 is not null",
        "r.cancellation_status = 'confirmed' and rr.race_id is not null",
      ),
  ],
  [
    "中止の誤検出: tentative も数える",
    (x) =>
      x.replaceAll(
        "r.cancellation_status = 'confirmed' and rr.rank1 is not null",
        "r.cancellation_status is not null and rr.rank1 is not null",
      ),
  ],
  [
    "中止の誤検出: 否定の論理式で一致を数える（cancellation_status が NULL の行を取りこぼす）",
    (x) =>
      x.replace(
        "count(*) - count(*) filter (where r.cancellation_status = 'confirmed' and rr.rank1 is not null) as consistent_races",
        "count(*) filter (where not (r.cancellation_status = 'confirmed' and rr.rank1 is not null)) as consistent_races",
      ),
  ],
]) {
  const mutated = mutate(migrationSql);
  if (mutated === migrationSql)
    throw new Error(`SQLの変異の対象が見つかりません: ${label}`);
  let detected = false;
  try {
    detected = !cancellationWithResultOk(
      await runCancellationWithResult(mutated),
    );
  } catch {
    detected = true;
  }
  check(
    `変異検証（SQL）: ${label}`,
    detected,
    "この変異を検知できない（検証が通ってしまう）",
  );
}

const sqlMutants = [
  [
    "確定中止の除外を外す（分母）",
    (s) =>
      s.replace(
        "(r.cancellation_status is distinct from 'confirmed') as active",
        "true as active",
      ),
  ],
  [
    "ピットレポートの対象を、G1・G2の7R以降から全レースにする",
    (s) => s.replace("r.race_number >= 7", "r.race_number >= 1"),
  ],
  [
    "ピットレポートの確定中止の除外を外す",
    (s) =>
      s.replace(
        /(from races r\nleft join race_pit_reports p on p\.race_id = r\.race_id\nwhere r\.race_date between p_from and p_to\n) {2}and r\.cancellation_status is distinct from 'confirmed'\n/,
        "$1",
      ),
  ],
  [
    "節の照合を、開始日のみの一致にする",
    (s) =>
      s.replace(
        "r.race_date between s.start_date and s.end_date",
        "r.race_date = s.start_date",
      ),
  ],
];
for (const [label, mutate] of sqlMutants) {
  check(
    `変異検証（SQL）: ${label}`,
    await sqlMutantFails(label, mutate),
    "この変異を検知できない（検証が通ってしまう）",
  );
}

await db.close();

if (failures > 0) {
  printErr(`\n${failures}件の検証に失敗しました`);
  process.exit(1);
}
printOut("\n全ての検証に成功");
