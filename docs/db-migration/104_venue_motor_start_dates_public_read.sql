-- 104: モーター使用開始日（venue_motor_start_dates）を匿名（画面）から読めるようにする
--
-- 対応: src/services/supabaseDataService.js getVenueMotorChampionshipHistory
--       docs/adr/0067-official-site-content-redisplay-policy.md（追記 2026-09-28）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認のもとで行う（docs/db-migration/APPLIED.md）。
--
-- 目的:
--   モータ情報の「優勝した日・選手」を、現行モーターの世代（会場ごとの最新の使用開始日以降）に限る。
--   モーター番号は入れ替え後も再利用されるため、期間の下限が無いと別モーターの優勝が混ざる
--   （2026-09-28実測: race_stage='優勝戦' の552レース中165レースが現行世代より前）。
--
-- ADR-0067との関係:
--   091 は BOATCAST 由来の3表の匿名権限を意図的に剥奪している（「保存のみ」）。本マイグレーションは
--   そのうち venue_motor_start_dates だけを SELECT 可能にする。日付は画面に表示せず、絞り込み条件に
--   使うだけ。ADR-0067 の 2026-09-28 追記（モーター使用開始日）を参照。
--
-- 未適用の間の画面の挙動:
--   権限エラー（42501）を「使用開始日が不明」として扱い、優勝履歴を出さない（別モーターの記録を出さない）。
--
-- 適用手順: 次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
--
-- 適用後の確認（読み取りのみ）:
--   SELECT has_table_privilege('anon', 'public.venue_motor_start_dates', 'SELECT') AS sel,
--          has_table_privilege('anon', 'public.venue_motor_start_dates', 'INSERT') AS ins;
--   → sel=true, ins=false
--
-- ロールバック（匿名の読み取りを止める。データは消えない）:
--   DROP POLICY IF EXISTS venue_motor_start_dates_public_read ON public.venue_motor_start_dates;
--   REVOKE SELECT ON public.venue_motor_start_dates FROM anon, authenticated;
--
-- 設計上の要点:
--   * 公開するのは SELECT のみ。書き込みは service_role（RLS迂回）でのみ行う（BOA-370のRLS規律）
--   * 076 で新規テーブルの既定権限を剥奪しているため、ポリシーだけでなく GRANT SELECT も明示する

SET LOCAL lock_timeout = '10s';

DROP POLICY IF EXISTS venue_motor_start_dates_public_read ON public.venue_motor_start_dates;
CREATE POLICY venue_motor_start_dates_public_read ON public.venue_motor_start_dates
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.venue_motor_start_dates TO anon, authenticated;
