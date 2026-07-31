-- 枠番別トップスタート分析テーブル（BOA-154）
-- 会場別・枠番別に「そのレースで最速STを記録した回数・確率」と
-- 「トップスタート時に実際に1着になった回数・確率」を過去90日分集計して保持
--
-- 注意: 競合の元機能は「コース別」（進入変更後の実コース）だが、race_results.course_1〜6は
-- 恒等写像で使えないことがBOA-150実装時に判明済み。race_start_timings.boat_number は
-- 画像アイコンから抽出した艇番そのものであり進入変更の有無に関わらず正確なため、
-- boatAI版は「枠番別」（艇番そのものの過去実績）として設計する。

CREATE TABLE IF NOT EXISTS top_start_stats (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- キー
  venue_code               SMALLINT     NOT NULL,   -- 会場コード（1-24）
  boat_number              SMALLINT     NOT NULL,   -- 枠番（1-6）

  -- 集計値
  race_count               INTEGER      NOT NULL DEFAULT 0,  -- 分母（会場×枠番の総レース数、過去90日）
  top_start_count          INTEGER      NOT NULL DEFAULT 0,  -- トップスタート（そのレースで最速ST、フライング除く）回数
  top_start_rate           NUMERIC(5,2) NOT NULL DEFAULT 0,  -- トップスタート確率（%）
  win_count_when_top_start INTEGER      NOT NULL DEFAULT 0,  -- トップスタート時に1着だった回数
  win_rate_when_top_start  NUMERIC(5,2) NOT NULL DEFAULT 0,  -- トップスタート時の1着率（%）

  -- メタデータ
  last_updated              DATE         NOT NULL,            -- 集計日（JST）
  created_at                 TIMESTAMPTZ  DEFAULT NOW(),

  -- 制約
  UNIQUE(venue_code, boat_number)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_top_start_stats_venue
  ON top_start_stats(venue_code);

-- RLS 有効化
ALTER TABLE top_start_stats ENABLE ROW LEVEL SECURITY;

-- anon / authenticated: SELECT のみ
CREATE POLICY "Public read" ON top_start_stats
  FOR SELECT USING (true);

-- service_role: 全権
GRANT SELECT ON top_start_stats TO anon, authenticated;
GRANT ALL   ON top_start_stats TO service_role;
