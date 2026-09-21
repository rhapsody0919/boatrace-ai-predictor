/**
 * 汎用の日次監視（data_health）の判定（純粋関数。DB・時計・Slackに触れない）。
 *
 *   evaluateCountCheck    登録表の1項目を、関数が返した日別の行から判定する（閾値・除外・母数・確定ラグ）
 *   evaluateEmptyTables   0件のテーブルの判定（forbid・info・pending）
 *   reconcileAlerts       通知の一意性: 状態（last_report.emitted）を使い、同じ未達を毎日通知しない
 *
 * 通知は、scrape-monitor（monitor.js）の last_report.alerts の経路に流す。monitor 側は、同じ key の通知を
 * 6時間おきに再通知するため、ここで until（通知の有効期限）を付けて、1回の実行につき1回だけ届くようにする。
 */
import { addDaysToDateString } from "../dateUtils.js";
import {
  DEFAULT_DAYS,
  DEFAULT_MIN_DENOMINATOR,
  DEFAULT_THRESHOLD,
} from "./checks.js";

/** 同じ未達が続くとき、この日数ごとに再通知する（悪化したときは、日数によらず通知する） */
export const REMIND_DAYS = 7;
/** 通知（last_report.alerts）の有効期限（時間）。scrape-monitor の起動（JST 07:00〜）が拾うのに十分で、6時間の再通知より短い */
export const ALERT_VALID_HOURS = 4;
/** この件数以上の項目が同時に未達なら、共通原因（障害・順延・取得の停止）の要約を先頭に付ける */
export const COMMON_CAUSE_MIN_BREACHES = 4;

const sum = (rows, col) =>
  rows.reduce((acc, r) => acc + Number(r[col] ?? 0), 0);
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const shortDate = (d) => d.slice(5);

/** JSTの日付（YYYY-MM-DD）の曜日（0=日〜6=土） */
export function weekdayOf(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

/** 週次の項目を、この対象日に実行するか */
export function isDueToday(check, targetDate) {
  if (!check.cadence) return true;
  return weekdayOf(targetDate) === check.cadence.weeklyOn;
}

/**
 * 評価の期間。対象日（ジョブの指定時刻から解決した日）の前日を終端とする（前日分が確定した後）。
 * @returns {{end: string, start: string}}
 */
export function periodFor(targetDate, days) {
  const end = addDaysToDateString(targetDate, -1);
  return { end, start: addDaysToDateString(end, -(days - 1)) };
}

/**
 * @typedef {Object} CheckResult
 * @property {string} id
 * @property {string} label
 * @property {"ok"|"breach"|"not_applicable"|"not_introduced"|"insufficient"|"no_target"} status
 * @property {"alert"|"info"} severity
 * @property {number|null} [rate]
 * @property {number} [numerator]
 * @property {number} [denominator]
 * @property {number} [missing]
 * @property {number} [threshold]
 * @property {string} [from]
 * @property {string} [to]
 * @property {{key: string, rate: number, missing: number}|null} [worst]
 * @property {Array<{key: string, rate: number, missing: number}>} [belowRows]
 * @property {string} [detail]
 */

/**
 * 登録表の項目を、関数の結果（日別の行）から判定する。
 *
 * @param {import("./checks.js").CountCheck} check
 * @param {Array<Record<string, unknown>>} rows 関数の結果の行
 * @param {{end: string, tableRows?: Record<string, boolean>|null}} ctx end は評価の終端（前日）
 * @returns {CheckResult}
 */
export function evaluateCountCheck(check, rows, { end, tableRows = null }) {
  const base = {
    id: check.id,
    label: check.label,
    severity: check.severity,
  };
  const threshold = check.threshold ?? DEFAULT_THRESHOLD;
  const minDenominator = check.minDenominator ?? DEFAULT_MIN_DENOMINATOR;
  const days = check.days ?? DEFAULT_DAYS;
  const keyColumn = check.keyColumn ?? "d";

  if (check.requiresTable) {
    if (!tableRows || tableRows[check.requiresTable] !== true) {
      return {
        ...base,
        status: "not_introduced",
        detail: `${check.requiresTable} が空（取り込み前）のため、未導入として評価しない`,
      };
    }
  }

  let scoped;
  let from;
  let to;
  if (keyColumn === "d") {
    to = addDaysToDateString(end, -(check.lagDays ?? 0));
    from = addDaysToDateString(end, -(days - 1));
    if (check.since && check.since > from) from = check.since;
    if (from > to) {
      return {
        ...base,
        status: "not_applicable",
        detail: check.since
          ? `取得開始前（${check.since}以降が対象。評価の終端 ${to}）`
          : `評価の対象期間がありません（${from}〜${to}）`,
      };
    }
    scoped = rows.filter((r) => String(r.d) >= from && String(r.d) <= to);
  } else {
    scoped = rows;
    from = scoped.length ? String(scoped[0][keyColumn]) : "";
    to = scoped.length ? String(scoped[scoped.length - 1][keyColumn]) : "";
  }

  const numerator = sum(scoped, check.numerator);
  const denominator = sum(scoped, check.denominator);
  if (denominator === 0) {
    return {
      ...base,
      status: "no_target",
      numerator,
      denominator,
      from,
      to,
      detail: "期待件数が0件（対象のレースが無い）",
    };
  }

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
  const rate = numerator / denominator;
  const common = {
    ...base,
    rate,
    numerator,
    denominator,
    missing: denominator - numerator,
    threshold,
    from,
    to,
    worst,
  };

  if (check.aggregate === "perRow") {
    return {
      ...common,
      status: belowRows.length > 0 ? "breach" : "ok",
      belowRows,
    };
  }
  if (denominator < minDenominator) {
    return {
      ...common,
      status: "insufficient",
      detail: `期待件数が${denominator}件で、母数の下限（${minDenominator}件）未満のため判定しない`,
    };
  }
  return { ...common, status: rate < threshold ? "breach" : "ok" };
}

/**
 * 0件のテーブルの判定。
 * @param {Record<string, {policy: string, note?: string}>} policies
 * @param {Record<string, boolean>} tableRows テーブル名 → 1行以上あるか
 * @returns {Array<{table: string, status: "ok"|"empty"|"empty_info"|"not_introduced"|"unknown", severity: "alert"|"info", policy: string, note?: string}>}
 */
export function evaluateEmptyTables(policies, tableRows) {
  return Object.entries(policies).map(([table, p]) => {
    const has = tableRows?.[table];
    const base = {
      table,
      policy: p.policy,
      severity: p.policy === "forbid" ? "alert" : "info",
      ...(p.note ? { note: p.note } : {}),
    };
    if (has === undefined) return { ...base, status: "unknown" };
    if (has) return { ...base, status: "ok" };
    if (p.policy === "forbid") return { ...base, status: "empty" };
    if (p.policy === "pending") return { ...base, status: "not_introduced" };
    return { ...base, status: "empty_info" };
  });
}

/** 未達の項目の通知文（絵文字なし） */
export function formatBreach(result) {
  if (result.belowRows) {
    const rows = result.belowRows
      .slice(0, 6)
      .map((r) => `${r.key} ${pct(r.rate)}（欠${r.missing}件）`)
      .join("、");
    return `${result.label}: 閾値${pct(result.threshold)}未満の月 ${rows}`;
  }
  const worst = result.worst;
  const worstText =
    worst && worst.rate < result.threshold
      ? `。最も低い日 ${shortDate(worst.key)} ${pct(worst.rate)}（欠${worst.missing}件）`
      : "";
  return `${result.label}: 充足率 ${pct(result.rate)}（${result.numerator}/${result.denominator}、欠${result.missing}件、閾値${pct(result.threshold)}、${shortDate(result.from)}〜${shortDate(result.to)}）${worstText}`;
}

const daysBetween = (fromDate, toDate) =>
  Math.round(
    (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) /
      86400000,
  );

/**
 * 通知する項目を決める（状態機械）。同じ未達を、毎日通知しない。
 *
 * 状態 emitted[key] = { firstAt, lastAt, missing, alertKey }（key は項目のid。lastAt=最後に通知した対象日、
 * missing=最後に観測した欠損数、alertKey=最後に出した通知の key）:
 *   - 未達で、状態が無い → 通知（初回）
 *   - 未達で、欠損数が前回の観測より増えた → 通知（悪化）
 *   - 未達で、最後の通知から REMIND_DAYS 日以上 → 通知（継続中の再通知）
 *   - 未達で、前日に出した通知が、scrape-monitor の通知済みの記録（deliveredKeys）に無い → 通知（未配信の再通知。
 *     scrape-monitor の停止・Slack送信の失敗で、通知の有効期限（ALERT_VALID_HOURS）内に届かなかった場合に、
 *     REMIND_DAYS 日黙り込まないため。記録を読めない（deliveredKeys が null）ときは判定しない）
 *   - 未達で上のいずれでもない → 通知しない（欠損数の観測値だけ更新する）
 *   - 未達でない（回復・対象外・未導入）→ 状態を消す（再発したら、初回として通知する）
 *   - 実行できなかった項目（errorKeys）→ 状態を変えない
 *
 * @param {Object} input
 * @param {Array<{key: string, text: string, missing: number}>} input.breaches 今回の未達（通知の候補）
 * @param {Set<string>} input.okKeys 今回、未達でないと確認できた項目のkey
 * @param {Record<string, {firstAt: string, lastAt: string, missing: number, alertKey?: string}>} input.previous
 * @param {string} input.targetDate
 * @param {Date} input.now
 * @param {Set<string>|null} [input.deliveredKeys] scrape-monitor が通知済みとして記録している、この監視の通知の key（dh:項目:対象日）
 * @returns {{alerts: Array<{key: string, text: string, until: string}>, emitted: Record<string, {firstAt: string, lastAt: string, missing: number, alertKey: string}>}}
 */
export function reconcileAlerts({
  breaches,
  okKeys,
  previous,
  targetDate,
  now,
  deliveredKeys = null,
}) {
  const until = new Date(
    now.getTime() + ALERT_VALID_HOURS * 3600 * 1000,
  ).toISOString();
  const emitted = {};
  for (const [key, state] of Object.entries(previous ?? {})) {
    // 今回の実行で「未達でない」と確認できた項目は、状態を消す。それ以外（今回実行していない・実行できなかった）は残す
    if (!okKeys.has(key)) emitted[key] = state;
  }
  const alerts = [];
  for (const b of breaches) {
    const prev = previous?.[b.key];
    const worsened = prev !== undefined && b.missing > prev.missing;
    const remind =
      prev !== undefined && daysBetween(prev.lastAt, targetDate) >= REMIND_DAYS;
    // 前日に出した通知が、scrape-monitor に届いていない（通知済みの記録に無い）。前日の分だけ確認する
    // （通知済みの記録の保持は72時間で、それより古い通知は、届いていても記録から消える）
    const undelivered =
      prev !== undefined &&
      prev.alertKey !== undefined &&
      deliveredKeys instanceof Set &&
      daysBetween(prev.lastAt, targetDate) === 1 &&
      !deliveredKeys.has(prev.alertKey);
    if (prev === undefined || worsened || remind || undelivered) {
      const reason =
        prev === undefined
          ? ""
          : worsened
            ? "（悪化）"
            : undelivered
              ? "（前回の通知が届いていないため再通知）"
              : "（継続中）";
      const alertKey = `dh:${b.key}:${targetDate}`;
      alerts.push({ key: alertKey, text: `${b.text}${reason}`, until });
      emitted[b.key] = {
        firstAt: prev?.firstAt ?? targetDate,
        lastAt: targetDate,
        missing: b.missing,
        alertKey,
      };
    } else {
      emitted[b.key] = { ...prev, missing: b.missing };
    }
  }
  return { alerts, emitted };
}

/** 共通原因の要約（同時に多数の項目が未達のときの、先頭の1件） */
export function commonCauseAlert({ count, targetDate, now }) {
  return {
    key: `dh:summary:${targetDate}`,
    text: `データ健全性: ${count}項目が同時に閾値未達です。個別の欠損より、共通の原因（DB・取得基盤の障害、順延・中止の未確定、取得ジョブの停止）を先に疑ってください`,
    until: new Date(
      now.getTime() + ALERT_VALID_HOURS * 3600 * 1000,
    ).toISOString(),
  };
}
