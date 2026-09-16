-- 065: race_odds にオッズ全券種（3連複・2連単・2連複・拡連複）の
-- 全通りスナップショット列を追加（FR-4、BOA-314）
-- 対応spec/plan: docs/design/scraping-full-coverage/plan.md
-- Supabase Dashboard > SQL Editor で実行する。
--
-- 既存のtrifecta_all（3連単、022番マイグレーション）と同じJSON列方式を採用
-- （ADR-0054）。ADR-0057により、全通り捕捉は6窓（60/30/15/10/5/0分前）
-- 全てで行うよう拡張する（旧: 5分前の1窓のみ）。

ALTER TABLE race_odds
  ADD COLUMN IF NOT EXISTS trio_all JSONB,
  ADD COLUMN IF NOT EXISTS exacta_all JSONB,
  ADD COLUMN IF NOT EXISTS quinella_all JSONB,
  ADD COLUMN IF NOT EXISTS wide_all JSONB;

COMMENT ON COLUMN race_odds.trio_all IS
  '3連複全20通りのオッズ（例: {"1-2-3": 6.6, ...}、艇番昇順キー）。全通り捕捉ウィンドウのみ';
COMMENT ON COLUMN race_odds.exacta_all IS
  '2連単全30通りのオッズ（例: {"1-2": 3.4, "2-1": 49.0, ...}）。全通り捕捉ウィンドウのみ';
COMMENT ON COLUMN race_odds.quinella_all IS
  '2連複全15通りのオッズ（例: {"1-2": 3.4, ...}、艇番昇順キー）。全通り捕捉ウィンドウのみ';
COMMENT ON COLUMN race_odds.wide_all IS
  '拡連複全15通りのオッズ（例: {"1-2": {"low": 1.5, "high": 1.9}, ...}、艇番昇順キー、下限-上限のレンジ値）。全通り捕捉ウィンドウのみ';
