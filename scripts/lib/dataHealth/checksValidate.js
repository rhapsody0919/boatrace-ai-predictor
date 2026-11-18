/**
 * 登録表（checks.js）の整合性の検査の部品。どれも純関数で、違反の文の一覧（空なら正常）を返す。
 * 文と並びは、validateChecks が分ける前と同じ。
 */

/** 条件が真の違反だけを集める（文は先に作るが、条件が偽なら捨てる） */
const collect = (pairs) => pairs.filter(([bad]) => bad).map(([, msg]) => msg);

/** 項目の共通（関数が登録済みか・severity） */
export function validateCommon(c, fnNames) {
  return collect([
    [!fnNames.has(c.fn), `${c.id}: 未登録の関数です: ${c.fn}`],
    [
      !["alert", "info"].includes(c.severity),
      `${c.id}: severity が不正です: ${c.severity}`,
    ],
  ]);
}

/** 鮮度の項目: items が関数の項目のキーか */
function validateFreshnessItems(c, functions) {
  const fn = functions.find((f) => f.name === c.fn);
  const keys = new Set((fn?.items ?? []).map((i) => i.key));
  const problems = [];
  if (!Array.isArray(c.items) || c.items.length === 0)
    problems.push(`${c.id}: items（関数の項目のキー）が空です`);
  for (const key of c.items ?? [])
    if (!keys.has(key))
      problems.push(`${c.id}: 関数 ${c.fn} に無い項目です: ${key}`);
  return problems;
}

/** 鮮度の項目（classification: freshness） */
export function validateFreshnessCheck(c, functions) {
  return [
    ...validateFreshnessItems(c, functions),
    ...collect([
      [
        !/^[a-z0-9-]+\.yml$/.test(c.workflow ?? ""),
        `${c.id}: workflow（.github/workflows のファイル名）が不正です`,
      ],
      [
        c.severity === "info" && !c.note,
        `${c.id}: info（通知しない）にする理由を note に書いてください`,
      ],
    ]),
  ];
}

/** 件数の項目: 閾値・対象期間 */
function validateThresholdAndDays(c, defaults) {
  const threshold = c.threshold ?? defaults.threshold;
  const days = c.days ?? defaults.days;
  return collect([
    [
      !(threshold > 0 && threshold <= 1),
      `${c.id}: threshold は 0 < x <= 1 です: ${threshold}`,
    ],
    [
      c.threshold !== undefined && !c.note,
      `${c.id}: 既定と違う閾値には、理由を note に書いてください`,
    ],
    [
      !Number.isInteger(days) || days < 1 || days > 14,
      `${c.id}: days は 1〜14 の整数です（日次はDisk IOのため14日まで）: ${days}`,
    ],
  ]);
}

/** 件数の項目: 除外の宣言（since・lagDays・requiresTable） */
function validateExclusions(c, days, tableRowsTables) {
  return collect([
    [
      c.since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(c.since),
      `${c.id}: since は YYYY-MM-DD です: ${c.since}`,
    ],
    [
      c.lagDays !== undefined &&
        !(Number.isInteger(c.lagDays) && c.lagDays >= 0 && c.lagDays < days),
      `${c.id}: lagDays は 0 以上 days 未満の整数です`,
    ],
    [
      c.requiresTable !== undefined &&
        !tableRowsTables.includes(c.requiresTable),
      `${c.id}: requiresTable が data_health_table_rows の対象にありません: ${c.requiresTable}`,
    ],
  ]);
}

/** 件数の項目: 列名・実行の曜日 */
function validateColumnsAndCadence(c) {
  return collect([
    [
      !/^[a-z_0-9]+$/.test(c.numerator) || !/^[a-z_0-9]+$/.test(c.denominator),
      `${c.id}: 分子・分母の列名が不正です`,
    ],
    [
      c.cadence !== undefined &&
        !(
          Number.isInteger(c.cadence.weeklyOn) &&
          c.cadence.weeklyOn >= 0 &&
          c.cadence.weeklyOn <= 6
        ),
      `${c.id}: cadence.weeklyOn は 0〜6 です`,
    ],
  ]);
}

/**
 * 件数の項目（classification: count）。
 * @param {*} c
 * @param {{tableRowsTables: ReadonlyArray<string>, defaults: {threshold: number, days: number}}} ctx
 */
export function validateCountCheck(c, { tableRowsTables, defaults }) {
  return [
    ...collect([
      [c.classification !== "count", `${c.id}: classification が不正です`],
    ]),
    ...validateThresholdAndDays(c, defaults),
    ...validateExclusions(c, c.days ?? defaults.days, tableRowsTables),
    ...validateColumnsAndCadence(c),
  ];
}

/** 空テーブルの扱いと data_health_table_rows の対象の突き合わせ */
export function validatePolicies(policies, tableRowsTables) {
  const problems = [];
  for (const [table, p] of Object.entries(policies)) {
    if (!["forbid", "info", "pending"].includes(p.policy))
      problems.push(`${table}: policy が不正です: ${p.policy}`);
    if (!tableRowsTables.includes(table))
      problems.push(`${table}: data_health_table_rows の対象にありません`);
  }
  for (const table of tableRowsTables) {
    if (!policies[table])
      problems.push(
        `${table}: 空テーブルの扱い（EMPTY_TABLE_POLICIES）が未登録です`,
      );
  }
  return problems;
}
