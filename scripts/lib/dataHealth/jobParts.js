/**
 * job.js（runDataHealthChecks）の部品。関数の呼び出し計画・項目の判定・通知の候補・報告の組み立てを、
 * 複雑さ・行数の関所の内に収めるために分けた。DBに触れない（関数の呼び出しは job.js の殻が行う）。
 * 出力・例外の文・評価の順は、分ける前と同じ。
 */
import { DEFAULT_DAYS } from "./checks.js";
import {
  COMMON_CAUSE_MIN_BREACHES,
  commonCauseAlert,
  evaluateCountCheck,
  evaluateFreshnessCheck,
  formatBreach,
} from "./evaluate.js";

export const TABLE_ROWS_FN = "data_health_table_rows";

/**
 * 関数ごとの呼び出しの期間: その関数を使う項目のうち、最も長い days。
 * 空テーブルの検査（data_health_table_rows）は、空テーブルの扱いか requiresTable があるときだけ呼ぶ。
 * @returns {Map<string, number>}
 */
export function planFunctionRanges(dueChecks, policies) {
  const rangeByFn = new Map();
  for (const c of dueChecks) {
    const days = c.days ?? DEFAULT_DAYS;
    const cur = rangeByFn.get(c.fn) ?? 0;
    rangeByFn.set(c.fn, Math.max(cur, days));
  }
  if (
    Object.keys(policies).length > 0 ||
    dueChecks.some((c) => c.requiresTable)
  ) {
    rangeByFn.set(TABLE_ROWS_FN, rangeByFn.get(TABLE_ROWS_FN) ?? 1);
  }
  return rangeByFn;
}

/** 全ての関数が失敗したら（089の未適用・DB障害）、成功にせず例外にする */
export function assertSomeSucceeded(errors, attempted) {
  if (Object.keys(errors).length === attempted) {
    const first = Object.entries(errors)[0];
    throw new Error(
      `データ健全性の関数が全て失敗しました（${attempted}件）。最初のエラー: ${first[1]}`,
    );
  }
}

const errorResult = (check, detail) => ({
  id: check.id,
  label: check.label,
  severity: check.severity,
  status: "error",
  detail,
});

/** 登録表の1項目の判定。関数が失敗していれば error */
export function judgeCheck(check, { errors, tableRows, results, findFn, end }) {
  if (errors[check.fn]) return errorResult(check, errors[check.fn]);
  if (check.requiresTable && !tableRows) {
    return errorResult(
      check,
      `${TABLE_ROWS_FN} が失敗したため、未導入かを判定できません`,
    );
  }
  if (check.classification === "freshness") {
    return evaluateFreshnessCheck(
      check,
      results.get(check.fn) ?? null,
      findFn(check.fn)?.items ?? [],
    );
  }
  return evaluateCountCheck(check, results.get(check.fn) ?? [], {
    end,
    tableRows,
  });
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
export function collectBreaches({
  checkResults,
  emptyResults,
  fnNames,
  errors,
}) {
  const { breaches, okKeys } = breachesOfChecks(checkResults);
  addEmptyTableBreaches(emptyResults, breaches, okKeys);
  addFunctionErrorBreaches(fnNames, errors, breaches, okKeys);
  return { breaches, okKeys };
}

/** 同時に多数の項目が未達なら、共通原因の要約を先頭に付ける */
export function withCommonCause({ breaches, reconciled, targetDate, now }) {
  return breaches.length >= COMMON_CAUSE_MIN_BREACHES && reconciled.length > 0
    ? [
        commonCauseAlert({ count: breaches.length, targetDate, now }),
        ...reconciled,
      ]
    : reconciled;
}

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

/** 項目の状態ごとの件数 */
function countStatuses(checkResults) {
  const statusCounts = {};
  for (const r of checkResults) {
    statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
  }
  return statusCounts;
}

/** last_report に入れる報告。shadow は通知を出さず（出すはずだった内容を wouldAlert に残す）、状態も更新しない */
export function buildReport({
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
