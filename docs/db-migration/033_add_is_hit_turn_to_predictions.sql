-- 展開予測的中フラグの永続化（Linear BOA-174/175/178、ADR 0013）
--
-- 背景: unifiedモデルの展開予測的中判定（turnPrediction.patternsのいずれかの
-- winnerCourseが実際の1着コースと一致するか）は、これまでpredictions.
-- feature_contributions（JSONB）とrace_resultsを都度突き合わせて計算する
-- 方式で、同一ロジックがクライアント側（RaceCard.jsx）・バックエンド側
-- （calculate-unified-model-accuracy.js）に個別実装され重複していた。
--
-- is_hit_win/is_hit_place/is_hit_trifecta/is_hit_trioと同じパターンで
-- カラムを追加し、結果反映バッチ（scrape-results.js）で一度だけ計算・
-- 保存する方式に統一する。

ALTER TABLE predictions
  ADD COLUMN IF NOT EXISTS is_hit_turn BOOLEAN;

COMMENT ON COLUMN predictions.is_hit_turn IS
  'unifiedモデルの展開予測的中判定。feature_contributions.turnPrediction.patternsのいずれかのwinnerCourseが実際の1着コース（race_results.rank1）と一致すればtrue。結果反映バッチ（scrape-results.js）で計算・保存。旧3モデル（model_id != unified）の行はNULLのまま。';
