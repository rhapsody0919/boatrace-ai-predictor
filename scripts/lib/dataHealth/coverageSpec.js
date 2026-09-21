/**
 * 存在充足率（完了の定義A）の指標と、その集計SQLの正本（data-health-report.js と、汎用の日次監視
 * data_health（scripts/lib/dataHealth/）が共有する。二重実装しない）。
 *
 * 分母の定義（BOA-381）:
 *   - rank4〜6: 失格・欠場・転覆等で6艇が完走しないレースは、公式が最後の順位を付けない（欠損ではない）。
 *     艇別の着欄（race_start_timings.finish_mark）で完走艇数を確定できるレースは、完走艇数まで順位が
 *     付いているかで判定する。確定できずrank4〜6に欠けがあるレースは「判定不能」として分母外に件数を出す
 *   - 全券種オッズ（trio・exacta・quinella・wide、5種すべて）: 全通り取得の開始日（2026-09-17）以降のみが
 *     期待件数の対象。それ以前の日は「対象外(取得開始前)」として分母から外す。trifecta_all は対象外を設けない
 *
 * SQLは、日付を「スロット」（SQLの式の文字列）で受ける。同じテンプレートから、次の2通りを作る:
 *   - 日付リテラル（data-health-report.js・手元の実測CLI）: literalCoverageSlots(from, to)
 *   - 関数の引数（マイグレーション089の data_health_coverage(p_from, p_to)）: FUNCTION_COVERAGE_SLOTS
 * マイグレーションの関数本体は、このテンプレートから生成し、verify:data-health-job が一致を機械検査する。
 */
import { addDaysToDateString } from "../dateUtils.js";

// 全券種オッズの各列。空オブジェクト・空配列・JSONのnullは「未取得」と扱う
export const ALL_ODDS_COLUMNS = [
  "trifecta_all",
  "trio_all",
  "exacta_all",
  "quinella_all",
  "wide_all",
];

// 全券種オッズのうち、trio・exacta・quinella・wideの4種は、全通り取得の開始（2026-09-17、ADR-0057・BOA-344）より
// 前は時系列で取り直せない。期待件数の対象は取得開始日以降のみ（2026-09-21にユーザーが承認、orchestration.md）。
// それ以前の日は分母から外し「対象外」と明示する。
// trifecta_all は、2026-07-12以降のレースに保存があり（2026-09-01〜09-16の各日でも76〜100%）、
// 直近14日の全日が期間内のため、取得開始日による対象外は設けない
export const ODDS_FULL_GRID_SINCE = "2026-09-17";

// 1レースの艇数。艇別の着欄（race_start_timings）が6艇分そろったレースだけ、完走艇数を確定できる
export const BOATS_PER_RACE = 6;

// since: 期待件数の対象を、この日（含む）以降に限る。denomKey: 指標ごとの分母の列（既定はdenom）
export const COVERAGE_METRICS = [
  { key: "result", label: "結果(rank1)" },
  {
    key: "rank4_6",
    label: "着順4位以降(完走艇数まで)",
    denomKey: "rank_denom",
  },
  { key: "actual_course", label: "実進入(actual_course_1)" },
  { key: "winning_technique", label: "決まり手" },
  { key: "race_stage", label: "レース種別" },
  { key: "st_row", label: "ST(行の有無)" },
  { key: "st_value", label: "ST(start_timing非NULL)" },
  { key: "exhibition_row", label: "展示(行の有無)" },
  { key: "exhibition_time", label: "展示(exhibition_time非NULL)" },
  { key: "odds", label: "オッズ(1件以上)" },
  {
    key: "odds_all",
    label: "全券種オッズ(5種すべて)",
    since: ODDS_FULL_GRID_SINCE,
  },
  ...ALL_ODDS_COLUMNS.map((c) => ({
    key: c,
    label: `└ ${c}`,
    ...(c === "trifecta_all" ? {} : { since: ODDS_FULL_GRID_SINCE }),
  })),
];

const nonEmptyJson = (col) =>
  `(x.${col} is not null and x.${col} not in ('null'::jsonb, '{}'::jsonb, '[]'::jsonb))`;

/**
 * 期間 [from, to]（両端を含む）を、日付リテラルのスロットにする（日付は検証済みの YYYY-MM-DD のみ）。
 * race_id は「YYYY-MM-DD-会場-R」形式のため、期間の上端は翌日の文字列との大小比較で表す
 */
export function literalCoverageSlots(from, to) {
  return {
    fromKey: `'${from}'`,
    toKeyExclusive: `'${addDaysToDateString(to, 1)}'`,
    fromDate: `'${from}'`,
    toDate: `'${to}'`,
  };
}

/** マイグレーション089の関数 data_health_coverage(p_from date, p_to date) の引数を使うスロット */
export const FUNCTION_COVERAGE_SLOTS = Object.freeze({
  fromKey: "p_from::text",
  toKeyExclusive: "(p_to + 1)::text",
  fromDate: "p_from",
  toDate: "p_to",
});

/**
 * 存在充足率（日別）の集計SQL。分母は開催中止(confirmed)を除いたレース。
 *
 * race_oddsは全券種のjsonbが大きいため、レースごとに1回だけ読んで集約する（レースごとの
 * 相関サブクエリを列数分繰り返すと読み取りが数倍になる。Disk IO予算への配慮）。
 *
 * rank4〜6の判定（BOA-381）: 失格・欠場・転覆などで6艇が完走しないレースは、公式が最後の順位を
 * 付けない（rank6・rank5・rank4がNULLになるのが正しい）。そのため「全レースにrank4〜6がある」を
 * 分母にせず、完走艇数から「順位が付くべき最大順位」を決める。
 *   完走艇数を確定できる = 艇別の着欄（race_start_timings.finish_mark、マイグレーション077）が
 *     ${BOATS_PER_RACE}艇分そろっている（確定できるのは、077以降に取得・修正したレースのみ）。
 *     確定したレースは、完走艇数（finish_rank非NULLの艇数）まで順位が付いているかで判定する
 *   確定できない・rank4〜6がそろっている = 充足（そろっていれば欠損ではない）
 *   確定できない・rank4〜6に欠けがある = 判定不能（欠損か非完走かを区別できない。分母に入れず件数を別に出す）
 * 分母外: 完走3艇以下（rank4以降は付かない）・結果なし（rank1が無い。「結果(rank1)」の指標で計上）
 *
 * @param {{fromKey: string, toKeyExclusive: string, fromDate: string, toDate: string}} slots
 */
export function buildCoverageSql(slots) {
  const { fromKey, toKeyExclusive, fromDate, toDate } = slots;
  const oddsAggregates = ALL_ODDS_COLUMNS.map(
    (c) => `bool_or(${nonEmptyJson(c)}) as has_${c}`,
  ).join(",\n      ");
  const allOddsAll = ALL_ODDS_COLUMNS.map(nonEmptyJson).join(" and ");
  const perTypeCount = ALL_ODDS_COLUMNS.map(
    (c) =>
      `count(*) filter (where active and coalesce(has_${c}, false)) as ${c}`,
  ).join(",\n    ");

  return `
with o as (
  select x.race_id,
      bool_or(${allOddsAll}) as has_odds_all,
      ${oddsAggregates}
  from race_odds x
  where x.race_id >= ${fromKey} and x.race_id < ${toKeyExclusive}
  group by x.race_id
), fin as (
  select x.race_id, count(*) as n_rows, count(x.finish_mark) as n_mark,
      count(x.finish_rank) as n_fin, count(x.start_timing) as n_st_value
  from race_start_timings x
  where x.race_id >= ${fromKey} and x.race_id < ${toKeyExclusive}
  group by x.race_id
), b as (
  select r.race_id, r.race_date,
      (r.cancellation_status is distinct from 'confirmed') as active,
      rr.rank1, rr.rank4, rr.rank5, rr.rank6, rr.actual_course_1, rr.winning_technique,
      (rr.rank1 is not null)::int + (rr.rank2 is not null)::int + (rr.rank3 is not null)::int
        + (rr.rank4 is not null)::int + (rr.rank5 is not null)::int + (rr.rank6 is not null)::int as n_ranked,
      rc.race_stage,
      coalesce(f.n_rows, 0) as n_st_rows,
      coalesce(f.n_st_value, 0) as n_st_value,
      coalesce(f.n_rows = ${BOATS_PER_RACE} and f.n_mark = ${BOATS_PER_RACE}, false) as fin_known,
      f.n_fin,
      exists(select 1 from exhibition_data x where x.race_id = r.race_id) as has_exhibition_row,
      -- check-exhibition-gap-rate.js（BOA-356）と同じ基準: 1艇でも展示タイムが入っていれば取得済み
      (select count(*) from exhibition_data x where x.race_id = r.race_id and x.exhibition_time is not null) as n_exh_time,
      (o.race_id is not null) as has_odds,
      o.has_odds_all,
      ${ALL_ODDS_COLUMNS.map((c) => `o.has_${c}`).join(", ")}
  from races r
  left join race_results rr on rr.race_id = r.race_id
  left join race_conditions rc on rc.race_id = r.race_id
  left join fin f on f.race_id = r.race_id
  left join o on o.race_id = r.race_id
  where r.race_date between ${fromDate} and ${toDate}
), c as (
  select b.*,
      case
        when not active then null
        when fin_known and n_fin >= 4 then 'determined'
        when fin_known then 'le3'
        when rank1 is null then 'no_result'
        when rank4 is not null and rank5 is not null and rank6 is not null then 'full'
        else 'undetermined'
      end as rank_class
  from b
)
select race_date::text as d,
    count(*) as total,
    count(*) filter (where not active) as excluded,
    count(*) filter (where active) as denom,
    count(*) filter (where active and rank1 is not null) as result,
    -- rank4_6: 分子=順位が付くべき最大順位まで付いている（確定=完走艇数まで、未確定=rank4〜6がそろっている）
    count(*) filter (where rank_class in ('determined', 'full')) as rank_denom,
    count(*) filter (where rank_class = 'full'
        or (rank_class = 'determined' and rank4 is not null
            and (n_fin < 5 or rank5 is not null) and (n_fin < 6 or rank6 is not null))) as rank4_6,
    count(*) filter (where rank_class = 'determined') as rank_determined,
    count(*) filter (where rank_class = 'full') as rank_full,
    count(*) filter (where rank_class = 'le3') as rank_le3,
    count(*) filter (where rank_class = 'no_result') as rank_no_result,
    count(*) filter (where rank_class = 'undetermined') as rank_undetermined,
    -- 判定不能のうち、STと展示が5艇分以下（欠場艇がいる可能性が高い。非完走の目安であり確定ではない）
    count(*) filter (where rank_class = 'undetermined'
        and n_st_rows between 1 and ${BOATS_PER_RACE - 1} and n_exh_time between 1 and ${BOATS_PER_RACE - 1}) as rank_undetermined_absent_hint,
    -- 参考（BOA-362）: 順位に非完走艇が入っている。確定=艇別の着欄で、完走艇数より多くの順位が付いている。
    -- 疑い=着欄を確定できないレースで6着まで付いているのに展示タイムが5艇分以下（欠場艇が着順に入っている可能性。展示の欠損も含む上限値）
    count(*) filter (where rank_class in ('determined', 'le3') and n_ranked > n_fin) as rank_polluted_confirmed,
    count(*) filter (where rank_class = 'full' and n_exh_time < ${BOATS_PER_RACE}) as rank_absent_suspect,
    count(*) filter (where active and rank4 is not null and rank5 is not null and rank6 is not null) as rank4_6_all_present,
    count(*) filter (where active and actual_course_1 is not null) as actual_course,
    count(*) filter (where active and winning_technique is not null) as winning_technique,
    count(*) filter (where active and race_stage is not null) as race_stage,
    count(*) filter (where active and n_st_rows > 0) as st_row,
    count(*) filter (where active and n_st_value > 0) as st_value,
    count(*) filter (where active and has_exhibition_row) as exhibition_row,
    count(*) filter (where active and n_exh_time > 0) as exhibition_time,
    count(*) filter (where active and has_odds) as odds,
    count(*) filter (where active and coalesce(has_odds_all, false)) as odds_all,
    ${perTypeCount}
from c group by race_date order by race_date`;
}

/**
 * 月別の結果充足率の集計SQL（全期間、toDate 以降は結果未確定のため除く）。日単位の集計を経由して月に丸める。
 * 全期間を読むため、日次ではなく週次で実行する（Disk IOへの配慮）。
 *
 * @param {{toDate: string}} slots
 */
export function buildMonthlySql({ toDate }) {
  return `
with d as (
  select r.race_date,
      count(*) as total,
      count(*) filter (where r.cancellation_status = 'confirmed') as excluded,
      count(*) filter (where r.cancellation_status is distinct from 'confirmed') as denom,
      count(*) filter (where r.cancellation_status is distinct from 'confirmed' and rr.rank1 is not null) as with_result,
      count(*) filter (where r.cancellation_status is distinct from 'confirmed' and rr.race_id is null) as no_result_row,
      count(*) filter (where r.cancellation_status is distinct from 'confirmed' and rr.race_id is not null and rr.rank1 is null) as row_without_rank1
  from races r left join race_results rr on rr.race_id = r.race_id
  where r.race_date <= ${toDate}
  group by r.race_date
)
select to_char(race_date, 'YYYY-MM') as month,
    count(*) as days,
    sum(total)::int as total, sum(excluded)::int as excluded, sum(denom)::int as denom,
    sum(with_result)::int as with_result,
    sum(no_result_row)::int as no_result_row,
    sum(row_without_rank1)::int as row_without_rank1,
    count(*) filter (where denom > 0 and with_result = 0) as zero_result_days,
    count(*) filter (where with_result > 0 and with_result < denom) as partial_days
from d group by 1 order by 1`;
}
