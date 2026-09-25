/**
 * 汎用の日次監視（data_health、完了の定義C）の登録表。データセットごとに、次を宣言する。
 *
 *   (a)(b) 期待件数・実件数  DBの関数（scripts/lib/dataHealth/functions.js。固定のSQL）の名前と、その結果の
 *                            分子の列（numerator）・分母の列（denominator）。分母は、中止・順延（確定中止）の除外、
 *                            取得開始日以降のみ、等のルールをSQL側で持つ（分母の定義は data-health-report.js と共有）
 *   (c) 閾値               既定99%（完了の定義A）。既定と違う値には、理由を note に書く
 *   (d) 対象期間           直近 days 日（既定7）。全期間の集計は週次（cadence）
 *   (e) 分類               count（件数の充足率）／ empty-table（0件のテーブル）
 *
 * 新しい項目（データセット）を足すには:
 *   1. そのデータセットのマイグレーションで、期待件数・実件数を返す関数を追加する（functions.js に1件足し、
 *      scripts/maintenance/render-data-health-functions.js でDDLを生成して貼る）
 *   2. この表に、関数名と分子・分母の列、閾値、除外（since・lagDays・requiresTable）を宣言する
 *
 * 除外の宣言:
 *   since          取得開始日（この日より前は、期待件数の対象外。「対象外（取得開始前）」と報告する）
 *   lagDays        確定ラグ（日）。評価の終端を、その分だけ前にずらす（当日中に取れない、または翌日以降に確定する
 *                  データ。例: Kファイル由来の実進入・着順は、翌朝07:00・12:00 JST の同期で確定する）
 *   requiresTable  そのテーブルに1行以上ある間だけ評価する（空の間は「未導入」と報告し、警告しない）
 *   minDenominator 分母がこの件数未満の期間は判定しない（母数が小さい期間の誤報を避ける）
 * 中止・順延: 分母のSQLが、開催中止（cancellation_status='confirmed'）を除く。順延・中止の確定が遅れる場合の
 * 誤報は、評価が前日分（翌朝06:30 JST。最終レースの結果確定から約8時間後）であることと、確定の早期化
 * （race_status ジョブ）で避ける。
 */
import { COVERAGE_METRICS } from "./coverageSpec.js";

/** 既定の閾値（完了の定義A: 充足率99%以上） */
export const DEFAULT_THRESHOLD = 0.99;
/** 既定の対象期間（日）。Disk IOへの配慮で、日次は直近7日まで */
export const DEFAULT_DAYS = 7;
/** 分母がこの件数未満の期間は判定しない（既定） */
export const DEFAULT_MIN_DENOMINATOR = 30;

/**
 * @typedef {Object} CountCheck
 * @property {string} id
 * @property {string} label
 * @property {"count"} classification
 * @property {"alert"|"info"} severity alert=閾値未達をSlackへ通知、info=last_report に載せるだけ
 * @property {string} fn 関数名（functions.js）
 * @property {string} numerator 分子の列
 * @property {string} denominator 分母の列
 * @property {number} [threshold]
 * @property {number} [days]
 * @property {number} [minDenominator]
 * @property {string} [since] YYYY-MM-DD
 * @property {number} [lagDays]
 * @property {string} [requiresTable]
 * @property {{weeklyOn: number}} [cadence] JSTの曜日（0=日〜6=土）にだけ実行する（全期間の集計）
 * @property {"sum"|"perRow"} [aggregate] sum=期間の合計（既定）、perRow=行ごとに判定（月別）
 * @property {string} [keyColumn] 行のキーの列（既定 d。月別は month）
 * @property {string} [note]
 */

const coverageChecks = COVERAGE_METRICS.map((metric) => {
  // 実進入・着順4位以降は、Kファイル（www1.mbrace.or.jp）の同期で確定する。Kファイルは開催日の夜〜翌日に
  // 公開され、同期は翌朝07:00・12:00 JST（kfile_sync）。当日分の実進入は当日中に取れない（plan.md・job-inventory.md G10）。
  // 評価は翌朝06:30 JST で、同期の前のため、前日分を評価せず、前々日までを評価する（lagDays: 1）
  const kfile = metric.key === "actual_course" || metric.key === "rank4_6";
  return {
    id: `coverage.${metric.key}`,
    label: metric.label,
    classification: "count",
    severity: "alert",
    fn: "data_health_coverage",
    numerator: metric.key,
    denominator: metric.denomKey ?? "denom",
    ...(metric.since ? { since: metric.since } : {}),
    ...(kfile
      ? {
          lagDays: 1,
          note: "Kファイル由来（翌朝07:00・12:00 JST の同期で確定）のため、前日分は評価せず前々日まで",
        }
      : {}),
  };
});

/** @type {ReadonlyArray<CountCheck>} */
export const COUNT_CHECKS = Object.freeze([
  ...coverageChecks,

  // 出走表の拡張列（マイグレーション081）。081の適用は2026-09-21 11:2x JST で、レース情報（race_info）が列を
  // 書き始めたのはその後（9/21は384/738行）。全日そろうのは9/22から
  ...[
    ["weight_kg", "出走表: 登録体重"],
    ["f_count", "出走表: F数"],
    ["l_count", "出走表: L数"],
    ["branch", "出走表: 支部"],
    ["is_absent", "出走表: 欠場の判定(is_absent)"],
  ].map(([column, label]) => ({
    id: `pre_race.${column}`,
    label,
    classification: "count",
    severity: "alert",
    fn: "data_health_pre_race_fields",
    numerator: column,
    denominator: "entries",
    since: "2026-09-22",
  })),
  ...[
    ["race_distance_m", "レース条件: 距離"],
    ["race_labels", "レース条件: ラベル"],
  ].map(([column, label]) => ({
    id: `pre_race.${column}`,
    label,
    classification: "count",
    severity: "alert",
    fn: "data_health_pre_race_fields",
    numerator: column,
    denominator: "races",
    since: "2026-09-22",
  })),

  // ピットレポート（選手コメント、マイグレーション085）。対象はSG・G1・G2の一部のみで、期待件数は1日6〜12レース。
  // 公開の有無は主催者次第で、平常時の充足率の実測が無い。閾値は暫定で95%とし、live後の実測で見直す（tasks.md）
  {
    id: "pit_reports.report",
    label: "ピットレポート(対象レースの取得)",
    classification: "count",
    severity: "alert",
    fn: "data_health_pit_reports",
    numerator: "with_report",
    denominator: "expected",
    threshold: 0.95,
    minDenominator: 5,
    since: "2026-09-22",
    note: "085の適用・pit_reports の live化は2026-09-21。平常時の実測が無いため、閾値は暫定の95%",
  },

  // 節・選手の期別成績。取り込み前（テーブルが空）は「未導入」。取り込み後（過去分のバックフィル済み）に有効になる
  {
    id: "race_series.covered",
    label: "節(開催のあった会場×日を覆う)",
    classification: "count",
    severity: "alert",
    fn: "data_health_race_series",
    numerator: "covered",
    denominator: "expected",
    minDenominator: 10,
    requiresTable: "race_series",
  },
  {
    id: "racer_period_stats.covered",
    label: "選手の期別成績(出走した選手)",
    classification: "count",
    severity: "alert",
    fn: "data_health_racer_period_stats",
    numerator: "with_stats",
    denominator: "expected",
    // 新人は、期別成績の公開（最大約2か月遅れ）まで成績が無い。取り込み後の実測で見直す
    threshold: 0.97,
    minDenominator: 100,
    requiresTable: "racer_period_stats",
    note: "新人は公開前で成績が無いため、閾値は暫定の97%。取り込み後の実測で見直す",
  },

  // 出走表の複製検知（BOA-422・BOA-423）。「開催が無い日に過去日の出走表が複製される」(幻の開催日、BOA-407)の
  // 逆で、実際に開催のあった日の出走表だけが過去日のデータで汚染される事象。結果(race_results)は正常に入るため、
  // 欠損ベースの監視では一切ひっかからない。2025-12-02〜2026-09-25の実測で、この定義の検知は
  // 公式K/Bファイルと突き合わせた22会場日を過不足なく拾う（取りこぼし0・誤検知0）。1件でも異常なので閾値は100%
  {
    id: "entries.duplicates",
    label: "出走表の複製(過去日のデータでの汚染)",
    classification: "count",
    severity: "alert",
    fn: "data_health_entries_duplicates",
    numerator: "clean_venue_days",
    denominator: "venue_days",
    threshold: 1,
    minDenominator: 1,
    // 前日の結果が確定してから判定する（関数が、結果のあるレースだけを対象にする）
    lagDays: 1,
    note: "汚染は1会場日でも異常のため、閾値は100%。2025-12-02〜2026-09-25の実測で誤検知0（判定はレース単位の一致が2件以上）",
  },

  // 月別の結果充足率（全期間）。既知の欠損（2025-12・2026-01・2026-03。バックフィル前）があるため、
  // 通知せず last_report に載せる（バックフィル後に severity を alert に変える）
  {
    id: "result.monthly",
    label: "結果(rank1)の月別充足率(全期間)",
    classification: "count",
    severity: "info",
    fn: "data_health_monthly_result",
    numerator: "with_result",
    denominator: "denom",
    aggregate: "perRow",
    keyColumn: "month",
    cadence: { weeklyOn: 1 },
    note: "全期間の集計のため週次（月曜）。既知の欠損月（バックフィル前）があるため通知しない",
  },
]);

/**
 * 空テーブルの扱い。
 *   forbid   0件は異常（Slackへ通知）
 *   info     0件でも警告しない（last_report に「0件」と載せる。0件が正常かの確認中のテーブル）
 *   pending  取り込み前（0件）は「未導入」として警告しない。取り込み後に、forbid と同じに扱う
 */
export const EMPTY_TABLE_POLICIES = Object.freeze({
  races: { policy: "forbid" },
  race_entries: { policy: "forbid" },
  race_results: { policy: "forbid" },
  race_conditions: { policy: "forbid" },
  race_start_timings: { policy: "forbid" },
  exhibition_data: { policy: "forbid" },
  race_odds: { policy: "forbid" },
  race_payouts: { policy: "forbid" },
  racer_profiles: { policy: "forbid" },
  racer_series_points: { policy: "forbid" },
  venue_entry_course_stats: { policy: "forbid" },
  venue_motor_stats: { policy: "forbid" },
  external_predictions: { policy: "forbid" },
  race_pit_reports: { policy: "forbid" },
  race_special_notes: {
    policy: "info",
    note: "0件が正常かの確認中（2026-09-21時点で0件）。確認できたら forbid か、削除する",
  },
  race_series: { policy: "pending", note: "月間スケジュールの取り込み前" },
  racer_period_stats: { policy: "pending", note: "fan ファイルの取り込み前" },
});

/**
 * 登録表の整合性の検査。違反の一覧（空なら正常）を返す。
 * @param {{checks?: ReadonlyArray<CountCheck>, policies?: Record<string, {policy: string}>, functions: ReadonlyArray<{name: string}>, tableRowsTables: ReadonlyArray<string>}} input
 */
export function validateChecks({
  checks = COUNT_CHECKS,
  policies = EMPTY_TABLE_POLICIES,
  functions,
  tableRowsTables,
}) {
  const problems = [];
  const ids = new Set();
  const fnNames = new Set(functions.map((f) => f.name));
  for (const c of checks) {
    if (ids.has(c.id)) problems.push(`${c.id}: id が重複しています`);
    ids.add(c.id);
    if (!fnNames.has(c.fn)) problems.push(`${c.id}: 未登録の関数です: ${c.fn}`);
    if (!["alert", "info"].includes(c.severity))
      problems.push(`${c.id}: severity が不正です: ${c.severity}`);
    if (c.classification !== "count")
      problems.push(`${c.id}: classification が不正です`);
    const threshold = c.threshold ?? DEFAULT_THRESHOLD;
    if (!(threshold > 0 && threshold <= 1))
      problems.push(`${c.id}: threshold は 0 < x <= 1 です: ${threshold}`);
    if (c.threshold !== undefined && !c.note)
      problems.push(
        `${c.id}: 既定と違う閾値には、理由を note に書いてください`,
      );
    const days = c.days ?? DEFAULT_DAYS;
    if (!Number.isInteger(days) || days < 1 || days > 14)
      problems.push(
        `${c.id}: days は 1〜14 の整数です（日次はDisk IOのため14日まで）: ${days}`,
      );
    if (c.since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(c.since))
      problems.push(`${c.id}: since は YYYY-MM-DD です: ${c.since}`);
    if (
      c.lagDays !== undefined &&
      !(Number.isInteger(c.lagDays) && c.lagDays >= 0 && c.lagDays < days)
    )
      problems.push(`${c.id}: lagDays は 0 以上 days 未満の整数です`);
    if (
      c.requiresTable !== undefined &&
      !tableRowsTables.includes(c.requiresTable)
    )
      problems.push(
        `${c.id}: requiresTable が data_health_table_rows の対象にありません: ${c.requiresTable}`,
      );
    if (
      !/^[a-z_0-9]+$/.test(c.numerator) ||
      !/^[a-z_0-9]+$/.test(c.denominator)
    )
      problems.push(`${c.id}: 分子・分母の列名が不正です`);
    if (
      c.cadence !== undefined &&
      !(
        Number.isInteger(c.cadence.weeklyOn) &&
        c.cadence.weeklyOn >= 0 &&
        c.cadence.weeklyOn <= 6
      )
    )
      problems.push(`${c.id}: cadence.weeklyOn は 0〜6 です`);
  }
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
