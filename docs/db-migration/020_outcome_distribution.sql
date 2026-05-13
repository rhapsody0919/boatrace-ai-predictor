-- 出目分布テーブル（BOA-106）
-- 会場別・1着別の3連単出現パターンを過去90日分集計して保持

CREATE TABLE IF NOT EXISTS outcome_distribution (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- キー
  venue_code    SMALLINT    NOT NULL,   -- 会場コード（1-24）
  first_boat    SMALLINT    NOT NULL,   -- 1着艇番（1-6）
  second_boat   SMALLINT    NOT NULL,   -- 2着艇番（1-6）
  third_boat    SMALLINT    NOT NULL,   -- 3着艇番（1-6）

  -- 集計値
  count_90days  INTEGER     NOT NULL DEFAULT 0,  -- 過去90日の出現回数
  total_races   INTEGER     NOT NULL DEFAULT 0,  -- 分母（会場の総レース数）
  probability   NUMERIC(5,2) NOT NULL DEFAULT 0, -- 出現率（%）
  avg_payout    INTEGER,                         -- 3連単平均配当（円）

  -- メタデータ
  last_updated  DATE        NOT NULL,            -- 集計日（JST）
  created_at    TIMESTAMPTZ DEFAULT NOW(),

  -- 制約
  UNIQUE(venue_code, first_boat, second_boat, third_boat)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_outcome_dist_venue
  ON outcome_distribution(venue_code);

-- RLS 有効化
ALTER TABLE outcome_distribution ENABLE ROW LEVEL SECURITY;

-- anon / authenticated: SELECT のみ
CREATE POLICY "Public read" ON outcome_distribution
  FOR SELECT USING (true);

-- service_role: 全権
GRANT SELECT ON outcome_distribution TO anon, authenticated;
GRANT ALL   ON outcome_distribution TO service_role;
