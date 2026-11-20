/**
 * job.js（runDataHealthChecks）の部品。関数の呼び出し計画・項目の判定・通知の候補・報告の組み立てを、
 * 複雑さ・行数の関所の内に収めるために分けた。DBに触れない（関数の呼び出しは、注入された callFunction が行う）。
 * 出力・例外の文・評価の順は、分ける前と同じ。
 */
import { addDaysToDateString } from "../dateUtils.js";
import { DEFAULT_DAYS } from "./checks.js";
import { evaluateCountCheck, evaluateFreshnessCheck } from "./evaluate.js";

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

export const compact = (r) => ({
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
export function countStatuses(checkResults) {
  const statusCounts = {};
  for (const r of checkResults) {
    statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
  }
  return statusCounts;
}

/** 関数に渡す引数（p_from・p_to のうち、その関数が持つもの） */
function argsFor(fn, { start, end }) {
  const all = { p_from: start, p_to: end };
  return Object.fromEntries(fn.args.map((a) => [a.name, all[a.name]]));
}

/**
 * 関数を逐次実行する（並列にしない。Disk IO予算への配慮）。失敗した関数は errors に残し、他の関数は続ける。
 * @returns {Promise<{results: Map<string, unknown>, errors: Record<string, string>}>}
 */
export async function callFunctions(rangeByFn, { findFn, callFunction, end }) {
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
  return { results, errors };
}
