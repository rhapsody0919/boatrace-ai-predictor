-- SNSハブ管理画面UX改善（docs/design/sns-hub-admin-ux-improvements/）課題4用
-- Supabase Dashboard > SQL Editor で実行する。
--
-- sns_strategy_insights.sourceはVARCHAR(20)でCHECK制約・ネイティブENUM型のいずれでもなく
-- 有効値はコメントで文書化されているのみ（039_sns_strategy_insights.sql参照）。
-- revise/redoの自由記述フィードバックを選択的にinsight化する機能（plan.md参照）で
-- 新しい値'revision-feedback'を書き込むため、コメントを更新するのみ（データ変更なし）。
COMMENT ON COLUMN sns_strategy_insights.source IS
  '''own-metrics'' | ''external-research'' | ''revision-feedback''（revise/redo時のユーザー自由記述由来、spec.md課題4参照）';
