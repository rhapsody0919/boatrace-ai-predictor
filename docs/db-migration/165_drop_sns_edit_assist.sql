-- 165: 編集指摘（145）の RPC 3つと表2つを削除する（番号は hq が予約、2026-10-19）
-- #1645・#1649 で個別承認の画面を撤去した後、api/_lib/snsEditAssist.js と xSendStore の saveInspection・decideFinding を
-- 呼ぶ経路が無くなった（api/・src/・cron から呼ばれていたのは個別承認の API だけ）。
-- 残すもの: sns_mobile_revision（147 の差分が版の照合に使う）。
-- 適用はオーナー（手順は 165-runbook.md）。戻すときは 145 をそのまま再実行する（145 は sns_mobile_revision を作り直さない）
BEGIN;

DROP FUNCTION public.decide_sns_edit_finding(UUID, TEXT, UUID, TEXT, UUID, TEXT);
DROP FUNCTION public.save_sns_edit_inspection(UUID, TEXT, TEXT, JSONB);
DROP FUNCTION public.read_sns_edit_inspection(UUID);
DROP TABLE public.sns_edit_decisions;
DROP TABLE public.sns_edit_inspections;

COMMIT;
