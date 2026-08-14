-- 複勝オッズのスクレイピング・保存対応（Linear BOA-176）
--
-- 背景: race_odds テーブルには単勝オッズ（odds_win_1〜6）のみ保存しており、
-- データ出走表の複勝予想欄では複勝オッズの代わりに単勝オッズを参考値として
-- 表示していた（ユーザー指摘、2026-08-14）。単勝オッズと複勝オッズは同一の
-- オッズページ（oddstf）に掲載されているため、新規スクレイピングページは不要
-- （scripts/daily/scrape-odds.js の scrapePlaceOdds 参照）。
--
-- 複勝オッズは「下限-上限」のレンジ表示（例: "3.9-4.6"）のため、艇ごとに
-- low/high の2カラムを持たせる（既存のodds_win_1〜6と同じ命名パターンに揃える）。

ALTER TABLE race_odds
  ADD COLUMN IF NOT EXISTS odds_place_1_low NUMERIC,
  ADD COLUMN IF NOT EXISTS odds_place_1_high NUMERIC,
  ADD COLUMN IF NOT EXISTS odds_place_2_low NUMERIC,
  ADD COLUMN IF NOT EXISTS odds_place_2_high NUMERIC,
  ADD COLUMN IF NOT EXISTS odds_place_3_low NUMERIC,
  ADD COLUMN IF NOT EXISTS odds_place_3_high NUMERIC,
  ADD COLUMN IF NOT EXISTS odds_place_4_low NUMERIC,
  ADD COLUMN IF NOT EXISTS odds_place_4_high NUMERIC,
  ADD COLUMN IF NOT EXISTS odds_place_5_low NUMERIC,
  ADD COLUMN IF NOT EXISTS odds_place_5_high NUMERIC,
  ADD COLUMN IF NOT EXISTS odds_place_6_low NUMERIC,
  ADD COLUMN IF NOT EXISTS odds_place_6_high NUMERIC;
