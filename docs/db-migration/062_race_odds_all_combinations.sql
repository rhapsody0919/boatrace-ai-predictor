-- race_oddsにオッズ全券種（3連複・2連単・2連複・拡連複）の全通りを追加
-- 【草案】docs/design/scraping-full-coverage/plan.md FR-4、ADR-0054参照。
-- 実装時は現行mainブランチの最新マイグレーション番号を確認の上、採番し直すこと。
--
-- 背景: 現行は3連単のみ発走直前ウィンドウで全120通りをtrifecta_all（jsonb、
-- BOA-104）に保存している。3連複・2連単・2連複・拡連複は完全に未取得
-- （BOA-314、2026-09-15調査）。保存方式はADR-0054によりtrifecta_allと
-- 同じjsonb列方式を踏襲する（正規化テーブルは採用しない、理由はADR参照）。

ALTER TABLE race_odds
    ADD COLUMN IF NOT EXISTS trio_all JSONB,
    ADD COLUMN IF NOT EXISTS exacta_all JSONB,
    ADD COLUMN IF NOT EXISTS quinella_all JSONB,
    ADD COLUMN IF NOT EXISTS wide_all JSONB;

COMMENT ON COLUMN race_odds.trio_all IS
    '3連複全通り（jsonb、組み合わせ文字列をキーにしたオッズ値）。trifecta_allと同じ形式';
COMMENT ON COLUMN race_odds.exacta_all IS
    '2連単全通り（jsonb）。パーサーは新規実装（scripts/lib/oddsParser.js）';
COMMENT ON COLUMN race_odds.quinella_all IS
    '2連複全通り（jsonb）。パーサーは新規実装';
COMMENT ON COLUMN race_odds.wide_all IS
    '拡連複全通り（jsonb）。パーサーは新規実装';
