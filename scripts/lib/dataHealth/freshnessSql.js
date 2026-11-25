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
 *     date_lag  日付の列が、評価の終端の lagDays 日前以降（元のデータそのものが数日遅れる表。Search Console 等）
 *     count     件数が1以上
 *   observed   観測値の式（スカラーの副問い合わせ。表は必ず1つ）
 *   applicable 書かれるはずかの式（既定 true）。y.* は前日の開催の有無（nightlyFreshnessSql の y）
 *   table      読む表（PGlite の検証で最小のスキーマを作るため・説明用）
 *
 * @typedef {{key: string, table: string, kind: "since"|"date_end"|"date_prev"|"date_next"|"date_lag"|"count", lagDays?: number, observed: string, applicable?: string}} FreshnessItem
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
  // Search Console の日別（growth-gsc-daily。毎日 JST 10 時台に直近7日を取り直す）。GSC は PT の日付で2〜3日遅れる。
  // 06:35 JST の評価（p_to = 前日 D-1）の時点で、前回（D-1 の 10 時台）が取れていれば max(date) は D-3。
  // max(date) >= p_to - 3（= D-4）で1日の余裕を見る。止まった日は2日続けて遅れた時点で鳴る
  // （11/25 06:35 の時点の max(date) は 11/23＝D-2。余裕の日数は目安・根拠なし。数日の値を見て直す）。
  // ずれは observed でなく判定の側に持たせる（通知の「最終」に実際の日付を出すため）
  {
    key: "growth_gsc_daily",
    table: "growth_gsc_daily",
    kind: "date_lag",
    lagDays: 3,
    observed: "(select max(date) from growth_gsc_daily)",
  },
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
  if (item.kind === "date_lag") return `${o} >= ${toDate}::date - ${item.lagDays}`;
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

export { nightlyFreshnessSql, morningFreshnessSql };
