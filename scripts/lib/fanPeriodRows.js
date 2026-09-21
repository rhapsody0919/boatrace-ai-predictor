/**
 * fan中間形式（fan-period/v1）→ DBの行への変換（純関数）
 *
 * 出力先:
 *   racer_period_stats  選手×期の成績（履歴）。docs/db-migration/083_racer_period_stats.sql
 *   racer_profiles      最新期の値を、既存の読み手向けの列へ反映（sync-profiles）
 *
 * 「値なし」の扱い（公式の選手ページと突き合わせて確認: 出走0の選手は、ページで勝率・2連対率・平均ST・
 * 能力指数が「-」表記、fanでは 0 が入る）:
 *   - 出走回数が0 → 勝率・2連対率・平均ST・今期能力指数はNULL
 *   - コースの進入回数が0 → そのコースの複勝率（2連対率）・平均ST・平均スタート順位はNULL
 *   - 前期能力指数が0 → NULL（0.00の能力指数は存在しない）
 *   - 回数（着回数・F/L/K/S）は、0を0のまま保持する（0回は事実）
 *
 * 「複勝率」の意味（layout.html の項目名は「複勝率」）: 全体・コース別とも (1着+2着)/出走（進入）回数の
 * 2連対率（小数点以下1桁、切り捨て気味の丸め）。計算による確認（fan0110〜fan2604の10ファイルで全体の
 * 2連対率は全レコード一致）と、公式ページの2連対率との一致（4選手）で確認済み。列名は top2_rate とする
 * （Kファイル・racelistの「2連率」と同じ概念）。公式のコース別ページの「3連対率」は、着回数から導出する。
 */

import { derivePeriodLabel } from "./racerSeasonStats.js";

export const FAN_TABLES = {
  stats: {
    table: "racer_period_stats",
    onConflict: "racer_id,period_year,period_no",
    keyColumns: ["racer_id", "period_year", "period_no"],
  },
};

const COURSES = [1, 2, 3, 4, 5, 6];
const PLACES = [1, 2, 3, 4, 5, 6];
const MARKS = ["f", "l0", "l1", "k0", "k1", "s0", "s1", "s2"];
const NO_COURSE_MARKS = ["l0", "l1", "k0", "k1"];

/** コース別の列名（DDLと一致させる。verify-fan-period.js が突き合わせる） */
export function courseColumns(c) {
  return [
    `c${c}_entries`,
    `c${c}_top2_rate`,
    `c${c}_avg_st`,
    `c${c}_avg_start_rank`,
    ...PLACES.map((p) => `c${c}_p${p}`),
    ...MARKS.map((m) => `c${c}_${m}`),
  ];
}

export const STATS_COLUMNS = [
  "racer_id",
  "period_year",
  "period_no",
  "calc_from",
  "calc_to",
  "source_file",
  "grade",
  "grade_prev",
  "grade_prev2",
  "grade_prev3",
  "ability_prev",
  "ability_now",
  "win_rate",
  "top2_rate",
  "first_count",
  "second_count",
  "starts",
  "finals",
  "wins",
  "avg_st",
  "branch",
  "height_cm",
  "weight_kg",
  ...COURSES.flatMap(courseColumns),
  ...NO_COURSE_MARKS.map((m) => `nc_${m}`),
];

/** diffRows（変更の無い行は書かない）の numeric 列の丸め桁（DDLの numeric 定義と一致させる） */
export const NUMERIC_SCALES = {
  racer_period_stats: {
    ability_prev: 2,
    ability_now: 2,
    win_rate: 2,
    top2_rate: 1,
    avg_st: 2,
    ...Object.fromEntries(
      COURSES.flatMap((c) => [
        [`c${c}_top2_rate`, 1],
        [`c${c}_avg_st`, 2],
        [`c${c}_avg_start_rank`, 2],
      ]),
    ),
  },
  racer_profiles: { official_win_rate_period: 2 },
};

const nz = (v) => (v === null || v === undefined || v === 0 ? null : v);
const orNull = (v) => (v === "" || v === undefined ? null : v);

/**
 * 1選手の統計行。
 * @param {object} r parseFanFile の records の要素
 * @param {{period: object, id: string}} ctx
 */
function statsRow(r, ctx) {
  const noStarts = !r.starts;
  const row = {
    racer_id: r.racer_id,
    period_year: ctx.period.year,
    period_no: ctx.period.no,
    calc_from: ctx.period.calc_from,
    calc_to: ctx.period.calc_to,
    source_file: ctx.id,
    grade: orNull(r.grade),
    grade_prev: orNull(r.grade_prev),
    grade_prev2: orNull(r.grade_prev2),
    grade_prev3: orNull(r.grade_prev3),
    ability_prev: nz(r.ability_prev),
    ability_now: noStarts ? null : nz(r.ability_now),
    win_rate: noStarts ? null : r.win_rate,
    top2_rate: noStarts ? null : r.top2_rate,
    first_count: r.first_count,
    second_count: r.second_count,
    starts: r.starts,
    finals: r.finals,
    wins: r.wins,
    avg_st: noStarts ? null : r.avg_st,
    branch: orNull(r.branch),
    height_cm: nz(r.height_cm),
    weight_kg: nz(r.weight_kg),
  };
  for (const c of COURSES) {
    const course = r.courses[c - 1];
    const none = !course.entries;
    row[`c${c}_entries`] = course.entries;
    row[`c${c}_top2_rate`] = none ? null : course.top2_rate;
    row[`c${c}_avg_st`] = none ? null : course.avg_st;
    row[`c${c}_avg_start_rank`] = none ? null : course.avg_start_rank;
    PLACES.forEach((p, i) => {
      row[`c${c}_p${p}`] = course.places[i];
    });
    for (const m of MARKS) row[`c${c}_${m}`] = course[m];
  }
  for (const m of NO_COURSE_MARKS) row[`nc_${m}`] = r.no_course[m];
  return row;
}

/**
 * 中間形式 → racer_period_stats の行。
 * @param {ReturnType<import("./fanPeriodParser.js").parseFanFile>} fan
 * @returns {{rows: object[], warnings: string[]}}
 */
export function buildStatsRows(fan) {
  if (!fan.period) throw new Error(`${fan.id}: 期を特定できません`);
  const warnings = [];
  const rows = [];
  for (const r of fan.records) {
    if (r.racer_id === null || r.racer_id === undefined) {
      warnings.push(`${fan.id}: 登番が読めないレコードを除外しました`);
      continue;
    }
    rows.push(statsRow(r, { period: fan.period, id: fan.id }));
  }
  return { rows, warnings };
}

const sumCourses = (r, key) => r.courses.reduce((a, c) => a + c[key], 0);

/**
 * 最新期の中間形式 → racer_profiles の更新行（既存の読み手向けの列）。
 * 既存の行の更新のみ（新規作成しない: 氏名・出身地・血液型は、選手ページの表記（氏名の空白、出身地の「県」、
 * 血液型の「型」）と、fanの表記（全角の桁詰め）が異なるため、既存の表記を保つ）。
 *   ability_index / flying_count_period / false_start_count_period / period_label / official_win_rate_period
 *     → 選手ページの期別成績と同じ値（fan2604で、DBの116選手と全て一致を確認）
 *   height_cm / weight_kg / branch → fanが最新（DBの値は取得時点のまま古い選手がある）
 *   sex / training_term → 新規の列（083）
 * @returns {{rows: object[], warnings: string[]}}
 */
export function buildProfileSyncRows(fan, { includeNewColumns = true } = {}) {
  if (!fan.period) throw new Error(`${fan.id}: 期を特定できません`);
  const warnings = [];
  const label = derivePeriodLabel(fan.period.calc_to);
  if (!label)
    warnings.push(
      `${fan.id}: 算出期間の終了日 ${fan.period.calc_to} から期の識別子を作れません（想定外）`,
    );
  const rows = [];
  for (const r of fan.records) {
    if (r.racer_id === null || r.racer_id === undefined) continue;
    const noStarts = !r.starts;
    let ability = noStarts ? null : nz(r.ability_now);
    if (ability !== null && !Number.isInteger(ability)) {
      warnings.push(
        `${r.racer_id}: 能力指数 ${ability} が整数でないため、丸めて ability_index（INTEGER）へ入れます`,
      );
      ability = Math.round(ability);
    }
    const row = {
      racer_id: r.racer_id,
      ability_index: ability,
      flying_count_period: noStarts ? null : sumCourses(r, "f"),
      false_start_count_period: noStarts
        ? null
        : sumCourses(r, "l1") + r.no_course.l1,
      period_label: noStarts ? null : label,
      official_win_rate_period: noStarts ? null : r.win_rate,
      height_cm: nz(r.height_cm),
      weight_kg: nz(r.weight_kg),
      branch: orNull(r.branch),
    };
    if (includeNewColumns) {
      row.sex = r.sex;
      row.training_term = r.training_term;
    }
    rows.push(row);
  }
  return { rows, warnings };
}
