/**
 * verify-data-health-job.js の後半の場面（2/5）。verify ではない。
 * 判定と期待値は分ける前の verify-data-health-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  NIGHTLY_FRESHNESS_CHECKS,
  validateChecks,
  MORNING_FRESHNESS_CHECKS,
} from "../../lib/dataHealth/checks.js";
import {
  MAX_RANGE_DAYS,
  DATA_HEALTH_FUNCTIONS,
  NIGHTLY_FRESHNESS_ITEMS,
  MORNING_FRESHNESS_ITEMS,
} from "../../lib/dataHealth/functions.js";
import { runDataHealthChecks } from "../../lib/dataHealth/job.js";
import { formatBreach, formatObserved, evaluateFreshnessCheck } from "../../lib/dataHealth/evaluate.js";
import { show } from "./data-health-job-fixtures.js";
import { q, db, call } from "./data-health-job-scenes-1.js";

let check, migrationSqlByFile;

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene1() {
  await db.exec(`BEGIN;
  INSERT INTO outcome_distribution (created_at) VALUES ('2026-09-18 22:00+09');
  -- 境界: 前日 21:00 JST ちょうどは ok、1分前は未達
  INSERT INTO top_start_stats (created_at) VALUES ('2026-09-18 21:00+09');
  INSERT INTO exhibition_time_top_stats (created_at) VALUES ('2026-09-18 20:59+09');
  INSERT INTO venue_technique_period_stats VALUES (1, '2026-09-19');
  INSERT INTO st_course_baseline VALUES (1, '2026-09-16');
  INSERT INTO nige_second_by_course VALUES (1, '2026-09-17');
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
    "鮮度の関数（夜）: コース基準は前々日まで進んだら ok（Kファイルの同期が翌朝のため。window_end 09-16 は未達・09-17 は ok）、date_next は当日の日付で ok",
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
    "鮮度の関数（夜）: Search Console の日別は行が無ければ未達で observed=null",
    okOf(night, "growth_gsc_daily") === false &&
      night.growth_gsc_daily.observed === null,
    show(night.growth_gsc_daily),
  );
  // 境界: p_to=09-18、lagDays=3 なので 09-15 は ok、09-14 は未達。observed は実際の max(date)（ずれを足さない）
  const gscAt = async (d) => {
    await db.exec(`BEGIN; INSERT INTO growth_gsc_daily (date) VALUES ('${d}');`);
    const n = await call("data_health_nightly_freshness", "2026-09-18");
    await db.exec("ROLLBACK;");
    return n.growth_gsc_daily;
  };
  const gscOk = await gscAt("2026-09-15");
  const gscStale = await gscAt("2026-09-14");
  check(
    "鮮度の関数（夜）: Search Console の日別は評価の終端の3日前まで進んだら ok（09-15 は ok・09-14 は未達）、observed は実際の最終日",
    gscOk.ok === true &&
      gscStale.ok === false &&
      String(gscOk.observed).startsWith("2026-09-15"),
    show([gscOk, gscStale]),
  );
  return { morning, morningNoRace };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene2({ morning, morningNoRace }) {
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

async function scene3() {
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
  {
    const s1 = await scene1();
    await scene2(s1);
  }
}

async function scene4() {
  // マイグレーション170 の行の扱い（system-architect P1-a の再現）: 共通ラッパが先に作った off の行は上書きし、
  // 手で変えた行・一度でも動いた行は変えない
  {
    const mig170 = migrationSqlByFile.get("170_data_health_freshness.sql");
    const insert = mig170.slice(mig170.indexOf("INSERT INTO scrape_job_state"));
    const modeAfter = async (row) => {
      await db.exec(`BEGIN;
  DELETE FROM scrape_job_state WHERE job = 'data_health_morning';
  ${row ? `INSERT INTO scrape_job_state (job, mode, last_tick_at) VALUES ('data_health_morning', '${row.mode}', ${row.tick ? "now()" : "NULL"});` : ""}
  ${insert}`);
      const r = await q(
        "select mode from scrape_job_state where job = 'data_health_morning'",
      );
      await db.exec("ROLLBACK;");
      return r[0]?.mode;
    };
    const created = await modeAfter({ mode: "off", tick: false });
    const manual = await modeAfter({ mode: "shadow", tick: false });
    const ticked = await modeAfter({ mode: "off", tick: true });
    const none = await modeAfter(null);
    check(
      "マイグレーション170: 共通ラッパが作っただけの off の行は data_health の mode に上書き、手で shadow にした行・動いたことのある行は変えない、行が無ければ作る",
      created === "live" &&
        manual === "shadow" &&
        ticked === "off" &&
        none === "live",
      show({ created, manual, ticked, none }),
    );
  }
  // 鮮度の未達は毎日通知する（system-architect P1-b・/code-review の再現）。件数の未達は今までどおり翌日は黙る
  {
    const chk = NIGHTLY_FRESHNESS_CHECKS.find(
      (c) => c.id === "nightly.outcome_distribution",
    );
    const stale = {
      outcome_distribution: { applicable: true, ok: false, observed: null },
    };
    const run = (targetDate, previousEmitted, result = stale) =>
      runDataHealthChecks({
        targetDate,
        now: new Date(`${targetDate}T06:35:00+09:00`),
        mode: "live",
        callFunction: async () => result,
        previousEmitted,
        checks: [chk],
        policies: {},
      });
    const d1 = await run("2026-10-20", {});
    const d2 = await run("2026-10-21", d1.report.emitted);
    const d2again = await run("2026-10-21", d2.report.emitted);
    check(
      "鮮度の未達: 2晩続けて落ちたら2晩目も通知する（同じ対象日の2回目の実行は通知しない）",
      d1.alerts.length === 1 &&
        d2.alerts.length === 1 &&
        d2.alerts[0].key === "dh:nightly.outcome_distribution:2026-10-21" &&
        d2again.alerts.length === 0,
      show([d1.alerts, d2.alerts, d2again.alerts]),
    );
    const broken = await run("2026-10-20", {}, { _since: "x" });
    check(
      "鮮度の項目を判定できない（関数の結果に項目が無い）ときは、黙らず「検査を実行できませんでした」を通知する",
      broken.alerts.length === 1 &&
        broken.alerts[0].key ===
          "dh:error.nightly.outcome_distribution:2026-10-20" &&
        broken.alerts[0].text.includes("検査を実行できませんでした"),
      show(broken.alerts),
    );
  }
}

function scene5() {
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
        formatBreach(stale).includes("前々日の分まで進んでいない") &&
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・migrationSqlByFile） */
export async function runDataHealthJobScenes3(env) {
  ({ check, migrationSqlByFile } = env);
  await scene3();
  await scene4();
  scene5();
}
