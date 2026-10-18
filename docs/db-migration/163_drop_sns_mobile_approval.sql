-- 163: 個別承認（140）の RPC 2つと表を削除する（番号は hq が予約、2026-10-19）
-- #1645 で「今日のレースを確認・個別承認」の画面と /api/admin/sns-hub/mobile-approval を撤去し、呼び出し元が無くなった。
-- 残すもの: sns_mobile_revision（145 の編集指摘・147 の差分が版の照合に使う）、guard_sns_x_approval（148・153 が作り直している）。
-- 適用はオーナー（手順は 163-runbook.md）。戻すときは 140 の該当部分（CREATE FUNCTION 2つ・CREATE TABLE・REVOKE/GRANT）を再実行する
BEGIN;

DROP FUNCTION public.approve_sns_mobile_channel(UUID, UUID, TEXT, JSONB, TIMESTAMPTZ, INTEGER);
DROP FUNCTION public.read_sns_mobile_race(UUID);
DROP TABLE public.sns_mobile_reviews;

COMMIT;
