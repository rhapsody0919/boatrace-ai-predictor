/**
 * verify-data-health-job.js の後半の場面（1/5）。verify ではない。
 * 判定と期待値は分ける前の verify-data-health-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  DATA_HEALTH_FUNCTIONS,
  renderFunctionDdl,
  signatureOf,
  TABLE_ROWS_TABLES,
} from "../../lib/dataHealth/functions.js";
import { selectFunctions } from "../render-data-health-functions.js";
import { show } from "./data-health-job-fixtures.js";

let check, MIGRATION_FILES, MIGRATION_FILE, migrationSqlByFile, migrationSql, stripSqlComments, buildDb;
export let db;

export const q = async (sql, params) => (await db.query(sql, params)).rows;

export const call = async (name, ...args) => {
  const placeholders = args.map((_, i) => `$${i + 1}::date`).join(", ");
  const rows = await q(`select ${name}(${placeholders}) as r`, args);
  return rows[0].r;
};

function scene1() {
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
}

function scene2() {
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・MIGRATION_FILES・MIGRATION_FILE・migrationSqlByFile・migrationSql・stripSqlComments・buildDb） */
export function runDataHealthJobScenes1(env) {
  ({ check, MIGRATION_FILES, MIGRATION_FILE, migrationSqlByFile, migrationSql, stripSqlComments, buildDb } = env);
  scene1();
  scene2();
}

async function scene3() {
  db = await buildDb();
  check(
    "PGlite: マイグレーション089・100を適用でき、再適用しても失敗しない（冪等）",
    true,
  );
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
}

async function scene4() {
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
}

async function scene5() {
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・MIGRATION_FILES・MIGRATION_FILE・migrationSqlByFile・migrationSql・stripSqlComments・buildDb） */
export async function runDataHealthJobScenes2(env) {
  ({ check, MIGRATION_FILES, MIGRATION_FILE, migrationSqlByFile, migrationSql, stripSqlComments, buildDb } = env);
  await scene3();
  await scene4();
  await scene5();
}
