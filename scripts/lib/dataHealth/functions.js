/**
 * 汎用の日次監視（data_health）が呼ぶDB関数の定義（SQLの正本）。
 *
 * 呼び出し元が任意のSQLを渡す口は作らない（動的SQLの実行口は、鍵の流出やコードの不具合の被害範囲を広げる）。
 * 代わりに、固定のSQLを持つ、名前つき・型つき引数の関数を、データセットごとに用意する（読み取りの集計のみ）:
 *   SECURITY INVOKER・STABLE・SET search_path 固定・SET statement_timeout・引数の検査（期間は最大32日）、
 *   PUBLIC・anon・authenticated から EXECUTE を剥奪し、service_role のみに付与（マイグレーション076の規律）。
 * 関数の呼び出しは、supabase-js の rpc（Vercel Function）。
 *
 * 期待件数のSQLはここで宣言し、判定（閾値・分類・除外）は checks.js の登録表で宣言する。
 * 新しいデータセットは、そのデータセットのマイグレーションで、関数を CREATE OR REPLACE し、ここに1件足す
 * （`migration` に、その関数のDDLを含むマイグレーションのファイル名を書く。`npm run verify:data-health-job` が、
 * そのファイルにこのモジュールから生成したDDLが一字一句含まれることと、REVOKE・GRANTの内容を機械検査する。
 * DDLの生成は `node scripts/maintenance/render-data-health-functions.js <関数名...>`）。
 *
 * 同じSQLを、日付リテラルにして手元から実行する（scripts/maintenance/check-data-health.js。関数の適用前に、
 * 本番の読み取り専用で値を確認するため）。存在充足率と月別の結果充足率のSQLは、data-health-report.js と共有する
 * （coverageSpec.js。二重実装しない）。
 *
 * shape:
 *   rows    日別の行の配列（jsonb）。各行に、日付の列（d、月別は month）と数値の列がある
 *   object  { キー: 値 } の1つのオブジェクト（jsonb）
 */
import {
  FUNCTION_COVERAGE_SLOTS,
  buildCoverageSql,
  buildMonthlySql,
  literalCoverageSlots,
} from "./coverageSpec.js";

/** 1回の呼び出しで読める期間の上限（日）。範囲の広い読み取り（Disk IO）を、関数の入口で拒否する */
export const MAX_RANGE_DAYS = 32;

/**
 * 空でないことを確認するテーブル（data_health_table_rows）。テーブルを足すときは、
 * マイグレーションで data_health_table_rows を CREATE OR REPLACE し、ここにも足す（一覧は関数の中にある）
 */
export const TABLE_ROWS_TABLES = Object.freeze([
  "races",
  "race_entries",
  "race_results",
  "race_conditions",
  "race_start_timings",
  "exhibition_data",
  "race_odds",
  "race_payouts",
  "racer_profiles",
  "racer_series_points",
  "venue_entry_course_stats",
  "venue_motor_stats",
  "external_predictions",
  "race_pit_reports",
  "race_special_notes",
  "race_series",
  "racer_period_stats",
]);

/**
 * 出走表の拡張列（マイグレーション081）。race_entries の行ごと・race_conditions のレースごとの、取得済みの件数。
 * 分母は、開催中止(confirmed)を除いたレースの出走行・レース。
 */
const preRaceFieldsSql = ({ fromDate, toDate }) => `
with e as (
  select r.race_date::text as d,
      count(*) as entries,
      count(*) filter (where x.weight_kg is not null) as weight_kg,
      count(*) filter (where x.f_count is not null) as f_count,
      count(*) filter (where x.l_count is not null) as l_count,
      count(*) filter (where x.branch is not null) as branch,
      count(*) filter (where x.is_absent is not null) as is_absent
  from races r
  join race_entries x on x.race_id = r.race_id
  where r.race_date between ${fromDate} and ${toDate}
    and r.cancellation_status is distinct from 'confirmed'
  group by r.race_date
), c as (
  select r.race_date::text as d,
      count(*) as races,
      count(*) filter (where x.race_distance_m is not null) as race_distance_m,
      count(*) filter (where x.race_labels is not null) as race_labels,
      count(*) filter (where x.series_day is not null) as series_day
  from races r
  left join race_conditions x on x.race_id = r.race_id
  where r.race_date between ${fromDate} and ${toDate}
    and r.cancellation_status is distinct from 'confirmed'
  group by r.race_date
)
select coalesce(e.d, c.d) as d,
    coalesce(e.entries, 0) as entries,
    coalesce(e.weight_kg, 0) as weight_kg,
    coalesce(e.f_count, 0) as f_count,
    coalesce(e.l_count, 0) as l_count,
    coalesce(e.branch, 0) as branch,
    coalesce(e.is_absent, 0) as is_absent,
    coalesce(c.races, 0) as races,
    coalesce(c.race_distance_m, 0) as race_distance_m,
    coalesce(c.race_labels, 0) as race_labels,
    coalesce(c.series_day, 0) as series_day
from e full join c on c.d = e.d
order by 1`;

/**
 * ピットレポート（選手コメント。マイグレーション085）。対象レース = SG（全レース）・G1・G2（7R以降）
 * （scripts/lib/pitReportRows.js の isPitReportCandidate と同じ規則）で、開催中止(confirmed)を除く。
 * with_report = race_pit_reports の行がある（公開済み・対象外のいずれかを、ページの表示で確認できた）。
 * 公開されないまま（行が無い）のレースが、欠損。
 */
const pitReportsSql = ({ fromDate, toDate }) => `
select r.race_date::text as d,
    count(*) as expected,
    count(*) filter (where p.race_id is not null) as with_report,
    count(*) filter (where p.status = 'published') as published
from races r
left join race_pit_reports p on p.race_id = r.race_id
where r.race_date between ${fromDate} and ${toDate}
  and r.cancellation_status is distinct from 'confirmed'
  and (r.race_grade = 'SG' or (r.race_grade in ('G1', 'G2') and r.race_number >= 7))
group by r.race_date
order by 1`;

/**
 * 節（race_series。マイグレーション084）。期待件数 = 開催があった会場×日、covered = その会場×日を含む節がある
 * （start_date <= race_date <= end_date）。節が取り込まれていない期間・会場が、欠損。
 */
const raceSeriesSql = ({ fromDate, toDate }) => `
select d,
    count(*) as expected,
    count(*) filter (where covered) as covered
from (
  select r.race_date::text as d, r.venue_code,
      bool_or(s.venue_code is not null) as covered
  from races r
  left join race_series s
    on s.venue_code = r.venue_code and r.race_date between s.start_date and s.end_date
  where r.race_date between ${fromDate} and ${toDate}
    and r.cancellation_status is distinct from 'confirmed'
  group by r.race_date, r.venue_code
) t
group by d
order by 1`;

/**
 * 選手の期別成績（racer_period_stats。マイグレーション083）。期待件数 = その日に出走する選手（登録番号）の数、
 * with_stats = いずれかの期の成績がある選手。新人（期別成績の公開前）は欠損に数える（公開は最大約2か月遅れる）。
 */
const racerPeriodStatsSql = ({ fromDate, toDate }) => `
with s as (
  select distinct racer_id from racer_period_stats
)
select r.race_date::text as d,
    count(distinct e.racer_id) as expected,
    count(distinct e.racer_id) filter (where s.racer_id is not null) as with_stats
from races r
join race_entries e on e.race_id = r.race_id
left join s on s.racer_id = e.racer_id
where r.race_date between ${fromDate} and ${toDate}
  and r.cancellation_status is distinct from 'confirmed'
  and e.racer_id is not null
group by r.race_date
order by 1`;

/** 空でないことを確認するテーブルごとの「行があるか」（exists は、先頭の1行を見つけた時点で終わる） */
const tableRowsSql = () => `
select jsonb_build_object(
${TABLE_ROWS_TABLES.map((t) => `  '${t}', exists (select 1 from ${t})`).join(",\n")}
) as o`;

/**
 * 出走表の複製検知（BOA-422・BOA-423）。同じ会場・同じレース番号で、直近21日以内の別の日と
 * 「艇番→登録番号」の組み合わせが完全一致するレースを、出走表が過去日のデータで汚染された疑いとして数える。
 *
 * 除外（誤検知を避ける）:
 *   - 開催中止(confirmed)のレースは、複製元・複製先のどちらからも外す（順延は、前日の出走表がそのまま
 *     翌日の同じ節で使われるため、正常に完全一致する）
 *   - 結果(race_results)が無いレースも、両側から外す（順延の空スタブ・未確定）
 *   - 1レースだけの一致は数えない（同じ節の別日に、同じ6人が同じ枠で再度組まれることが実際にある。
 *     2026-01-22 常滑 R6 が実例で、公式Bファイルでも一致が正しい）。汚染は必ず複数レースにまたがる
 *
 * 期待件数（分母）= その日の会場×日、clean（分子）= 複製の疑いが無い会場×日。
 */
const entriesDuplicatesSql = ({ fromDate, toDate }) => `
with win as (
  select r.race_id, r.race_date, r.venue_code, r.race_number,
      exists (select 1 from race_results rr where rr.race_id = r.race_id) as has_result,
      md5(string_agg(e.boat_number::text || ':' || coalesce(e.racer_id::text, '-'), ',' order by e.boat_number)) as sig
  from races r
  join race_entries e on e.race_id = r.race_id
  where r.race_date between (${fromDate} - 21) and ${toDate}
    and r.cancellation_status is distinct from 'confirmed'
  group by r.race_id, r.race_date, r.venue_code, r.race_number
), dup as (
  select a.race_date, a.venue_code, a.race_number
  from win a
  join win b on b.venue_code = a.venue_code and b.race_number = a.race_number
    and b.race_date < a.race_date and a.race_date - b.race_date <= 21
    and b.sig = a.sig and b.has_result
  where a.race_date between ${fromDate} and ${toDate} and a.has_result
  group by a.race_date, a.venue_code, a.race_number
), flagged as (
  select race_date, venue_code
  from dup group by race_date, venue_code having count(*) >= 2
), base as (
  select r.race_date, r.venue_code
  from races r
  join race_entries e on e.race_id = r.race_id
  where r.race_date between ${fromDate} and ${toDate}
    and r.cancellation_status is distinct from 'confirmed'
  group by r.race_date, r.venue_code
)
select b.race_date::text as d,
    count(*) as venue_days,
    count(*) filter (where f.venue_code is null) as clean_venue_days
from base b
left join flagged f on f.race_date = b.race_date and f.venue_code = b.venue_code
group by b.race_date
order by 1`;

/**
 * 中止の誤検出（BOA-512）: 確定中止（cancellation_status='confirmed'）なのに、着順（rank1）のある結果が入っている
 * レースを日別に数える。確定中止は「開催されなかった」ことを表すため、原理的に0件のはず。2026-09-12に、結果の
 * 読み取りの一過性の失敗で「結果のあるレースを除く」ガードが外れ、32本が誤って confirmed になった（原因は PR #743 で
 * 修正済み）。race_results は race_id が主キーのため、LEFT JOIN で行は増えない。結果の行があっても rank1 が NULL
 * （中止・返還の行。マイグレーション078）は結果なしとして扱う。
 * consistent_races = races − confirmed_with_result（NULL を含む論理式の否定で数えると、cancellation_status が NULL の
 * 行を取りこぼすため、引き算で出す）
 */
const cancellationWithResultSql = ({ fromDate, toDate }) => `
select r.race_date::text as d,
    count(*) as races,
    count(*) filter (where r.cancellation_status = 'confirmed' and rr.rank1 is not null) as confirmed_with_result,
    count(*) - count(*) filter (where r.cancellation_status = 'confirmed' and rr.rank1 is not null) as consistent_races
from races r
left join race_results rr on rr.race_id = r.race_id
where r.race_date between ${fromDate} and ${toDate}
group by r.race_date
order by 1`;

/**
 * 鮮度・存在の項目（classification: freshness）。関数は { 項目のキー: { applicable, ok, observed } } の
 * オブジェクトを返す。applicable=その日に書かれるはずか（前日にレースが無い等で書かれないのが正常なら false）、
 * ok=締めの時点で書かれているか、observed=観測値（最終の更新時刻・日付・件数。通知の文に出す）。
 *
 *   kind
 *     since     更新時刻が、評価の終端（前日）の 21:00 JST 以降（夜の集計は前日 22:00〜当日 01:00 JST に動く。
 *               前日の朝や日中に手で流した分は数えない）
 *     date_end  日付の列が、評価の終端（前日）以降（その日のレースまで集計した）
 *     date_prev 日付の列が、評価の終端の前日（前々日）以降（材料が翌朝に確定するため、夜の集計の時点では前日分が入らない表）
 *     date_next 日付の列が、評価の終端の翌日（当日）以降（当日の 0 時台に動いた集計が書く日付）
 *     count     件数が1以上
 *   observed   観測値の式（スカラーの副問い合わせ。表は必ず1つ）
 *   applicable 書かれるはずかの式（既定 true）。y.* は前日の開催の有無（nightlyFreshnessSql の y）
 *   table      読む表（PGlite の検証で最小のスキーマを作るため・説明用）
 *
 * @typedef {{key: string, table: string, kind: "since"|"date_end"|"date_prev"|"date_next"|"count", observed: string, applicable?: string}} FreshnessItem
 */

/** 夜の集計（前日 22:00〜当日 01:00 JST）が書く表。締めは 06:30（data_health の 06:35 の実行で見る） */
export const NIGHTLY_FRESHNESS_ITEMS = Object.freeze([
  // 会場ごとに delete→insert（毎晩、created_at が新しくなる）
  ...[
    "outcome_distribution",
    "exhibition_time_top_stats",
    "losing_technique_stats",
    "nige_outcome_distribution",
    "winning_technique_stats",
    "top_start_stats",
  ].map((t) => ({
    key: t,
    table: t,
    kind: "since",
    observed: `(select max(created_at) from ${t})`,
  })),
  // 24会場を delete→insert。時刻の列が無く、last_updated（実行した日の JST の日付）で見る
  {
    key: "venue_technique_period_stats",
    table: "venue_technique_period_stats",
    kind: "date_next",
    observed: "(select max(last_updated) from venue_technique_period_stats)",
  },
  // 差分だけ upsert（値の変わらない日は updated_at が動かない）。window_end（集計した最後のレースの日）で見る。
  // 材料の race_results.actual_course_* は Kファイルの同期（kfile_sync、07:00 JST）が翌朝に書くため、00:50 JST の集計の
  // 時点では前日の分が無く、window_end は前々日になる（aggregate-course-baseline-stats の実行ログ: 03:17〜05:50 JST に
  // 動いた夜は全て前々日、2026-10-20 の data-accuracy-verifier）。前々日まで進んだかで見る
  ...["st_course_baseline", "nige_second_by_course"].map((t) => ({
    key: t,
    table: t,
    kind: "date_prev",
    observed: `(select max(window_end) from ${t})`,
    applicable: "y.had_results",
  })),
  // calculate-accuracy の5本のうち、画面が読むキャッシュ（models は画面の代わりの経路だけが読むので見ない）
  ...[
    ["accuracy_summary", "accuracy_cache"],
    ["unified_model_accuracy", "accuracy_cache"],
    ["unified_volatility_accuracy", "accuracy_cache"],
  ].map(([key, t]) => ({
    key,
    table: t,
    kind: "since",
    observed: `(select max(updated_at) from ${t} where key = '${key}')`,
  })),
  ...["race_history_cache", "racer_grade_cache"].map((t) => ({
    key: t,
    table: t,
    kind: "since",
    observed: `(select max(updated_at) from ${t})`,
  })),
  // update-moriarty: 賭けた（skip 以外の推奨で結果のある）レースがあった日だけ、その日の行ができる
  {
    key: "model_performance_daily",
    table: "model_performance_daily",
    kind: "date_end",
    observed:
      "(select max(date) from model_performance_daily where model_id = 'moriarty')",
    applicable: "y.had_moriarty_bets",
  },
  // scrape-point-rank（GHA と Vercel の point_rank のどちらが書いてもよい）: 得点率の表が出るのは SG・G1 の4日目以降だけ
  // （scripts/daily/scrape-point-rank.js の TABLE_EXPECTED_GRADES と同じ規則）
  {
    key: "racer_series_points",
    table: "racer_series_points",
    kind: "since",
    observed: "(select max(scraped_at) from racer_series_points)",
    applicable: "y.had_point_rank",
  },
  // aggregate-stats: venues は全会場を update。他の2つは差分だけで、前日に結果があれば必ずどこかの行が変わる
  {
    key: "venues",
    table: "venues",
    kind: "since",
    observed: "(select max(updated_at) from venues)",
  },
  {
    key: "racer_aggregated_stats",
    table: "racer_aggregated_stats",
    kind: "since",
    observed: "(select max(calculated_at) from racer_aggregated_stats)",
    applicable: "y.had_results",
  },
  {
    key: "venue_grade_boat_stats",
    table: "venue_grade_boat_stats",
    kind: "since",
    observed: "(select max(updated_at) from venue_grade_boat_stats)",
    applicable: "y.had_results",
  },
]);

/** 朝の生成（当日分）。締めは 07:50（data_health_morning の 07:55 の実行で見る）。t は当日の中止でないレース */
export const MORNING_FRESHNESS_ITEMS = Object.freeze([
  {
    key: "sonar_racecard",
    table: "analogy_v16_snapshots",
    kind: "count",
    observed:
      "(select count(*) from analogy_v16_snapshots s where s.stage = 'racecard' and s.race_id in (select race_id from t))",
    applicable: "(select count(*) > 0 from t)",
  },
  {
    key: "poirot_predictions",
    table: "poirot_predictions",
    kind: "count",
    observed:
      "(select count(distinct p.race_id) from poirot_predictions p where p.race_id in (select race_id from t))",
    applicable: "(select count(*) > 0 from t)",
  },
  {
    key: "moriarty_recommendations",
    table: "bet_recommendations",
    kind: "count",
    observed:
      "(select count(*) from bet_recommendations b where b.model_id = 'moriarty' and b.race_id in (select race_id from t))",
    applicable: "(select count(*) > 0 from t)",
  },
]);

const okExpr = (item, toDate) => {
  const o = item.observed;
  if (item.kind === "since") return `${o} >= (select since from w)`;
  if (item.kind === "date_end") return `${o} >= ${toDate}::date`;
  if (item.kind === "date_prev") return `${o} >= ${toDate}::date - 1`;
  if (item.kind === "date_next") return `${o} >= ${toDate}::date + 1`;
  return `${o} > 0`;
};

const freshnessObject = (items, toDate) =>
  `jsonb_build_object(
${items
  .map(
    (item) =>
      `  '${item.key}', jsonb_build_object('applicable', ${item.applicable ?? "true"}, 'ok', coalesce(${okExpr(item, toDate)}, false), 'observed', ${item.observed})`,
  )
  .join(",\n")}
)`;

/**
 * 夜の集計の鮮度。p_to は評価の終端（前日）。since = 前日 21:00 JST。
 * y: 前日の開催の有無（書かれないのが正常な日を applicable=false にする）
 */
const nightlyFreshnessSql = ({ toDate }) => `
with w as (
  select ((${toDate}::date + time '21:00') at time zone 'Asia/Tokyo') as since
), y as (
  select
    exists (
      select 1 from races r join race_results rr on rr.race_id = r.race_id
      where r.race_date = ${toDate}::date and r.cancellation_status is distinct from 'confirmed' and rr.rank1 is not null
    ) as had_results,
    exists (
      select 1 from bet_recommendations b
      join races r on r.race_id = b.race_id
      join race_results rr on rr.race_id = b.race_id
      where r.race_date = ${toDate}::date and b.model_id = 'moriarty' and b.recommendation <> 'skip' and rr.rank1 is not null
    ) as had_moriarty_bets,
    exists (
      select 1 from races r join race_conditions c on c.race_id = r.race_id
      where r.race_date = ${toDate}::date and r.race_grade in ('SG', 'G1') and c.series_day >= 4
        and r.cancellation_status is distinct from 'confirmed'
    ) as had_point_rank
)
select ${freshnessObject(NIGHTLY_FRESHNESS_ITEMS, toDate)} || jsonb_build_object('_since', (select since from w)) as o
from y`;

/** 朝の生成の件数。p_to は当日（data_health_morning は評価の終端を当日にする） */
const morningFreshnessSql = ({ toDate }) => `
with t as (
  select race_id from races
  where race_date = ${toDate}::date and cancellation_status is distinct from 'confirmed'
)
select ${freshnessObject(MORNING_FRESHNESS_ITEMS, toDate)} as o`;

/**
 * @typedef {Object} DataHealthFunction
 * @property {string} name 関数名（public スキーマ）
 * @property {Array<{name: string, type: "date"}>} args 引数
 * @property {"rows"|"object"} shape
 * @property {string} description COMMENT ON FUNCTION の内容（1行）
 * @property {string} migration DDLを含むマイグレーションのファイル名
 * @property {(slots: {fromKey: string, toKeyExclusive: string, fromDate: string, toDate: string}) => string} body 固定のSELECT
 * @property {string} [orderColumn] rows の並び順の列（既定 d）
 * @property {ReadonlyArray<FreshnessItem>} [items] 鮮度の関数の項目（checks.js の freshness の items が参照する）
 */

const FROM_TO = Object.freeze([
  { name: "p_from", type: "date" },
  { name: "p_to", type: "date" },
]);

/** @type {ReadonlyArray<DataHealthFunction>} */
export const DATA_HEALTH_FUNCTIONS = Object.freeze([
  {
    name: "data_health_coverage",
    args: FROM_TO,
    shape: "rows",
    description:
      "データ健全性の日次監視: 存在充足率（結果・着順・実進入・決まり手・レース種別・ST・展示・オッズ・全券種オッズ）の日別集計。定義は scripts/lib/dataHealth/coverageSpec.js",
    migration: "105_data_health_coverage_exhibition_row.sql",
    body: buildCoverageSql,
  },
  {
    name: "data_health_pre_race_fields",
    args: FROM_TO,
    shape: "rows",
    description:
      "データ健全性の日次監視: 出走表の拡張列（081。登録体重・支部・F数・L数・欠場・距離・ラベル）と日目（series_day）の取得済み件数",
    migration: "121_data_health_pre_race_series_day.sql",
    body: preRaceFieldsSql,
  },
  {
    name: "data_health_pit_reports",
    args: FROM_TO,
    shape: "rows",
    description:
      "データ健全性の日次監視: ピットレポート（085）の対象レース（SG全レース・G1・G2の7R以降）の取得済み件数",
    migration: "089_data_health_functions.sql",
    body: pitReportsSql,
  },
  {
    name: "data_health_race_series",
    args: FROM_TO,
    shape: "rows",
    description:
      "データ健全性の日次監視: 節（race_series、084）が、開催のあった会場×日を覆っている件数",
    migration: "089_data_health_functions.sql",
    body: raceSeriesSql,
  },
  {
    name: "data_health_racer_period_stats",
    args: FROM_TO,
    shape: "rows",
    description:
      "データ健全性の日次監視: 出走した選手のうち、期別成績（racer_period_stats、083）がある選手の数",
    migration: "089_data_health_functions.sql",
    body: racerPeriodStatsSql,
  },
  {
    name: "data_health_monthly_result",
    args: [{ name: "p_to", type: "date" }],
    shape: "rows",
    description:
      "データ健全性の週次監視: 月別の結果充足率（全期間。p_to 以前）。定義は scripts/lib/dataHealth/coverageSpec.js",
    migration: "089_data_health_functions.sql",
    orderColumn: "month",
    // 月別は p_to だけを使う（期間の下端なし）
    body: ({ toDate }) => buildMonthlySql({ toDate }),
  },
  {
    name: "data_health_entries_duplicates",
    args: FROM_TO,
    shape: "rows",
    description:
      "データ健全性の日次監視: 出走表が過去日のデータで汚染された疑い（同一会場・同一レース番号で、直近21日以内の別の日と艇番→登録番号が完全一致するレースが2つ以上ある会場×日）。BOA-422・BOA-423",
    migration: "100_data_health_entries_duplicates.sql",
    body: entriesDuplicatesSql,
  },
  {
    name: "data_health_cancellation_with_result",
    args: FROM_TO,
    shape: "rows",
    description:
      "データ健全性の日次監視: 確定中止（cancellation_status='confirmed'）なのに着順（rank1）のある結果が入っているレース（中止の誤検出。原理的に0件）。BOA-512",
    migration: "107_data_health_cancellation_with_result.sql",
    body: cancellationWithResultSql,
  },
  {
    name: "data_health_nightly_freshness",
    args: [{ name: "p_to", type: "date" }],
    shape: "object",
    description:
      "データ健全性の日次監視: 夜の集計（前日22時〜当日1時 JST）が書く表の鮮度（最終の更新時刻・日付が締めまでに進んだか）。p_to は前日。項目は scripts/lib/dataHealth/functions.js の NIGHTLY_FRESHNESS_ITEMS",
    migration: "170_data_health_freshness.sql",
    items: NIGHTLY_FRESHNESS_ITEMS,
    body: nightlyFreshnessSql,
  },
  {
    name: "data_health_morning_freshness",
    args: [{ name: "p_to", type: "date" }],
    shape: "object",
    description:
      "データ健全性の朝の監視: 当日の龍神ソナー（出走表の段）・ポアロ・モリアーティの件数。p_to は当日。項目は scripts/lib/dataHealth/functions.js の MORNING_FRESHNESS_ITEMS",
    migration: "170_data_health_freshness.sql",
    items: MORNING_FRESHNESS_ITEMS,
    body: morningFreshnessSql,
  },
  {
    name: "data_health_table_rows",
    args: [],
    shape: "object",
    description:
      "データ健全性の日次監視: 主要テーブルに1行以上あるか（空テーブルの検知）。対象テーブルは関数の中の固定の一覧",
    migration: "089_data_health_functions.sql",
    body: tableRowsSql,
  },
]);

export const functionByName = (name) =>
  DATA_HEALTH_FUNCTIONS.find((f) => f.name === name);

/** 関数の型つきのシグネチャ（例: data_health_coverage(date, date)） */
export const signatureOf = (fn) =>
  `${fn.name}(${fn.args.map((a) => a.type).join(", ")})`;

/** rows は日別の行の配列、object は1つのオブジェクトを、jsonb にする式（bodyの外側） */
function wrapBody(fn, bodySql) {
  if (fn.shape === "object") {
    return `select q.o from (${bodySql}\n) q`;
  }
  const order = fn.orderColumn ?? "d";
  return `select coalesce(jsonb_agg(to_jsonb(q) order by q.${order}), '[]'::jsonb)\n    from (${bodySql}\n    ) q`;
}

/** 関数のDDL（CREATE OR REPLACE ＋ REVOKE ＋ GRANT ＋ COMMENT）。マイグレーションに、そのまま貼れる */
export function renderFunctionDdl(fn) {
  const sig = signatureOf(fn);
  const params = fn.args.map((a) => `${a.name} ${a.type}`).join(", ");
  const guard =
    fn.args.length === 2
      ? `  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > ${MAX_RANGE_DAYS - 1} THEN
    RAISE EXCEPTION '${fn.name}: 期間が不正です（from <= to、最大${MAX_RANGE_DAYS}日）: % 〜 %', p_from, p_to;
  END IF;
`
      : fn.args.length === 1
        ? `  IF p_to IS NULL THEN
    RAISE EXCEPTION '${fn.name}: p_to が NULL です';
  END IF;
`
        : "";
  const body = fn.body(FUNCTION_COVERAGE_SLOTS);
  return `CREATE OR REPLACE FUNCTION ${fn.name}(${params})
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
SET statement_timeout = '60s'
AS $data_health$
BEGIN
${guard}  RETURN (
    ${wrapBody(fn, body)}
  );
END
$data_health$;

REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ${sig} TO service_role;
COMMENT ON FUNCTION ${sig} IS '${fn.description.replace(/'/g, "''")}';
`;
}

/**
 * 関数と同じSQLを、日付リテラルで1本のSELECTにする（手元の実測CLI・関数の適用前の確認用）。
 * 結果は1行1列（result）の jsonb。
 *
 * @param {DataHealthFunction} fn
 * @param {{from?: string, to?: string}} range 日付（YYYY-MM-DD）。引数が p_to だけの関数は to のみ使う。引数なしの関数は不要
 */
export function renderInlineSql(fn, { from, to }) {
  // 引数を持たない関数（data_health_table_rows）は、日付を使わない
  const slots = to ? literalCoverageSlots(from ?? to, to) : {};
  return `select (${wrapBody(fn, fn.body(slots))}\n) as result`;
}
