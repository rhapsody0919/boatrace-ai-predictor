-- payout-rate（選手×艇番回収率型）・outcome-distribution（出目分布型）の
-- 除外理由をnotes列に記録する。
-- Supabase Dashboard > SQL Editor で実行する。
--
-- 背景: この2カテゴリはactive=trueのままdaily-auto Routineの候補選定から
-- 恒久的に除外されている（sns-topic-proposer-daily-auto.md「TikTokポリシー
-- 上どのみち新規制作を全面停止中のため対象から外した」）。confrontation-hype
-- と異なりnotes列に理由が記録されておらず、コードだけでは「なぜ選ばれない
-- か」を追えない状態だった（2026-09-04、廃止候補インベントリ調査で発覚）。

UPDATE sns_topic_categories
SET notes = 'TikTokガイドライン上、新規制作を全面停止中（sns-video-producer-prompt.md絶対厳守13）。active=trueのままdaily-auto Routineの候補選定から恒久的に除外している（sns-topic-proposer-daily-auto.md参照）。制作再開の判断があるまでactive=falseにはしない'
WHERE category_key IN ('payout-rate', 'outcome-distribution')
  AND notes IS NULL;
