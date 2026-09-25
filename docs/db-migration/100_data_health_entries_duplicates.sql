-- 100: 出走表の複製（過去日のデータでの汚染）を検知する、日次監視の集計関数（BOA-422・BOA-423）
--
-- 背景: BOA-407（幻の開催日）は「開催が無い日に、過去日の出走表が複製される」事象で、race_results が
--   欠損するため、欠損ベースの抽出で見つかった。本件はその逆で、**実際に開催があった日**の race_entries
--   だけが過去日のデータで汚染される。race_results は正常に入るため、既存の監視・抽出では一切ひっかからない。
--   公式K/Bファイルとの突き合わせ（docs/issues/race-entries-duplicate-contamination-audit.md）で、
--   2025-12-02〜2026-09-25 に 22会場日・219レースの汚染を確認した。
--
-- 対応設計: docs/design/scraping-vercel-consolidation/verification-runbook.md U（汎用の日次監視）
-- 実装: scripts/lib/dataHealth/functions.js（SQLの正本）・checks.js（登録表の entries.duplicates）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認後に、親またはユーザーが実行する（テーブル・データの変更なし）。
--
-- 適用手順:
--   Supabase Dashboard > SQL Editor、またはManagement API で、次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
--   CREATE OR REPLACE FUNCTION・REVOKE・GRANT・COMMENT のみ（メタデータの変更。テーブルを読み書きしない。ロックなし）。
--   再適用しても失敗しない（冪等）。適用前後どちらでも、既存のコードは壊れない（この関数を呼ぶのは data_health
--   ジョブだけで、そのモードは scrape_job_state で管理する）。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT data_health_entries_duplicates('2026-01-05', '2026-01-12');
--     -> 2026-01-09 の venue_days と clean_venue_days が 9 だけ食い違う（汚染9会場日）
--   SELECT data_health_entries_duplicates('2026-09-18', '2026-09-24');
--     -> 全日 venue_days = clean_venue_days（汚染なし）

-- data_health_entries_duplicates
CREATE OR REPLACE FUNCTION data_health_entries_duplicates(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
SET statement_timeout = '60s'
AS $data_health$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 31 THEN
    RAISE EXCEPTION 'data_health_entries_duplicates: 期間が不正です（from <= to、最大32日）: % 〜 %', p_from, p_to;
  END IF;
  RETURN (
    select coalesce(jsonb_agg(to_jsonb(q) order by q.d), '[]'::jsonb)
    from (
with win as (
  select r.race_id, r.race_date, r.venue_code, r.race_number,
      exists (select 1 from race_results rr where rr.race_id = r.race_id) as has_result,
      md5(string_agg(e.boat_number::text || ':' || coalesce(e.racer_id::text, '-'), ',' order by e.boat_number)) as sig
  from races r
  join race_entries e on e.race_id = r.race_id
  where r.race_date between (p_from - 21) and p_to
    and r.cancellation_status is distinct from 'confirmed'
  group by r.race_id, r.race_date, r.venue_code, r.race_number
), dup as (
  select a.race_date, a.venue_code, a.race_number
  from win a
  join win b on b.venue_code = a.venue_code and b.race_number = a.race_number
    and b.race_date < a.race_date and a.race_date - b.race_date <= 21
    and b.sig = a.sig and b.has_result
  where a.race_date between p_from and p_to and a.has_result
  group by a.race_date, a.venue_code, a.race_number
), flagged as (
  select race_date, venue_code
  from dup group by race_date, venue_code having count(*) >= 2
), base as (
  select r.race_date, r.venue_code
  from races r
  join race_entries e on e.race_id = r.race_id
  where r.race_date between p_from and p_to
    and r.cancellation_status is distinct from 'confirmed'
  group by r.race_date, r.venue_code
)
select b.race_date::text as d,
    count(*) as venue_days,
    count(*) filter (where f.venue_code is null) as clean_venue_days
from base b
left join flagged f on f.race_date = b.race_date and f.venue_code = b.venue_code
group by b.race_date
order by 1
    ) q
  );
END
$data_health$;

REVOKE ALL ON FUNCTION data_health_entries_duplicates(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION data_health_entries_duplicates(date, date) TO service_role;
COMMENT ON FUNCTION data_health_entries_duplicates(date, date) IS 'データ健全性の日次監視: 出走表が過去日のデータで汚染された疑い（同一会場・同一レース番号で、直近21日以内の別の日と艇番→登録番号が完全一致するレースが2つ以上ある会場×日）。BOA-422・BOA-423';
