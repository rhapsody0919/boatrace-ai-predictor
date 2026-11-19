/**
 * evaluate.js の部品（純粋関数。DB・時計・Slackに触れない）。通知文・鮮度の判定・件数の集計の部品を、
 * evaluate.js の行数の関所（400行）の内に収めるために分けた。evaluate.js から従来どおり公開する。
 * 出力・例外の文・評価の順は、分ける前と同じ。
 */

export const sum = (rows, col) =>
  rows.reduce((acc, r) => acc + Number(r[col] ?? 0), 0);
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const shortDate = (d) => d.slice(5);

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

/** 観測値（更新時刻の ISO 文字列・日付・件数）を通知の文にする。時刻は JST の MM-DD HH:MM */
export function formatObserved(observed) {
  if (observed === null || observed === undefined) return "記録なし";
  if (typeof observed === "number") return `${observed}件`;
  const s = String(observed);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(5);
  const t = Date.parse(s);
  if (Number.isNaN(t)) return s;
  const jst = new Date(t + 9 * 3600 * 1000).toISOString();
  return `${jst.slice(5, 10)} ${jst.slice(11, 16)} JST`;
}

/** 項目の種類ごとの、締めまでに満たすべき条件（通知の文） */
const FRESHNESS_CRITERIA = {
  since: "前日21:00 JST 以降の更新が無い",
  date_end: "前日の分まで進んでいない",
  date_prev: "前々日の分まで進んでいない",
  date_next: "当日の日付で書かれていない",
  count: "0件",
};

/**
 * 鮮度の項目（classification: freshness）を、関数の結果（{ 項目のキー: { applicable, ok, observed } }）から判定する。
 * applicable の項目が1つも無ければ not_applicable、1つでも ok でなければ breach。
 *
 * @param {import("./checks.js").FreshnessCheck} check
 * @param {Record<string, {applicable?: boolean, ok?: boolean, observed?: unknown}>|null} result
 * @param {ReadonlyArray<{key: string, table: string, kind: string}>} items 関数の項目の定義（functions.js）
 * @returns {import("./evaluate.js").CheckResult}
 */
export function evaluateFreshnessCheck(check, result, items) {
  const base = { id: check.id, label: check.label, severity: check.severity };
  const byKey = new Map(items.map((i) => [i.key, i]));
  const missingKeys = check.items.filter(
    (k) => !result || typeof result[k] !== "object" || result[k] === null,
  );
  if (missingKeys.length > 0) {
    // 関数が項目を返さない（関数の版が古い等）。黙って ok にしない（job.js が通知にする）
    return {
      ...base,
      status: "error",
      alertOnError: true,
      detail: `関数の結果に項目がありません: ${missingKeys.join("、")}`,
    };
  }
  const applicable = check.items.filter((k) => result[k].applicable !== false);
  if (applicable.length === 0) {
    return {
      ...base,
      status: "not_applicable",
      alertOnError: true,
      detail: "この日は書かれないのが正常（前日にレース・対象の開催が無い）",
    };
  }
  const stale = applicable.filter((k) => result[k].ok !== true);
  const describe = (k) => {
    const item = byKey.get(k);
    return `${k}（${FRESHNESS_CRITERIA[item?.kind] ?? "未達"}。最終 ${formatObserved(result[k].observed)}）`;
  };
  return {
    ...base,
    status: stale.length > 0 ? "breach" : "ok",
    alertOnError: true,
    missing: stale.length,
    staleItems: stale,
    detail: (stale.length > 0 ? stale : applicable)
      .map((k) =>
        stale.length > 0
          ? describe(k)
          : `${k} ${formatObserved(result[k].observed)}`,
      )
      .join("、"),
  };
}

/** 未達の項目の通知文（絵文字なし） */
export function formatBreach(result) {
  if (result.staleItems) {
    return `${result.label}: 締めの時点で更新されていません: ${result.detail}`;
  }
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
