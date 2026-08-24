-- 選手プロフィールテーブル（boatrace.jp選手検索ページからのスクレイピング結果）
-- racer-fortune-telling（占術検証、Step1）が生年月日を使用。
-- racer-news-feature（選手個別ページ、未実装）でも共有利用する想定（docs/adr/0019参照）
--
-- 取得元: https://www.boatrace.jp/owpc/pc/data/racersearch/profile?toban={racer_id}
-- 取得対象: race_entries に登場する全 racer_id（2026-08-24時点で約1,637人）
-- 除外（行を作らない）: 生年月日が取得できない選手（プロフィールページ自体が存在しない等）

CREATE TABLE IF NOT EXISTS racer_profiles (
  racer_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  name_kana TEXT,
  birth_date DATE NOT NULL,
  height_cm INTEGER,
  weight_kg INTEGER,
  blood_type TEXT,
  branch TEXT,
  hometown TEXT,
  registration_period TEXT,
  -- スクレイピング時点の級別スナップショット。race_entries.grade（レース時点、昇降級で変動）とは別物
  grade_at_scrape TEXT,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN racer_profiles.grade_at_scrape IS
  'スクレイピング実行時点の級別スナップショット。race_entries.grade（レース時点の級別）と混同しないこと';

-- RLS: 匿名ユーザーは読み取りのみ（書き込みは service role が RLS をバイパス）
ALTER TABLE racer_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "racer_profiles_public_read" ON racer_profiles;
CREATE POLICY "racer_profiles_public_read"
  ON racer_profiles FOR SELECT
  USING (true);
