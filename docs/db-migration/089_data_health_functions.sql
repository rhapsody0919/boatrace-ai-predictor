-- 089: データ健全性の日次監視（完了の定義C）が呼ぶ、読み取り専用の集計関数
--
-- 対応設計: docs/design/scraping-vercel-consolidation/verification-runbook.md U（汎用の日次監視）/ tasks.md T7-06
-- 実装: scripts/lib/dataHealth/（登録表 checks.js・関数のSQLの正本 functions.js・判定 evaluate.js・実行 job.js）、
--   api/cron/data-health.js（Vercel Cron、既定は off）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認後に、親またはユーザーが実行する（テーブル・データの変更なし）。
--
-- 適用手順:
--   Supabase Dashboard > SQL Editor、またはManagement API で、次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
--   CREATE OR REPLACE FUNCTION・REVOKE・GRANT・COMMENT のみ（メタデータの変更。テーブルを読み書きしない。ロックなし）。
--   再適用しても失敗しない（冪等）。適用前後どちらでも、既存のコードは壊れない（この関数を呼ぶのは data_health ジョブだけで、
--   既定は off）。
--
-- 適用後の確認（読み取りのみ。軽い）:
--   SELECT p.proname, p.prosecdef AS security_definer, p.provolatile AS volatility,
--          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec,
--          has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_exec
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname LIKE 'data_health_%' ORDER BY 1;
--   → 7行。security_definer=false、volatility='s'（STABLE）、anon_exec=false・authenticated_exec=false・service_role_exec=true
--   SELECT data_health_table_rows();   -- service_role（SQL Editor の既定のロール）で実行。{"races": true, ...} が返る
--
-- ロールバック（関数を消すだけ。データへの影響なし。data_health ジョブは、関数が無い間は失敗として記録される。
--   先に scrape_job_state の data_health を off に戻す）:
--   DROP FUNCTION IF EXISTS data_health_coverage(date, date);
--   DROP FUNCTION IF EXISTS data_health_pre_race_fields(date, date);
--   DROP FUNCTION IF EXISTS data_health_pit_reports(date, date);
--   DROP FUNCTION IF EXISTS data_health_race_series(date, date);
--   DROP FUNCTION IF EXISTS data_health_racer_period_stats(date, date);
--   DROP FUNCTION IF EXISTS data_health_monthly_result(date);
--   DROP FUNCTION IF EXISTS data_health_table_rows();
--
-- 設計上の要点:
--   * 呼び出し元が任意のSQLを渡す口は作らない。固定のSQLを持つ、名前つき・型つき引数の関数を、データセットごとに用意する
--     （SQLは scripts/lib/dataHealth/functions.js が正本で、この関数の本体はそこから生成した。
--     npm run verify:data-health-job が、このファイルとの一致と、REVOKE・GRANT の内容を機械検査する）
--   * SECURITY INVOKER・STABLE・SET search_path 固定（public, pg_temp）・SET statement_timeout。SELECTの集計のみで、
--     書き込みは構造的にできない（本体に INSERT・UPDATE・DELETE・DDL・動的SQL（EXECUTE）を持たない）。
--     statement_timeout の関数単位の SET は、呼び出し元の文の開始時に張られたタイマーには効かない場合がある（保険）。
--     実際の上限は、引数の検査（期間は最大32日。範囲の広い読み取りを入口で拒否する）と、日付の範囲検索（索引）による
--   * PUBLIC・anon・authenticated から EXECUTE を剥奪し、service_role のみに付与する（076の規律）。
--     関数の既定の権限は PUBLIC に EXECUTE が付くため、REVOKE を必ず明示する
--   * 戻り値は jsonb（日別の行の配列、または { テーブル名: 行の有無 } のオブジェクト）。PostgREST の rpc で呼ぶ
--   * 期間の下端・上端は引数（p_from・p_to）で、両端を含む。races.race_date の索引と、race_id（YYYY-MM-DD-会場-R）の
--     範囲検索で読む。全期間を読むのは data_health_monthly_result（週次）と data_health_table_rows（先頭1行のみ）だけ
--   * 新しいデータセットは、そのデータセットのマイグレーションで関数を追加する（verification-runbook.md U の手順）

-- data_health_coverage
CREATE OR REPLACE FUNCTION data_health_coverage(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
SET statement_timeout = '60s'
AS $data_health$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 31 THEN
    RAISE EXCEPTION 'data_health_coverage: 期間が不正です（from <= to、最大32日）: % 〜 %', p_from, p_to;
  END IF;
  RETURN (
    select coalesce(jsonb_agg(to_jsonb(q) order by q.d), '[]'::jsonb)
    from (
with o as (
  select x.race_id,
      bool_or((x.trifecta_all is not null and x.trifecta_all not in ('null'::jsonb, '{}'::jsonb, '[]'::jsonb)) and (x.trio_all is not null and x.trio_all not in ('null'::jsonb, '{}'::jsonb, '[]'::jsonb)) and (x.exacta_all is not null and x.exacta_all not in ('null'::jsonb, '{}'::jsonb, '[]'::jsonb)) and (x.quinella_all is not null and x.quinella_all not in ('null'::jsonb, '{}'::jsonb, '[]'::jsonb)) and (x.wide_all is not null and x.wide_all not in ('null'::jsonb, '{}'::jsonb, '[]'::jsonb))) as has_odds_all,
      bool_or((x.trifecta_all is not null and x.trifecta_all not in ('null'::jsonb, '{}'::jsonb, '[]'::jsonb))) as has_trifecta_all,
      bool_or((x.trio_all is not null and x.trio_all not in ('null'::jsonb, '{}'::jsonb, '[]'::jsonb))) as has_trio_all,
      bool_or((x.exacta_all is not null and x.exacta_all not in ('null'::jsonb, '{}'::jsonb, '[]'::jsonb))) as has_exacta_all,
      bool_or((x.quinella_all is not null and x.quinella_all not in ('null'::jsonb, '{}'::jsonb, '[]'::jsonb))) as has_quinella_all,
      bool_or((x.wide_all is not null and x.wide_all not in ('null'::jsonb, '{}'::jsonb, '[]'::jsonb))) as has_wide_all
  from race_odds x
  where x.race_id >= p_from::text and x.race_id < (p_to + 1)::text
  group by x.race_id
), fin as (
  select x.race_id, count(*) as n_rows, count(x.finish_mark) as n_mark,
      count(x.finish_rank) as n_fin, count(x.start_timing) as n_st_value
  from race_start_timings x
  where x.race_id >= p_from::text and x.race_id < (p_to + 1)::text
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
      coalesce(f.n_rows = 6 and f.n_mark = 6, false) as fin_known,
      f.n_fin,
      exists(select 1 from exhibition_data x where x.race_id = r.race_id) as has_exhibition_row,
      -- check-exhibition-gap-rate.js（BOA-356）と同じ基準: 1艇でも展示タイムが入っていれば取得済み
      (select count(*) from exhibition_data x where x.race_id = r.race_id and x.exhibition_time is not null) as n_exh_time,
      (o.race_id is not null) as has_odds,
      o.has_odds_all,
      o.has_trifecta_all, o.has_trio_all, o.has_exacta_all, o.has_quinella_all, o.has_wide_all
  from races r
  left join race_results rr on rr.race_id = r.race_id
  left join race_conditions rc on rc.race_id = r.race_id
  left join fin f on f.race_id = r.race_id
  left join o on o.race_id = r.race_id
  where r.race_date between p_from and p_to
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
        and n_st_rows between 1 and 5 and n_exh_time between 1 and 5) as rank_undetermined_absent_hint,
    -- 参考（BOA-362）: 順位に非完走艇が入っている。確定=艇別の着欄で、完走艇数より多くの順位が付いている。
    -- 疑い=着欄を確定できないレースで6着まで付いているのに展示タイムが5艇分以下（欠場艇が着順に入っている可能性。展示の欠損も含む上限値）
    count(*) filter (where rank_class in ('determined', 'le3') and n_ranked > n_fin) as rank_polluted_confirmed,
    count(*) filter (where rank_class = 'full' and n_exh_time < 6) as rank_absent_suspect,
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
    count(*) filter (where active and coalesce(has_trifecta_all, false)) as trifecta_all,
    count(*) filter (where active and coalesce(has_trio_all, false)) as trio_all,
    count(*) filter (where active and coalesce(has_exacta_all, false)) as exacta_all,
    count(*) filter (where active and coalesce(has_quinella_all, false)) as quinella_all,
    count(*) filter (where active and coalesce(has_wide_all, false)) as wide_all
from c group by race_date order by race_date
    ) q
  );
END
$data_health$;

REVOKE ALL ON FUNCTION data_health_coverage(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION data_health_coverage(date, date) TO service_role;
COMMENT ON FUNCTION data_health_coverage(date, date) IS 'データ健全性の日次監視: 存在充足率（結果・着順・実進入・決まり手・レース種別・ST・展示・オッズ・全券種オッズ）の日別集計。定義は scripts/lib/dataHealth/coverageSpec.js';

-- data_health_pre_race_fields
CREATE OR REPLACE FUNCTION data_health_pre_race_fields(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
SET statement_timeout = '60s'
AS $data_health$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 31 THEN
    RAISE EXCEPTION 'data_health_pre_race_fields: 期間が不正です（from <= to、最大32日）: % 〜 %', p_from, p_to;
  END IF;
  RETURN (
    select coalesce(jsonb_agg(to_jsonb(q) order by q.d), '[]'::jsonb)
    from (
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
  where r.race_date between p_from and p_to
    and r.cancellation_status is distinct from 'confirmed'
  group by r.race_date
), c as (
  select r.race_date::text as d,
      count(*) as races,
      count(*) filter (where x.race_distance_m is not null) as race_distance_m,
      count(*) filter (where x.race_labels is not null) as race_labels
  from races r
  left join race_conditions x on x.race_id = r.race_id
  where r.race_date between p_from and p_to
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
order by 1
    ) q
  );
END
$data_health$;

REVOKE ALL ON FUNCTION data_health_pre_race_fields(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION data_health_pre_race_fields(date, date) TO service_role;
COMMENT ON FUNCTION data_health_pre_race_fields(date, date) IS 'データ健全性の日次監視: 出走表の拡張列（081。登録体重・支部・F数・L数・欠場・距離・ラベル）の取得済み件数';

-- data_health_pit_reports
CREATE OR REPLACE FUNCTION data_health_pit_reports(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
SET statement_timeout = '60s'
AS $data_health$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 31 THEN
    RAISE EXCEPTION 'data_health_pit_reports: 期間が不正です（from <= to、最大32日）: % 〜 %', p_from, p_to;
  END IF;
  RETURN (
    select coalesce(jsonb_agg(to_jsonb(q) order by q.d), '[]'::jsonb)
    from (
select r.race_date::text as d,
    count(*) as expected,
    count(*) filter (where p.race_id is not null) as with_report,
    count(*) filter (where p.status = 'published') as published
from races r
left join race_pit_reports p on p.race_id = r.race_id
where r.race_date between p_from and p_to
  and r.cancellation_status is distinct from 'confirmed'
  and (r.race_grade = 'SG' or (r.race_grade in ('G1', 'G2') and r.race_number >= 7))
group by r.race_date
order by 1
    ) q
  );
END
$data_health$;

REVOKE ALL ON FUNCTION data_health_pit_reports(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION data_health_pit_reports(date, date) TO service_role;
COMMENT ON FUNCTION data_health_pit_reports(date, date) IS 'データ健全性の日次監視: ピットレポート（085）の対象レース（SG全レース・G1・G2の7R以降）の取得済み件数';

-- data_health_race_series
CREATE OR REPLACE FUNCTION data_health_race_series(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
SET statement_timeout = '60s'
AS $data_health$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 31 THEN
    RAISE EXCEPTION 'data_health_race_series: 期間が不正です（from <= to、最大32日）: % 〜 %', p_from, p_to;
  END IF;
  RETURN (
    select coalesce(jsonb_agg(to_jsonb(q) order by q.d), '[]'::jsonb)
    from (
select d,
    count(*) as expected,
    count(*) filter (where covered) as covered
from (
  select r.race_date::text as d, r.venue_code,
      bool_or(s.venue_code is not null) as covered
  from races r
  left join race_series s
    on s.venue_code = r.venue_code and r.race_date between s.start_date and s.end_date
  where r.race_date between p_from and p_to
    and r.cancellation_status is distinct from 'confirmed'
  group by r.race_date, r.venue_code
) t
group by d
order by 1
    ) q
  );
END
$data_health$;

REVOKE ALL ON FUNCTION data_health_race_series(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION data_health_race_series(date, date) TO service_role;
COMMENT ON FUNCTION data_health_race_series(date, date) IS 'データ健全性の日次監視: 節（race_series、084）が、開催のあった会場×日を覆っている件数';

-- data_health_racer_period_stats
CREATE OR REPLACE FUNCTION data_health_racer_period_stats(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
SET statement_timeout = '60s'
AS $data_health$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 31 THEN
    RAISE EXCEPTION 'data_health_racer_period_stats: 期間が不正です（from <= to、最大32日）: % 〜 %', p_from, p_to;
  END IF;
  RETURN (
    select coalesce(jsonb_agg(to_jsonb(q) order by q.d), '[]'::jsonb)
    from (
with s as (
  select distinct racer_id from racer_period_stats
)
select r.race_date::text as d,
    count(distinct e.racer_id) as expected,
    count(distinct e.racer_id) filter (where s.racer_id is not null) as with_stats
from races r
join race_entries e on e.race_id = r.race_id
left join s on s.racer_id = e.racer_id
where r.race_date between p_from and p_to
  and r.cancellation_status is distinct from 'confirmed'
  and e.racer_id is not null
group by r.race_date
order by 1
    ) q
  );
END
$data_health$;

REVOKE ALL ON FUNCTION data_health_racer_period_stats(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION data_health_racer_period_stats(date, date) TO service_role;
COMMENT ON FUNCTION data_health_racer_period_stats(date, date) IS 'データ健全性の日次監視: 出走した選手のうち、期別成績（racer_period_stats、083）がある選手の数';

-- data_health_monthly_result
CREATE OR REPLACE FUNCTION data_health_monthly_result(p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
SET statement_timeout = '60s'
AS $data_health$
BEGIN
  IF p_to IS NULL THEN
    RAISE EXCEPTION 'data_health_monthly_result: p_to が NULL です';
  END IF;
  RETURN (
    select coalesce(jsonb_agg(to_jsonb(q) order by q.month), '[]'::jsonb)
    from (
with d as (
  select r.race_date,
      count(*) as total,
      count(*) filter (where r.cancellation_status = 'confirmed') as excluded,
      count(*) filter (where r.cancellation_status is distinct from 'confirmed') as denom,
      count(*) filter (where r.cancellation_status is distinct from 'confirmed' and rr.rank1 is not null) as with_result,
      count(*) filter (where r.cancellation_status is distinct from 'confirmed' and rr.race_id is null) as no_result_row,
      count(*) filter (where r.cancellation_status is distinct from 'confirmed' and rr.race_id is not null and rr.rank1 is null) as row_without_rank1
  from races r left join race_results rr on rr.race_id = r.race_id
  where r.race_date <= p_to
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
from d group by 1 order by 1
    ) q
  );
END
$data_health$;

REVOKE ALL ON FUNCTION data_health_monthly_result(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION data_health_monthly_result(date) TO service_role;
COMMENT ON FUNCTION data_health_monthly_result(date) IS 'データ健全性の週次監視: 月別の結果充足率（全期間。p_to 以前）。定義は scripts/lib/dataHealth/coverageSpec.js';

-- data_health_table_rows
CREATE OR REPLACE FUNCTION data_health_table_rows()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
SET statement_timeout = '60s'
AS $data_health$
BEGIN
  RETURN (
    select q.o from (
select jsonb_build_object(
  'races', exists (select 1 from races),
  'race_entries', exists (select 1 from race_entries),
  'race_results', exists (select 1 from race_results),
  'race_conditions', exists (select 1 from race_conditions),
  'race_start_timings', exists (select 1 from race_start_timings),
  'exhibition_data', exists (select 1 from exhibition_data),
  'race_odds', exists (select 1 from race_odds),
  'race_payouts', exists (select 1 from race_payouts),
  'racer_profiles', exists (select 1 from racer_profiles),
  'racer_series_points', exists (select 1 from racer_series_points),
  'venue_entry_course_stats', exists (select 1 from venue_entry_course_stats),
  'venue_motor_stats', exists (select 1 from venue_motor_stats),
  'external_predictions', exists (select 1 from external_predictions),
  'race_pit_reports', exists (select 1 from race_pit_reports),
  'race_special_notes', exists (select 1 from race_special_notes),
  'race_series', exists (select 1 from race_series),
  'racer_period_stats', exists (select 1 from racer_period_stats)
) as o
) q
  );
END
$data_health$;

REVOKE ALL ON FUNCTION data_health_table_rows() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION data_health_table_rows() TO service_role;
COMMENT ON FUNCTION data_health_table_rows() IS 'データ健全性の日次監視: 主要テーブルに1行以上あるか（空テーブルの検知）。対象テーブルは関数の中の固定の一覧';
