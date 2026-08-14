-- AI予想モデル大規模改修（docs/design/ai-model-redesign/）用スキーマ
-- Supabase Dashboard > SQL Editor で実行する。
-- 既存の models / predictions / bet_recommendations / race_odds は model_id ベースで
-- 拡張可能な設計になっているため、新モデルは models への行追加のみで多くの既存
-- インフラ（実績集計・回収率計算）を再利用できる（ADR 0009〜0012参照）。
--
-- ⚠️ 2026-08-11追記: 本ファイルを既に一度実行済みの環境（race_outcome_frequencies作成済み）は、
--    recovery_rate列がDECIMAL(6,4)で作られており実データ（3連単の高配当）でnumeric overflowが
--    発生する。以下のALTER文を追加実行してから Task2 のバッチを再実行すること。
--
--    ALTER TABLE race_outcome_frequencies ALTER COLUMN recovery_rate TYPE DECIMAL(10,4);
--
-- ============================================================================
-- 1. 新モデルの models 登録
--    model_id = 'unified' で確定（/step4 Task1）
-- ============================================================================
INSERT INTO models (model_id, display_name, model_type, status, is_public, description) VALUES (
  'unified',
  '新AI予想モデル',
  'unified',
  'development',
  FALSE,
  'データ出走表11指標 + 1マーク展開パターン + イン崩れ連続値スコアを入力とする一本化モデル（FR1）'
) ON CONFLICT (model_id) DO NOTHING;

-- 旧3モデルはFR7-1（実績アーカイブ化）に伴い status を retired に変更する
-- （新モデルのリリースタイミングで実行。今は適用しない）
-- UPDATE models SET status = 'retired' WHERE model_id IN ('standard', 'safeBet', 'upsetFocus');

-- ============================================================================
-- 2. race_outcome_frequencies（ADR 0010: 類似条件過去実績の事前集計）
--    docs/design/in-kuzure-specialization-strategy.md の設計を踏襲
--    会場×1着艇×2着艇×3着艇の組み合わせ別に、過去N日の出現率・回収率を保持する
-- ============================================================================
CREATE TABLE IF NOT EXISTS race_outcome_frequencies (
    venue_code SMALLINT NOT NULL,
    rank1_boat SMALLINT NOT NULL,
    rank2_boat SMALLINT NOT NULL,
    rank3_boat SMALLINT NOT NULL,
    window_days SMALLINT NOT NULL DEFAULT 180,

    total_occurrences INTEGER NOT NULL DEFAULT 0,
    sample_races INTEGER NOT NULL DEFAULT 0,       -- 集計対象期間の会場別総レース数（出現率算出の分母）
    appearance_rate DECIMAL(6,4),                   -- total_occurrences / sample_races（0〜1のみ、桁は十分）

    avg_payout INTEGER,                             -- 平均配当（100円あたり）
    -- 3連単は万舟券等で回収率が数千%を超えることがあるためDECIMAL(6,4)では桁不足。DECIMAL(10,4)とする
    recovery_rate DECIMAL(10,4),                     -- 回収率

    updated_at TIMESTAMPTZ DEFAULT NOW(),

    PRIMARY KEY (venue_code, rank1_boat, rank2_boat, rank3_boat, window_days)
);

CREATE INDEX IF NOT EXISTS idx_outcome_freq_venue_rank1
    ON race_outcome_frequencies(venue_code, rank1_boat);

ALTER TABLE race_outcome_frequencies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "outcome_frequencies_public_read" ON race_outcome_frequencies;
CREATE POLICY "outcome_frequencies_public_read"
  ON race_outcome_frequencies FOR SELECT
  USING (true);

-- ============================================================================
-- 3. model_bet_candidates（FR5: 展開パターン別・複数買い目候補）
--    1レース・1モデルにつき「展開パターン(最大3) × 買い目(3通り)」=最大9行を持つ
-- ============================================================================
CREATE TABLE IF NOT EXISTS model_bet_candidates (
    race_id VARCHAR(20) NOT NULL REFERENCES races(race_id) ON DELETE CASCADE,
    model_id VARCHAR(50) NOT NULL REFERENCES models(model_id),

    pattern_index SMALLINT NOT NULL,        -- 1マーク展開パターン番号（1〜3）
    pattern_technique VARCHAR(20),           -- 決まり手（nige/sashi/makuri/makurizashi/nuki/megumare）
    pattern_probability DECIMAL(6,5),        -- 展開パターンの発生確率（turnPrediction.js由来）

    bet_rank SMALLINT NOT NULL,              -- パターン内の順位（1〜3、本命→穴のグラデーション）
    bet_combo VARCHAR(10) NOT NULL,          -- 3連単買い目 例 "1-2-3"
    predicted_probability DECIMAL(7,6),      -- 買い目自体の予測確率
    odds DECIMAL(8,1),                       -- 3連単オッズ（race_odds由来のスナップショット）
    expected_value DECIMAL(6,3),             -- EV = predicted_probability × odds

    reasoning_story TEXT,                    -- 根拠ストーリー（1フレーズ、FR5）
    similar_condition_stats JSONB,           -- race_outcome_frequenciesから引いた類似条件実績のスナップショット

    created_at TIMESTAMPTZ DEFAULT NOW(),

    PRIMARY KEY (race_id, model_id, pattern_index, bet_rank)
);

CREATE INDEX IF NOT EXISTS idx_bet_candidates_race_model
    ON model_bet_candidates(race_id, model_id);

ALTER TABLE model_bet_candidates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bet_candidates_public_read" ON model_bet_candidates;
CREATE POLICY "bet_candidates_public_read"
  ON model_bet_candidates FOR SELECT
  USING (true);

-- ============================================================================
-- 備考
-- ============================================================================
-- ・predictions.feature_contributions (JSONB) に、艇ごとの根拠バッジ（FR6）と
--   イン崩れ会場内パーセンタイル（ADR 0012）を格納する。predictions テーブル自体の
--   カラム追加は不要（既存JSONBカラムで表現可能なため）
-- ・prediction_odds テーブル（3モデル固定カラム構造）は新モデルでは使用しない。
--   新モデルのオッズ付き買い目候補は model_bet_candidates.odds に持たせる
-- ・bet_recommendations（モリアーティ実装済み、model_id列あり）は新モデルの
--   EV・Kelly基準サマリー（1レース1行の集約情報）用に model_id='unified' で
--   継続利用する。model_bet_candidates は「複数買い目の内訳」、
--   bet_recommendations は「レース単位の推奨判定サマリー」という役割分担にする
