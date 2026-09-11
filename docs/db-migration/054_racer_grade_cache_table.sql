-- 選手検索・一覧機能（docs/design/racer-search-and-list/）:
-- 選手ごとの最新級別・勝率のキャッシュテーブル
-- race_history_cache（020番）と同じkey/JSONB-valueパターンを踏襲する。
-- レース領域とドメインが異なるためrace_history_cacheには相乗りせず別テーブルにする
-- （設計判断はdocs/adr/0043-racer-grade-win-rate-cache-strategy.md参照）。
-- data は055番のRPC（get_latest_racer_grades）の結果をscripts/daily/update-racer-grade-cache.js
-- が整形し、単一行（key='latest_grades'）のJSON配列として格納する。

CREATE TABLE IF NOT EXISTS racer_grade_cache (
  key TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_racer_grade_cache_updated_at
ON racer_grade_cache(updated_at DESC);

GRANT SELECT ON racer_grade_cache TO anon, authenticated;

ALTER TABLE racer_grade_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_anon_read" ON racer_grade_cache
  FOR SELECT
  USING (true);

-- 初期データ挿入（空配列で初期化）
-- scripts/daily/update-racer-grade-cache.js が実際のデータで上書きする
INSERT INTO racer_grade_cache (key, data, updated_at) VALUES
  ('latest_grades', '[]', NOW())
ON CONFLICT (key) DO NOTHING;
