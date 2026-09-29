-- 107: 中止の誤検出（確定中止なのに結果がある）を検知する、日次監視の集計関数（BOA-512）
--
-- 背景: races.cancellation_status='confirmed'（マイグレーション047）は「開催されなかった」ことを表すため、
--   着順（race_results.rank1）のある結果と同居するのは原理的に0件のはず。2026-09-12に、結果の読み取りの一過性の
--   失敗で「結果のあるレースを除く」ガードが外れ（読み取りエラーを握りつぶして空集合として扱っていた）、
--   10会場の32本が誤って confirmed になった。原因は PR #743（2026-09-20）で修正済み（読み取りの失敗を例外にした）。
--   誤った confirmed は、予定表のスロットを cancelled_race で終端させ、集計の分母から外し、画面に中止バッジを出す。
--   これまで、この矛盾をどこも見ていなかった。
--
-- 実装: scripts/lib/dataHealth/functions.js（SQLの正本）・checks.js（登録表の cancellation.with_result）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認後に、ユーザーが実行する（テーブル・データの変更なし）。
--
-- 適用の順序: 先に BOA-512 のデータ修正（誤った confirmed 32本の取り消し）を行う。2026-09-12 は日次監視の対象期間
--   （直近7日）の外のため、修正前に適用しても通知は出ないが、手元の確認（下）で 09-12 が食い違って見える。
--
-- 適用手順:
--   Supabase Dashboard > SQL Editor、またはManagement API で、次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
--   CREATE OR REPLACE FUNCTION・REVOKE・GRANT・COMMENT のみ（メタデータの変更。テーブルを読み書きしない。ロックなし）。
--   再適用しても失敗しない（冪等）。適用前後どちらでも、既存のコードは壊れない（この関数を呼ぶのは data_health
--   ジョブだけ）。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT data_health_cancellation_with_result('2026-09-10', '2026-09-14');
--     -> データ修正の前: 2026-09-12 だけ races=156・confirmed_with_result=32・consistent_races=124。他の日は races = consistent_races
--     -> データ修正の後: 全日 confirmed_with_result=0

-- data_health_cancellation_with_result
CREATE OR REPLACE FUNCTION data_health_cancellation_with_result(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
SET statement_timeout = '60s'
AS $data_health$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 31 THEN
    RAISE EXCEPTION 'data_health_cancellation_with_result: 期間が不正です（from <= to、最大32日）: % 〜 %', p_from, p_to;
  END IF;
  RETURN (
    select coalesce(jsonb_agg(to_jsonb(q) order by q.d), '[]'::jsonb)
    from (
select r.race_date::text as d,
    count(*) as races,
    count(*) filter (where r.cancellation_status = 'confirmed' and rr.rank1 is not null) as confirmed_with_result,
    count(*) - count(*) filter (where r.cancellation_status = 'confirmed' and rr.rank1 is not null) as consistent_races
from races r
left join race_results rr on rr.race_id = r.race_id
where r.race_date between p_from and p_to
group by r.race_date
order by 1
    ) q
  );
END
$data_health$;

REVOKE ALL ON FUNCTION data_health_cancellation_with_result(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION data_health_cancellation_with_result(date, date) TO service_role;
COMMENT ON FUNCTION data_health_cancellation_with_result(date, date) IS 'データ健全性の日次監視: 確定中止（cancellation_status=''confirmed''）なのに着順（rank1）のある結果が入っているレース（中止の誤検出。原理的に0件）。BOA-512';
