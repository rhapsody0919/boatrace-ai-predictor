-- 展示タイム最速艇の1着転換率分析テーブル（BOA-160）
-- 会場別・枠番別に「そのレースで最速の展示タイムを記録した回数・確率」と
-- 「展示タイム最速時に実際に1着になった回数・確率」を過去90日分集計して保持
--
-- 注意: BOA-154（トップスタート）と同じ理由で、複数艇が同タイムの場合（同着）は
-- 艇番の若い順等の恣意的なタイブレークがインコース有利のバイアスを生むため、
-- 集計から除外する（参加数=race_countには含める）。

CREATE TABLE IF NOT EXISTS exhibition_time_top_stats (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- キー
  venue_code                 SMALLINT     NOT NULL,   -- 会場コード（1-24）
  boat_number                SMALLINT     NOT NULL,   -- 枠番（1-6）

  -- 集計値
  race_count                 INTEGER      NOT NULL DEFAULT 0,  -- 分母（会場×枠番の総レース数、過去90日）
  fastest_count               INTEGER      NOT NULL DEFAULT 0,  -- 展示タイム最速（同着除く）回数
  fastest_rate                NUMERIC(5,2) NOT NULL DEFAULT 0,  -- 展示タイム最速率（%）
  win_count_when_fastest      INTEGER      NOT NULL DEFAULT 0,  -- 展示タイム最速時に1着だった回数
  win_rate_when_fastest       NUMERIC(5,2) NOT NULL DEFAULT 0,  -- 展示タイム最速時の1着率（%）

  -- メタデータ
  last_updated               DATE         NOT NULL,            -- 集計日（JST）
  created_at                  TIMESTAMPTZ  DEFAULT NOW(),

  -- 制約
  UNIQUE(venue_code, boat_number)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_exhibition_time_top_stats_venue
  ON exhibition_time_top_stats(venue_code);

-- RLS 有効化
ALTER TABLE exhibition_time_top_stats ENABLE ROW LEVEL SECURITY;

-- anon / authenticated: SELECT のみ
CREATE POLICY "Public read" ON exhibition_time_top_stats
  FOR SELECT USING (true);

-- service_role: 全権
GRANT SELECT ON exhibition_time_top_stats TO anon, authenticated;
GRANT ALL   ON exhibition_time_top_stats TO service_role;
