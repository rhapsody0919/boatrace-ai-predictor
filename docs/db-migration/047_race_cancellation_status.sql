-- レース中止・順延の検出結果を永続化するカラムを追加する（BOA-254）。
--
-- race_results.is_cancelled/is_no_raceは、rank1/rank2/rank3がNOT NULL制約のため
-- 着順が存在しない中止レースの行を作成できず、実質使用不可能だった
-- （docs/design/race-cancellation-detection/spec.md参照）。
-- racesテーブルに、発走前の暫定検知〜発走後の確定を1つの状態列で表現する
-- カラムを新設する。設計判断の詳細はdocs/adr/0039を参照。

-- cancellation_status:
--   NULL       = 通常（中止の疑いなし）
--   'tentative' = 発走前の暫定検知（3回連続で選手情報0人を検出、まだ確定していない）
--   'confirmed' = 確定（発走90分後を過ぎても結果が取得できなかった、または暫定から昇格）
ALTER TABLE races ADD COLUMN IF NOT EXISTS cancellation_status TEXT
  CHECK (cancellation_status IN ('tentative', 'confirmed'));

-- cancellation_check_streak: 選手情報0人の連続検知回数（内部カウンタ）。
-- 正常に選手情報が取得できた時点で0にリセットする。3に達したらtentativeに昇格する。
-- 詳細: docs/adr/0041
ALTER TABLE races ADD COLUMN IF NOT EXISTS cancellation_check_streak SMALLINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_races_cancellation_status
  ON races(cancellation_status) WHERE cancellation_status IS NOT NULL;
