/**
 * verify-data-health-job.js - 汎用の日次監視 data_health（完了の定義C。scripts/lib/dataHealth/・
 * api/cron/data-health.js・マイグレーション089）の検証。本番DB・Slackには接続しない。
 *
 * 確認すること:
 *   (a) 登録表の整合性（関数の実在・閾値・除外の宣言・空テーブルの扱い）
 *   (b) マイグレーション089: functions.js から生成したDDLとの一致（二重実装のずれの検知）、REVOKE・GRANT の内容、
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
  validateChecks,
} from "../lib/dataHealth/checks.js";
import {
  DATA_HEALTH_FUNCTIONS,
  MAX_RANGE_DAYS,
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
import { createRpcCaller, runDataHealthJob } from "../lib/dataHealth/job.js";
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
// (b) マイグレーション089
// ---------------------------------------------------------------------------
const MIGRATION_FILE = "089_data_health_functions.sql";
const migrationSql = fs.readFileSync(
  path.join(ROOT, "docs/db-migration", MIGRATION_FILE),
  "utf8",
);
const stripSqlComments = (sql) => sql.replace(/--[^\n]*/g, "");
for (const fn of DATA_HEALTH_FUNCTIONS.filter(
  (f) => f.migration === MIGRATION_FILE,
)) {
  check(
    `マイグレーション089: ${fn.name} のDDLが、functions.js から生成したものと一字一句一致する（手で書き写していない）`,
    migrationSql.includes(renderFunctionDdl(fn)),
  );
}
check(
  "マイグレーション089: functions.js の migration が089の関数は、全てファイルに入る（ファイルにあって登録表に無い関数も無い）",
  (() => {
    const inFile = [
      ...migrationSql.matchAll(/CREATE OR REPLACE FUNCTION (\w+)\(/g),
    ].map((m) => m[1]);
    const registered = DATA_HEALTH_FUNCTIONS.filter(
      (f) => f.migration === MIGRATION_FILE,
    ).map((f) => f.name);
    return show([...inFile].sort()) === show([...registered].sort());
  })(),
);
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
  "マイグレーション089: verify:migration-rls と同じ規律（anon・authenticated・PUBLIC への GRANT なし）",
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

async function buildDb() {
  const db = new PGlite();
  await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE races (race_id varchar(20) primary key, race_date date not null, venue_code smallint not null, race_number smallint not null, race_grade text, cancellation_status text, start_time time);
CREATE TABLE race_results (race_id varchar(20) primary key, rank1 smallint, rank2 smallint, rank3 smallint, rank4 smallint, rank5 smallint, rank6 smallint, actual_course_1 smallint, winning_technique text);
CREATE TABLE race_conditions (race_id varchar(20) primary key, race_stage text, race_distance_m smallint, race_labels text[]);
CREATE TABLE race_start_timings (race_id varchar(20), boat_number smallint, start_timing numeric, finish_mark text, finish_rank smallint, primary key (race_id, boat_number));
CREATE TABLE exhibition_data (race_id varchar(20), boat_number smallint, exhibition_time numeric, primary key (race_id, boat_number));
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
  await db.exec("BEGIN;\n" + migrationSql + "\nCOMMIT;");
  // 冪等（再適用しても失敗しない）
  await db.exec("BEGIN;\n" + migrationSql + "\nCOMMIT;");
  return db;
}

const db = await buildDb();
check(
  "PGlite: マイグレーション089を適用でき、再適用しても失敗しない（冪等）",
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
INSERT INTO race_conditions VALUES ('2026-09-18-01-01','予選',1800,'{}');
INSERT INTO race_start_timings SELECT '2026-09-18-01-01', g, 0.15, g::text, g FROM generate_series(1,6) g;
INSERT INTO exhibition_data SELECT '2026-09-18-01-01', g, 6.70 FROM generate_series(1,6) g;
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
    "data_health_pre_race_fields: 出走行（確定中止を除く）と、体重・F数の取得済み件数、レース条件の距離・ラベル",
    d1.entries === 12 &&
      d1.weight_kg === 6 &&
      d1.f_count === 4 &&
      d1.l_count === 6 &&
      d1.branch === 6 &&
      d1.is_absent === 6 &&
      d1.races === 6 &&
      d1.race_distance_m === 1 &&
      d1.race_labels === 1,
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
  // info の項目（月別の結果充足率）: 閾値未満でも通知しない（last_report に載せるだけ）
  {
    const out = await run({
      targetDate: "2026-09-28",
      now: NOW,
      mode: "live",
      callFunction: makeCaller({
        overrides: {
          data_health_monthly_result: [
            { month: "2026-01", denom: 1000, with_result: 800 },
          ],
        },
      }),
    });
    const monthly = out.report.checks.find((c) => c.id === "result.monthly");
    t(
      "info の項目: 閾値未満でも通知しない（last_report に status=breach として載せる）",
      out.alerts.length === 0 &&
        monthly.status === "breach" &&
        monthly.below.length === 1,
      show(out.report.checks.filter((c) => c.id === "result.monthly")),
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
    `${fileName.replace(/\.js$/, "")}.mutant-${process.pid}.tmp.mjs`,
  );
  fs.writeFileSync(tmpFile, mutated);
  try {
    return await run(await import(`${tmpFile}?t=${Date.now()}`));
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
async function sqlMutantFails(label, mutate) {
  const mutated = mutate(migrationSql);
  if (mutated === migrationSql)
    throw new Error(`SQLの変異の対象が見つかりません: ${label}`);
  const mdb = new PGlite();
  await mdb.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE races (race_id varchar(20) primary key, race_date date not null, venue_code smallint not null, race_number smallint not null, race_grade text, cancellation_status text, start_time time);
CREATE TABLE race_results (race_id varchar(20) primary key, rank1 smallint, rank2 smallint, rank3 smallint, rank4 smallint, rank5 smallint, rank6 smallint, actual_course_1 smallint, winning_technique text);
CREATE TABLE race_conditions (race_id varchar(20) primary key, race_stage text, race_distance_m smallint, race_labels text[]);
CREATE TABLE race_start_timings (race_id varchar(20), boat_number smallint, start_timing numeric, finish_mark text, finish_rank smallint, primary key (race_id, boat_number));
CREATE TABLE exhibition_data (race_id varchar(20), boat_number smallint, exhibition_time numeric, primary key (race_id, boat_number));
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
