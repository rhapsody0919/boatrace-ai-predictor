-- 枠番別・負け決まり手分析テーブル（BOA-157）
-- 会場別・枠番別に「その枠番が1着を逃した場合、勝者がどの決まり手で勝ったか」の
-- 割合を過去90日分集計して保持。既存のwinning_technique_stats（勝ち決まり手）と対になる。
--
-- 注意: 競合の元機能（差され率/捲られ率等）は途中経過の位置関係（誰が誰を抜いたか）
-- まで必要とするが、race_results は最終順位と勝者の決まり手しか持たないため、
-- 「その枠番が負けた場合の勝者側の決まり手」という、既存データで正確に算出できる形に
-- 設計し直した（BOA-150実装時にcourse_1〜6が恒等写像で使えないと判明した経緯と同様、
-- 手元データで誠実に表現できる粒度に留める）。

CREATE TABLE IF NOT EXISTS losing_technique_stats (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- キー
  venue_code        SMALLINT     NOT NULL,   -- 会場コード（1-24）
  boat_number       SMALLINT     NOT NULL,   -- 1着を逃した艇の枠番（1-6）
  losing_technique  TEXT         NOT NULL,   -- 負けた際の勝者側の決まり手（逃げ/差し/まくり/まくり差し/抜き/恵まれ等）

  -- 集計値
  count_90days       INTEGER      NOT NULL DEFAULT 0,  -- 過去90日の出現回数
  total_losses_90days INTEGER     NOT NULL DEFAULT 0,  -- 分母（会場×枠番の総敗北レース数）
  percentage         NUMERIC(5,2) NOT NULL DEFAULT 0,  -- 出現割合（%）

  -- メタデータ
  last_updated      DATE         NOT NULL,            -- 集計日（JST）
  created_at        TIMESTAMPTZ  DEFAULT NOW(),

  -- 制約
  UNIQUE(venue_code, boat_number, losing_technique)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_losing_technique_stats_venue
  ON losing_technique_stats(venue_code);

-- RLS 有効化
ALTER TABLE losing_technique_stats ENABLE ROW LEVEL SECURITY;

-- anon / authenticated: SELECT のみ
CREATE POLICY "Public read" ON losing_technique_stats
  FOR SELECT USING (true);

-- service_role: 全権
GRANT SELECT ON losing_technique_stats TO anon, authenticated;
GRANT ALL   ON losing_technique_stats TO service_role;
