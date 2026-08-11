-- マイクロフト予想（Transformer・選手履歴系列）の日次予測テーブル
-- 学習: scripts/ml/train_mycroft.py / 日次推論: generate-poirot.yml（1日3回、上書き更新）
-- /holmes マイクロフトタブが読み取る

CREATE TABLE IF NOT EXISTS mycroft_predictions (
  race_id VARCHAR(20) PRIMARY KEY,
  -- 予測ランキング順の艇番配列 例: [1, 4, 2, 3, 5, 6]
  rank_order JSONB NOT NULL,
  -- 各艇の勝率（レース内softmax・合計1） 例: {"1": 0.42, "2": 0.15, ...}
  win_probs JSONB NOT NULL,
  -- モデルの生スコア（デバッグ・再現用）
  scores JSONB,
  -- 「マイクロフトの記憶」: 艇番ごとに attention が重視した過去レース上位3件
  -- 例: {"1": [{"race_date": "2026-08-01", "venue_code": 21,
  --            "result": "1着", "days_ago": 10, "weight": 0.18}, ...]}
  attention_evidence JSONB,
  model_trained_at TIMESTAMPTZ,
  predicted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: 匿名ユーザーは読み取りのみ（書き込みは service role が RLS をバイパス）
ALTER TABLE mycroft_predictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mycroft_predictions_public_read" ON mycroft_predictions;
CREATE POLICY "mycroft_predictions_public_read"
  ON mycroft_predictions FOR SELECT
  USING (true);
