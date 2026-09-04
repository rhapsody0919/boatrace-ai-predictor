-- sns_topicsに却下理由列を追加する。
-- ネタ承認画面で却下する際、理由を簡単にフィードバックできるようにする
-- （2026-09-04ユーザー要望）。sns_topic_targets.skip_reasonと同じ「自由記述の
-- 監査用テキスト」という位置づり。今後の生成方針へ反映したい場合は
-- 別途sns_strategy_insightsにも登録する（reject.jsのsaveAsInsightオプション）。


ALTER TABLE sns_topics ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
