-- 決まり手データ分析テーブル（BOA-150）
-- 会場別・枠番別の決まり手（逃げ/差し/まくり/まくり差し等）出現割合を過去90日分集計して保持
--
-- 注意: race_results.course_1〜6 は全34,262件で course_1=1固定（前付け後の実コースを
-- 追跡していない恒等写像）であることを実装時に確認したため、コース軸ではなく
-- rank1（1着艇番=枠番）を直接使う設計にした。競合の「枠別決まり手一覧表」とも
-- 意味的に一致する。

CREATE TABLE IF NOT EXISTS winning_technique_stats (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- キー
  venue_code        SMALLINT     NOT NULL,   -- 会場コード（1-24）
  boat_number       SMALLINT     NOT NULL,   -- 1着艇の枠番（1-6、race_results.rank1 と同じ値）
  winning_technique TEXT         NOT NULL,   -- 決まり手（逃げ/差し/まくり/まくり差し/抜き/恵まれ等）

  -- 集計値
  count_90days      INTEGER      NOT NULL DEFAULT 0,  -- 過去90日の出現回数
  total_races       INTEGER      NOT NULL DEFAULT 0,  -- 分母（会場×枠番の総レース数）
  percentage        NUMERIC(5,2) NOT NULL DEFAULT 0,  -- 出現割合（%）

  -- メタデータ
  last_updated      DATE         NOT NULL,            -- 集計日（JST）
  created_at        TIMESTAMPTZ  DEFAULT NOW(),

  -- 制約
  UNIQUE(venue_code, boat_number, winning_technique)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_winning_technique_stats_venue
  ON winning_technique_stats(venue_code);

-- RLS 有効化
ALTER TABLE winning_technique_stats ENABLE ROW LEVEL SECURITY;

-- anon / authenticated: SELECT のみ
CREATE POLICY "Public read" ON winning_technique_stats
  FOR SELECT USING (true);

-- service_role: 全権
GRANT SELECT ON winning_technique_stats TO anon, authenticated;
GRANT ALL   ON winning_technique_stats TO service_role;
