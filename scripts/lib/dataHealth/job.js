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
import { COUNT_CHECKS, DEFAULT_DAYS, EMPTY_TABLE_POLICIES } from "./checks.js";
import {
  COMMON_CAUSE_MIN_BREACHES,
  commonCauseAlert,
  evaluateCountCheck,
  evaluateEmptyTables,
  formatBreach,
  isDueToday,
  periodFor,
  reconcileAlerts,
} from "./evaluate.js";
import { DATA_HEALTH_FUNCTIONS } from "./functions.js";

export const DATA_HEALTH_JOB = "data_health";
const TABLE_ROWS_FN = "data_health_table_rows";

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

/** scrape-monitor の通知済みの記録の、この監視の通知の key の接頭辞（monitor.js: `report:${job}:${alert.key}`） */
const MONITOR_KEY_PREFIX = `report:${DATA_HEALTH_JOB}:`;

/**
 * scrape-monitor が「通知済み」として記録している、この監視の通知の key（dh:項目:対象日）を読む（読み取りのみ）。
 * 前日の通知が届いたかの確認に使う。記録を読めない（行が無い・DBエラー）ときは null（判定しない）。
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @returns {Promise<Set<string>|null>}
 */
export async function readDeliveredKeys(client) {
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
        .filter((k) => k.startsWith(MONITOR_KEY_PREFIX))
        .map((k) => k.slice(MONITOR_KEY_PREFIX.length)),
    );
  } catch {
    return null;
  }
}

/** 関数に渡す引数（p_from・p_to のうち、その関数が持つもの） */
function argsFor(fn, { start, end }) {
  const all = { p_from: start, p_to: end };
  return Object.fromEntries(fn.args.map((a) => [a.name, all[a.name]]));
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
}) {
  const findFn = (name) => functions.find((f) => f.name === name);
  const dueChecks = checks.filter((c) => isDueToday(c, targetDate));
  const end = periodFor(targetDate, 1).end;

  // 関数ごとの呼び出しの期間: その関数を使う項目のうち、最も長い days
  const rangeByFn = new Map();
  for (const c of dueChecks) {
    const days = c.days ?? DEFAULT_DAYS;
    const cur = rangeByFn.get(c.fn) ?? 0;
    rangeByFn.set(c.fn, Math.max(cur, days));
  }
  rangeByFn.set(TABLE_ROWS_FN, rangeByFn.get(TABLE_ROWS_FN) ?? 1);

  // 逐次実行（並列にしない。Disk IO予算への配慮）。失敗した関数は errors に残し、他の関数は続ける
  const results = new Map();
  const errors = {};
  for (const [name, days] of rangeByFn) {
    const fn = findFn(name);
    if (!fn) {
      errors[name] = `関数が登録されていません: ${name}`;
      continue;
    }
    try {
      const start = addDaysToDateString(end, -(days - 1));
      results.set(name, await callFunction(fn, argsFor(fn, { start, end })));
    } catch (error) {
      // last_report を肥大させない（関数ごとに300字まで）
      errors[name] = String(error.message).slice(0, 300);
    }
  }
  const attempted = rangeByFn.size;
  if (Object.keys(errors).length === attempted) {
    // 全て失敗（089の未適用・DB障害）: 成功にしない
    const first = Object.entries(errors)[0];
    throw new Error(
      `データ健全性の関数が全て失敗しました（${attempted}件）。最初のエラー: ${first[1]}`,
    );
  }

  // data_health_table_rows の戻り値は { テーブル名: 1行以上あるか } のオブジェクト
  const tableRows = results.get(TABLE_ROWS_FN) ?? null;

  // 項目の判定
  const checkResults = dueChecks.map((check) => {
    if (errors[check.fn]) {
      return {
        id: check.id,
        label: check.label,
        severity: check.severity,
        status: "error",
        detail: errors[check.fn],
      };
    }
    if (check.requiresTable && !tableRows) {
      return {
        id: check.id,
        label: check.label,
        severity: check.severity,
        status: "error",
        detail: `${TABLE_ROWS_FN} が失敗したため、未導入かを判定できません`,
      };
    }
    return evaluateCountCheck(check, results.get(check.fn) ?? [], {
      end,
      tableRows,
    });
  });
  const emptyResults = tableRows
    ? evaluateEmptyTables(policies, tableRows)
    : [];

  // 通知の候補と、未達でないと確認できた項目
  const breaches = [];
  const okKeys = new Set();
  for (const r of checkResults) {
    if (r.status === "breach" && r.severity === "alert") {
      breaches.push({
        key: r.id,
        text: `データ健全性 ${formatBreach(r)}`,
        missing: r.missing ?? 0,
      });
    } else if (r.status !== "error") {
      okKeys.add(r.id);
    }
  }
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
  for (const name of rangeByFn.keys()) {
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

  const { alerts: reconciled, emitted } = reconcileAlerts({
    breaches,
    okKeys,
    previous: previousEmitted,
    targetDate,
    now,
    deliveredKeys,
  });
  const alerts =
    breaches.length >= COMMON_CAUSE_MIN_BREACHES && reconciled.length > 0
      ? [
          commonCauseAlert({ count: breaches.length, targetDate, now }),
          ...reconciled,
        ]
      : reconciled;

  const compact = (r) => ({
    id: r.id,
    status: r.status,
    ...(r.rate !== undefined && r.rate !== null
      ? { rate: Math.round(r.rate * 10000) / 10000 }
      : {}),
    ...(r.numerator !== undefined
      ? { num: r.numerator, den: r.denominator }
      : {}),
    ...(r.detail ? { detail: r.detail } : {}),
    ...(r.belowRows ? { below: r.belowRows.slice(0, 12) } : {}),
  });
  const statusCounts = {};
  for (const r of checkResults) {
    statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
  }

  const report = {
    targetDate,
    period: { end },
    mode,
    generatedAt: now.toISOString(),
    summary: { ...statusCounts, breaches: breaches.length },
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

  return { report, breaches, alerts, errors };
}

/**
 * 共通ラッパの run(ctx)。
 * @param {Object} ctx cronWrapper.js の ctx（client・mode・targetDate・now・state）
 * @param {{callFunction?: Function}} [deps]
 */
export async function runDataHealthJob(ctx, deps = {}) {
  const targetDate = ctx.targetDate;
  if (!targetDate)
    throw new Error("対象日を解決できません（ctx.targetDate がありません）");
  const callFunction = deps.callFunction ?? createRpcCaller(ctx.client);
  const previousEmitted = ctx.state?.last_report?.emitted ?? {};
  // 前日に通知した項目があるときだけ、その通知が scrape-monitor に届いたかを確認する（読み取り1回）
  const deliveredKeys =
    ctx.mode === "live" && Object.keys(previousEmitted).length > 0
      ? await (deps.readDeliveredKeys ?? readDeliveredKeys)(ctx.client)
      : null;
  const { report, breaches, alerts, errors } = await runDataHealthChecks({
    targetDate,
    now: ctx.now(),
    mode: ctx.mode,
    callFunction,
    previousEmitted,
    deliveredKeys,
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
}
