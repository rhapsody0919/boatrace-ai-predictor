/**
 * 汎用の日次監視 data_health（完了の定義C）の実行。api/cron/data-health.js が、共通ラッパ
 * （scripts/lib/scrapeJobs/cronWrapper.js）の run に渡す。
 *
 * 動き:
 *   1. 対象日（指定時刻 06:30 JST から解決）の前日を終端に、登録表（checks.js）の項目を、DBの関数
 *      （functions.js。固定のSQL）の結果から判定する。関数は、データセットごとに1回だけ呼ぶ（逐次。並列にしない）
 *   2. 閾値未達・0件のテーブルを、通知の候補にする。通知の一意性（同じ未達を毎日通知しない）は、状態
 *      （last_report.emitted）で保つ。
 *   3. 通知は last_report.alerts に入れる。scrape-monitor（monitor.js）が拾い、既存のSlack通知に流す
 *      （通知先・重複抑制・上限の経路は、monitor.js と共通）。
 *
 * 書き込みは、共通ラッパが行う scrape_job_state の last_report（結果・通知・状態）だけ。データテーブルへは書かない。
 *
 * モード（scrape_job_state.mode の job='data_health'。DBの更新のみで切り替える）:
 *   off（または行なし）  何もしない
 *   shadow              判定と last_report への記録のみ。通知（alerts）は出さず、出すはずだった内容を wouldAlert に残す
 *                       （ノイズの有無を、live化の前に確認するため）。通知の状態（emitted）は更新しない
 *   live                通知を出す
 *
 * 監視自体の失敗:
 *   - 全ての関数が失敗（マイグレーション089の未適用・DB障害）→ 実行の失敗（recordFailure。補足のcron起動が再試行し、
 *     3時間処理されなければ monitor の daily_overdue が通知する）
 *   - 一部の関数だけ失敗 → 成功した項目は判定・通知し、失敗した関数は「検査を実行できなかった」通知にする
 */
import { addDaysToDateString } from "../dateUtils.js";
import {
  COUNT_CHECKS,
  EMPTY_TABLE_POLICIES,
  MORNING_FRESHNESS_CHECKS,
} from "./checks.js";
import {
  COMMON_CAUSE_MIN_BREACHES,
  commonCauseAlert,
  evaluateEmptyTables,
  formatBreach,
  isDueToday,
  reconcileAlerts,
} from "./evaluate.js";
import { DATA_HEALTH_FUNCTIONS } from "./functions.js";
import {
  TABLE_ROWS_FN,
  callFunctions,
  compact,
  countStatuses,
  judgeCheck,
  planFunctionRanges,
} from "./jobParts.js";

export const DATA_HEALTH_JOB = "data_health";
/**
 * 朝の生成（龍神ソナー等、締め 07:50）を見るジョブ。data_health は live では 06:35 の成功で対象日を済みにするため、
 * 07:50 の締めは別の状態の行で見る（checks.js の MORNING_FRESHNESS_CHECKS）。評価の終端は当日。空テーブルは見ない
 */
export const DATA_HEALTH_MORNING_JOB = "data_health_morning";

/** PostgREST が「関数が無い」と返すエラー（マイグレーション089の未適用） */
export const isFunctionMissingError = (error) =>
  error?.code === "PGRST202" ||
  error?.code === "42883" ||
  /Could not find the function|function .* does not exist/i.test(
    error?.message ?? "",
  );

/**
 * supabase-js の rpc で関数を呼ぶ（Vercel Function）。失敗は、意味のあるメッセージを付けた例外にする。
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 */
export function createRpcCaller(client) {
  return async (fn, args) => {
    const { data, error } = await client.rpc(fn.name, args);
    if (error) {
      const hint = isFunctionMissingError(error)
        ? "（マイグレーション089が未適用の可能性があります）"
        : "";
      const e = new Error(
        `${fn.name} の呼び出しに失敗しました: ${error.message}${hint}`,
      );
      e.cause = error;
      e.code = error.code;
      throw e;
    }
    return data;
  };
}

/**
 * scrape-monitor が「通知済み」として記録している、この監視の通知の key（dh:項目:対象日）を読む（読み取りのみ）。
 * 前日の通知が届いたかの確認に使う。記録を読めない（行が無い・DBエラー）ときは null（判定しない）。
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @returns {Promise<Set<string>|null>}
 */
export async function readDeliveredKeys(client, job = DATA_HEALTH_JOB) {
  // scrape-monitor の通知済みの記録の、この監視の通知の key の接頭辞（monitor.js: `report:${job}:${alert.key}`）
  const prefix = `report:${job}:`;
  try {
    const { data, error } = await client
      .from("scrape_job_state")
      .select("last_report")
      .eq("job", "scrape-monitor")
      .maybeSingle();
    if (error || !data) return null;
    const notified = data.last_report?.notified ?? {};
    return new Set(
      Object.keys(notified)
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length)),
    );
  } catch {
    return null;
  }
}

/** 全ての関数が失敗したら（089の未適用・DB障害）、成功にせず例外にする */
function assertSomeSucceeded(errors, attempted) {
  if (Object.keys(errors).length === attempted) {
    const first = Object.entries(errors)[0];
    throw new Error(
      `データ健全性の関数が全て失敗しました（${attempted}件）。最初のエラー: ${first[1]}`,
    );
  }
}

/** 項目の判定から、通知の候補と、未達でないと確認できた項目 */
function breachesOfChecks(checkResults) {
  const breaches = [];
  const okKeys = new Set();
  for (const r of checkResults) {
    if (r.status === "breach" && r.severity === "alert") {
      breaches.push({
        key: r.id,
        text: `データ健全性 ${formatBreach(r)}`,
        missing: r.missing ?? 0,
        // 鮮度の未達は日ごとに別の事故（2晩続けて落ちたら2晩目も知らせる）。件数の充足率と違い、毎日通知する
        ...(r.staleItems ? { everyDay: true } : {}),
      });
    } else if (r.status !== "error") {
      okKeys.add(r.id);
    }
    // 鮮度の項目を判定できなかった（関数の結果に項目が無い＝本番の関数の版が古い等）。last_report に載せるだけだと
    // 見張りが黙って止まるので、「検査を実行できなかった」として通知する
    if (r.alertOnError && r.severity === "alert") {
      if (r.status === "error") {
        breaches.push({
          key: `error.${r.id}`,
          text: `データ健全性の検査を実行できませんでした: ${r.label}: ${r.detail}`,
          missing: 1,
        });
      } else {
        okKeys.add(`error.${r.id}`);
      }
    }
  }
  return { breaches, okKeys };
}

/** 空テーブルの判定から、通知の候補を breaches・okKeys に足す */
function addEmptyTableBreaches(emptyResults, breaches, okKeys) {
  for (const r of emptyResults) {
    const key = `empty.${r.table}`;
    if (r.status === "empty") {
      breaches.push({
        key,
        text: `データ健全性 0件のテーブル: ${r.table}（この表は空であってはならない）`,
        missing: 1,
      });
    } else if (r.status !== "unknown") {
      okKeys.add(key);
    }
  }
}

/** 呼び出した関数ごとの失敗から、通知の候補を breaches・okKeys に足す */
function addFunctionErrorBreaches(fnNames, errors, breaches, okKeys) {
  for (const name of fnNames) {
    const key = `error.${name}`;
    if (errors[name]) {
      breaches.push({
        key,
        text: `データ健全性の検査を実行できませんでした: ${errors[name]}`,
        // 実行できない状態が続いても、毎日は通知しない（悪化=増加は無い）
        missing: 1,
      });
    } else {
      okKeys.add(key);
    }
  }
}

/** 通知の候補（breaches）と、未達でないと確認できた項目（okKeys）。項目・空テーブル・関数の失敗の順 */
function collectBreaches({ checkResults, emptyResults, fnNames, errors }) {
  const { breaches, okKeys } = breachesOfChecks(checkResults);
  addEmptyTableBreaches(emptyResults, breaches, okKeys);
  addFunctionErrorBreaches(fnNames, errors, breaches, okKeys);
  return { breaches, okKeys };
}

/** 同時に多数の項目が未達なら、共通原因の要約を先頭に付ける */
function withCommonCause({ breaches, reconciled, targetDate, now }) {
  return breaches.length >= COMMON_CAUSE_MIN_BREACHES && reconciled.length > 0
    ? [
        commonCauseAlert({ count: breaches.length, targetDate, now }),
        ...reconciled,
      ]
    : reconciled;
}

/** last_report に入れる報告。shadow は通知を出さず（出すはずだった内容を wouldAlert に残す）、状態も更新しない */
function buildReport({
  targetDate,
  end,
  mode,
  now,
  checkResults,
  emptyResults,
  breaches,
  errors,
  alerts,
  emitted,
  previousEmitted,
}) {
  return {
    targetDate,
    period: { end },
    mode,
    generatedAt: now.toISOString(),
    summary: { ...countStatuses(checkResults), breaches: breaches.length },
    checks: checkResults.map(compact),
    emptyTables: emptyResults
      .filter((r) => r.status !== "ok")
      .map(({ table, status, policy, note }) => ({
        table,
        status,
        policy,
        ...(note ? { note } : {}),
      })),
    errors,
    // shadow は通知を出さない（ノイズを確認するため、出すはずだった内容を残す）。状態も更新しない
    alerts: mode === "live" ? alerts : [],
    ...(mode === "live" ? {} : { wouldAlert: alerts.map((a) => a.text) }),
    emitted: mode === "live" ? emitted : previousEmitted,
  };
}
/**
 * 判定を実行する（HTTP・DBの型に依存しない。テスト・手元のCLIもこれを呼ぶ）。
 *
 * @param {Object} input
 * @param {string} input.targetDate 対象日（JST。評価の終端はその前日）
 * @param {Date} input.now
 * @param {"shadow"|"live"} input.mode
 * @param {(fn: import("./functions.js").DataHealthFunction, args: Record<string, string>) => Promise<unknown>} input.callFunction
 * @param {Record<string, {firstAt: string, lastAt: string, missing: number, alertKey?: string}>} [input.previousEmitted]
 * @param {Set<string>|null} [input.deliveredKeys] scrape-monitor の通知済みの記録（前日の通知が届いたかの確認。null なら確認しない）
 * @param {ReadonlyArray<import("./checks.js").CountCheck>} [input.checks]
 * @param {Record<string, {policy: string}>} [input.policies]
 * @param {ReadonlyArray<import("./functions.js").DataHealthFunction>} [input.functions]
 * @param {number} [input.endOffsetDays] 評価の終端 = 対象日 − この日数（既定1=前日。朝のジョブは0=当日）
 */
export async function runDataHealthChecks({
  targetDate,
  now,
  mode,
  callFunction,
  previousEmitted = {},
  deliveredKeys = null,
  checks = COUNT_CHECKS,
  policies = EMPTY_TABLE_POLICIES,
  functions = DATA_HEALTH_FUNCTIONS,
  endOffsetDays = 1,
}) {
  const findFn = (name) => functions.find((f) => f.name === name);
  const dueChecks = checks.filter((c) => isDueToday(c, targetDate));
  const end = addDaysToDateString(targetDate, -endOffsetDays);

  const rangeByFn = planFunctionRanges(dueChecks, policies);
  const { results, errors } = await callFunctions(rangeByFn, {
    findFn,
    callFunction,
    end,
  });
  assertSomeSucceeded(errors, rangeByFn.size);

  // data_health_table_rows の戻り値は { テーブル名: 1行以上あるか } のオブジェクト
  const tableRows = results.get(TABLE_ROWS_FN) ?? null;

  const checkResults = dueChecks.map((check) =>
    judgeCheck(check, { errors, tableRows, results, findFn, end }),
  );
  const emptyResults = tableRows
    ? evaluateEmptyTables(policies, tableRows)
    : [];

  const { breaches, okKeys } = collectBreaches({
    checkResults,
    emptyResults,
    fnNames: rangeByFn.keys(),
    errors,
  });
  const { alerts: reconciled, emitted } = reconcileAlerts({
    breaches,
    okKeys,
    previous: previousEmitted,
    targetDate,
    now,
    deliveredKeys,
  });
  const alerts = withCommonCause({ breaches, reconciled, targetDate, now });
  const report = buildReport({
    targetDate,
    end,
    mode,
    now,
    checkResults,
    emptyResults,
    breaches,
    errors,
    alerts,
    emitted,
    previousEmitted,
  });

  return { report, breaches, alerts, errors };
}

/**
 * 共通ラッパの run(ctx) を作る（data_health・data_health_morning が共有する）。
 * @param {{job: string, options?: Object}} spec options は runDataHealthChecks に渡す（checks・policies・endOffsetDays）
 */
function createDataHealthRun({ job, options = {} }) {
  /**
   * @param {Object} ctx cronWrapper.js の ctx（client・mode・targetDate・now・state）
   * @param {{callFunction?: Function, readDeliveredKeys?: Function}} [deps]
   */
  return async (ctx, deps = {}) => {
    const targetDate = ctx.targetDate;
    if (!targetDate)
      throw new Error("対象日を解決できません（ctx.targetDate がありません）");
    const callFunction = deps.callFunction ?? createRpcCaller(ctx.client);
    const previousEmitted = ctx.state?.last_report?.emitted ?? {};
    // 前日に通知した項目があるときだけ、その通知が scrape-monitor に届いたかを確認する（読み取り1回）
    const deliveredKeys =
      ctx.mode === "live" && Object.keys(previousEmitted).length > 0
        ? await (deps.readDeliveredKeys ?? readDeliveredKeys)(ctx.client, job)
        : null;
    const { report, breaches, alerts, errors } = await runDataHealthChecks({
      targetDate,
      now: ctx.now(),
      mode: ctx.mode,
      callFunction,
      previousEmitted,
      deliveredKeys,
      ...options,
    });
    return {
      rowsWritten: 0,
      report,
      body: {
        period: report.period,
        summary: report.summary,
        breaches: breaches.length,
        alerts: alerts.length,
        errors: Object.keys(errors),
      },
    };
  };
}

/** data_health（06:30指定）の run(ctx)。api/cron/data-health.js */
export const runDataHealthJob = createDataHealthRun({ job: DATA_HEALTH_JOB });

/** data_health_morning（07:50指定）の run(ctx)。api/cron/data-health-morning.js。評価の終端は当日、空テーブルは見ない */
export const runDataHealthMorningJob = createDataHealthRun({
  job: DATA_HEALTH_MORNING_JOB,
  options: {
    checks: MORNING_FRESHNESS_CHECKS,
    policies: {},
    endOffsetDays: 0,
  },
});
