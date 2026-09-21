-- 086: ピットレポート（選手コメント）を、匿名（画面）から読めるようにする（SELECTのみ）
--
-- 対応設計: docs/design/pit-comments/spec.md・screens.md（Linear BOA-379）、公式コンテンツの再表示の判断は docs/adr/0067
--
-- ⚠️ この案は「本番へ未適用」。085 を適用した後で、画面に出す準備（モック承認・実装）ができてから、
--   ユーザーの承認のもとで適用する。085 だけを適用しても、取得・保存は動き、匿名からは読めない
--   （公式サイトのコンテンツの再公開は、この 086 の適用が境目）。
--
-- 適用手順: Supabase Dashboard > SQL Editor、またはManagement API で、次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
--   ポリシーとGRANTの追加のみ（テーブル・行には触れない）。085 が未適用だと、テーブルが無くて失敗する（何も変更されない）。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT has_table_privilege('anon', 'public.race_pit_comments', 'SELECT'),
--          has_table_privilege('anon', 'public.race_pit_comments', 'INSERT');
--   → true, false
--   anonキーで /rest/v1/race_pit_comments?select=race_id&limit=1 が HTTP 200 になること
--
-- ロールバック（匿名の読み取りを止める。データは消えない）:
--   DROP POLICY IF EXISTS race_pit_reports_public_read ON public.race_pit_reports;
--   DROP POLICY IF EXISTS race_pit_comments_public_read ON public.race_pit_comments;
--   REVOKE SELECT ON public.race_pit_reports, public.race_pit_comments FROM anon, authenticated;
--
-- 設計上の要点:
--   * 公開するのは SELECT のみ。書き込みは service_role（RLS迂回）でのみ行う（BOA-370のRLS規律）
--   * 076 で、新規テーブルの既定権限（anon・authenticated の全権限）を剥奪したため、SELECTのポリシーだけでなく
--     GRANT SELECT も明示する（020・021・023・076と同じ流儀）
--   * 全行を読めるが、内容は公式サイトで誰でも見られるコメントであり、個人情報は含まない。出典の表記・公式ページへのリンクを
--     画面に付ける前提での承認（docs/adr/0067 の追記案）

SET LOCAL lock_timeout = '10s';

DROP POLICY IF EXISTS race_pit_reports_public_read ON public.race_pit_reports;
CREATE POLICY race_pit_reports_public_read ON public.race_pit_reports
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS race_pit_comments_public_read ON public.race_pit_comments;
CREATE POLICY race_pit_comments_public_read ON public.race_pit_comments
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.race_pit_reports TO anon, authenticated;
GRANT SELECT ON public.race_pit_comments TO anon, authenticated;
