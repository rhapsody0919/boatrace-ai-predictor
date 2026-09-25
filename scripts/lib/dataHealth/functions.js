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
      count(*) filter (where x.race_labels is not null) as race_labels
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
    coalesce(c.race_labels, 0) as race_labels
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

/***
 * @typedef {Object} DataHealthFunction
 * @property {string} name 関数名（public スキーマ）
 * @property {Array<{name: string, type: "date"}>} args 引数
 * @property {"rows"|"object"} shape
 * @property {string} description COMMENT ON FUNCTION の内容（1行）
 * @property {string} migration DDLを含むマイグレーションのファイル名
 * @property {(slots: {fromKey: string, toKeyExclusive: string, fromDate: string, toDate: string}) => string} body 固定のSELECT
 * @property {string} [orderColumn] rows の並び順の列（既定 d）
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
    migration: "089_data_health_functions.sql",
    body: buildCoverageSql,
  },
  {
    name: "data_health_pre_race_fields",
    args: FROM_TO,
    shape: "rows",
    description:
      "データ健全性の日次監視: 出走表の拡張列（081。登録体重・支部・F数・L数・欠場・距離・ラベル）の取得済み件数",
    migration: "089_data_health_functions.sql",
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
