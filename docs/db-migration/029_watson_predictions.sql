-- ワトソン予想（LightGBM LambdaRank）の日次予測テーブル
-- 週次学習: train-poirot.yml / 日次推論: generate-poirot.yml（1日3回、上書き更新）
-- /holmes ワトソンタブが読み取る

CREATE TABLE IF NOT EXISTS watson_predictions (
  race_id VARCHAR(20) PRIMARY KEY,
  -- 予測ランキング順の艇番配列 例: [1, 4, 2, 3, 5, 6]
  rank_order JSONB NOT NULL,
  -- 各艇の勝率（レース内softmax・合計1） 例: {"1": 0.42, "2": 0.15, ...}
  win_probs JSONB NOT NULL,
  -- LambdaRank 生スコア（デバッグ・再現用）
  scores JSONB,
  -- 診断ポイント: 艇番ごとの SHAP 上位特徴量
  -- 例: {"1": [{"feature": "exhibition_time", "label": "展示タイム", "contrib": 0.31}, ...]}
  explanations JSONB,
  model_trained_at TIMESTAMPTZ,
  predicted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: 匿名ユーザーは読み取りのみ（書き込みは service role が RLS をバイパス）
ALTER TABLE watson_predictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "watson_predictions_public_read" ON watson_predictions;
CREATE POLICY "watson_predictions_public_read"
  ON watson_predictions FOR SELECT
  USING (true);
