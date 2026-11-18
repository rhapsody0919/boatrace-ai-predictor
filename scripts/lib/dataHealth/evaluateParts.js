/**
 * evaluate.js の判定の部品（純粋関数。DB・時計・Slackに触れない）。evaluateCountCheck・reconcileAlerts を、
 * 複雑さの関所（15）の内に収めるために分けた。出力・例外・評価の順は、分ける前と同じ。
 */
import { addDaysToDateString } from "../dateUtils.js";
import {
  DEFAULT_DAYS,
  DEFAULT_MIN_DENOMINATOR,
  DEFAULT_THRESHOLD,
} from "./checks.js";

export const sum = (rows, col) =>
  rows.reduce((acc, r) => acc + Number(r[col] ?? 0), 0);

/** 件数の項目の、判定の既定を埋めた値 */
export function countParams(check) {
  return {
    threshold: check.threshold ?? DEFAULT_THRESHOLD,
    minDenominator: check.minDenominator ?? DEFAULT_MIN_DENOMINATOR,
    days: check.days ?? DEFAULT_DAYS,
    keyColumn: check.keyColumn ?? "d",
  };
}

/** requiresTable のテーブルが空なら「未導入」の結果、そうでなければ null */
export function notIntroducedResult(check, tableRows, base) {
  if (!check.requiresTable) return null;
  if (tableRows && tableRows[check.requiresTable] === true) return null;
  return {
    ...base,
    status: "not_introduced",
    detail: `${check.requiresTable} が空（取り込み前）のため、未導入として評価しない`,
  };
}

/** 日付の列で見る項目の対象期間。対象が無ければ not_applicable の結果を early に持つ */
function scopeByDate(check, rows, base, { end, days }) {
  const to = addDaysToDateString(end, -(check.lagDays ?? 0));
  let from = addDaysToDateString(end, -(days - 1));
  if (check.since && check.since > from) from = check.since;
  if (from > to) {
    return {
      early: {
        ...base,
        status: "not_applicable",
        detail: check.since
          ? `取得開始前（${check.since}以降が対象。評価の終端 ${to}）`
          : `評価の対象期間がありません（${from}〜${to}）`,
      },
    };
  }
  return {
    scoped: rows.filter((r) => String(r.d) >= from && String(r.d) <= to),
    from,
    to,
  };
}

/**
 * 評価の対象の行と期間。日付の列（d）は期間で絞り、それ以外（月別）は行をそのまま使う。
 * @returns {{early: object}|{scoped: Array<Record<string, unknown>>, from: string, to: string}}
 */
export function scopeRows(check, rows, base, { end, days, keyColumn }) {
  if (keyColumn === "d") return scopeByDate(check, rows, base, { end, days });
  return {
    scoped: rows,
    from: rows.length ? String(rows[0][keyColumn]) : "",
    to: rows.length ? String(rows[rows.length - 1][keyColumn]) : "",
  };
}

/** 行ごとの充足率と、最も低い行・閾値未満の行 */
export function rowStats(scoped, check, keyColumn, threshold) {
  const rowRate = (r) => {
    const d = Number(r[check.denominator]);
    return d === 0 ? null : Number(r[check.numerator]) / d;
  };
  const perRow = scoped
    .map((r) => ({
      key: String(r[keyColumn]),
      rate: rowRate(r),
      missing: Number(r[check.denominator]) - Number(r[check.numerator]),
    }))
    .filter((r) => r.rate !== null);
  const worst = perRow.reduce(
    (min, cur) => (min === null || cur.rate < min.rate ? cur : min),
    null,
  );
  const belowRows = perRow.filter((r) => r.rate < threshold);
  return { worst, belowRows };
}

/** 集計した結果（common）から、perRow・母数の下限・閾値の順に状態を決める */
export function decideCountStatus(check, common, belowRows, minDenominator) {
  if (check.aggregate === "perRow") {
    return {
      ...common,
      status: belowRows.length > 0 ? "breach" : "ok",
      belowRows,
    };
  }
  const { denominator, rate, threshold } = common;
  if (denominator < minDenominator) {
    return {
      ...common,
      status: "insufficient",
      detail: `期待件数が${denominator}件で、母数の下限（${minDenominator}件）未満のため判定しない`,
    };
  }
  return { ...common, status: rate < threshold ? "breach" : "ok" };
}

export const daysBetween = (fromDate, toDate) =>
  Math.round(
    (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) /
      86400000,
  );

/** 前日に出した通知が、scrape-monitor の通知済みの記録に無いか（前日の分だけ確認する） */
function isUndelivered(prev, targetDate, deliveredKeys) {
  return (
    prev !== undefined &&
    prev.alertKey !== undefined &&
    deliveredKeys instanceof Set &&
    daysBetween(prev.lastAt, targetDate) === 1 &&
    !deliveredKeys.has(prev.alertKey)
  );
}

const reasonOf = (prev, worsened, undelivered) => {
  if (prev === undefined) return "";
  if (worsened) return "（悪化）";
  if (undelivered) return "（前回の通知が届いていないため再通知）";
  return "（継続中）";
};

/**
 * 1つの未達を通知するか。通知するなら理由の文（初回は ""）、しないなら null。
 * @param {{key: string, missing: number, everyDay?: boolean}} b
 */
export function alertReason(
  b,
  prev,
  { targetDate, deliveredKeys, remindDays },
) {
  const worsened = prev !== undefined && b.missing > prev.missing;
  const remind =
    prev !== undefined && daysBetween(prev.lastAt, targetDate) >= remindDays;
  const undelivered = isUndelivered(prev, targetDate, deliveredKeys);
  // 毎日通知する未達（鮮度）: 前回の通知が別の対象日なら、欠損数が同じでも通知する
  const nextDay =
    b.everyDay === true && prev !== undefined && prev.lastAt !== targetDate;
  if (!(prev === undefined || worsened || remind || undelivered || nextDay))
    return null;
  return reasonOf(prev, worsened, undelivered);
}

/** 今回「未達でない」と確認できた項目の状態を消し、それ以外（実行していない・できなかった）は残す */
export function carryOverState(previous, okKeys) {
  const emitted = {};
  for (const [key, state] of Object.entries(previous ?? {})) {
    if (!okKeys.has(key)) emitted[key] = state;
  }
  return emitted;
}
