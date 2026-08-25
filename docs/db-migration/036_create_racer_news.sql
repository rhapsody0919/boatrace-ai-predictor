-- 選手ニュース（手動選定・承認済みのもののみ格納。下書き/未承認状態は持たない）
-- docs/adr/0022-racer-news-approval-flow.md 参照
--
-- 追加経路: Claudeがチャットで候補提示 → ユーザー承認 → scripts/maintenance/add-racer-news.js でINSERT
-- 参照経路: /racer/:racerId ページ（racer_id指定で一覧表示）、scripts/generate-sitemap.jsのgetRacerPages()

CREATE TABLE IF NOT EXISTS racer_news (
  id BIGSERIAL PRIMARY KEY,
  racer_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_name TEXT,
  published_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_racer_news_racer_id ON racer_news(racer_id);

-- RLS: 匿名ユーザーは読み取りのみ（書き込みは service role が RLS をバイパス）
ALTER TABLE racer_news ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "racer_news_public_read" ON racer_news;
CREATE POLICY "racer_news_public_read"
  ON racer_news FOR SELECT
  USING (true);
