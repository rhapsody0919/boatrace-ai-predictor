-- 161: 全貌動画（format=full_picture）を、素材 v1 を通さずに自動送信の item にする（2026-10-18 オーナー決定、番号は hq が予約）
-- hq の作り手が出す full_picture のフォルダを scripts/sns/push-full-picture.js が受け取り、X・YouTube の下書きを作って
-- item（kind='full_picture'、下書きに直接ひもづく）を notified で入れ、自動送信の承認者で承認する。
-- 変えるのは item の種類の CHECK だけ。承認（approve_sns_x_send、160）は bundle の無い下書きの item を draft_id で引くので、そのまま使える。
-- 送信（transition_sns_send_139、158）も auto_item_id で item を引くので、そのまま使える。
-- 検証: scripts/maintenance/verify-sns-full-picture.js（PGlite、外部接続なし）。適用はオーナー（手順は 161-runbook.md）
BEGIN;

ALTER TABLE public.sns_auto_send_items DROP CONSTRAINT sns_auto_send_items_kind_check;
ALTER TABLE public.sns_auto_send_items
  ADD CONSTRAINT sns_auto_send_items_kind_check CHECK (kind IN ('race', 'digest', 'full_picture'));

ALTER TABLE public.sns_auto_send_items DROP CONSTRAINT sns_auto_send_items_kind_source;
ALTER TABLE public.sns_auto_send_items ADD CONSTRAINT sns_auto_send_items_kind_source CHECK (
  (kind = 'race' AND bundle_import_id IS NOT NULL AND draft_id IS NULL)
  OR (kind = 'digest' AND bundle_import_id IS NULL AND draft_id IS NOT NULL AND channel = 'x')
  OR (kind = 'full_picture' AND bundle_import_id IS NULL AND draft_id IS NOT NULL));

COMMIT;
