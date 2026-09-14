-- race_conditionsに開催ステージ名（予選/準優勝戦/優勝戦等）を追加（BOA-226）
-- Supabase Dashboard > SQL Editor で実行する。
--
-- 背景: 「このモーターがいつ・誰が乗った時に優勝戦で1着になったか」を
-- 表示したいという要望（BOA-264追加調査）を受け、その前提として
-- 「どのレースが優勝戦か」を判定できる必要がある。公式サイト（boatrace.jp）
-- のracelistページに、レースのステージ名を直接示す構造化要素が存在する
-- ことを実際のHTMLで確認済み（BOA-226調査、2026-09-12）:
--
--   <h3 class="title16_titleDetail__add2020">優勝戦　　　　1800m</h3>
--
-- 大村G1最終日12Rで「優勝戦」、初日1Rで「予選」、通常の一般戦（福岡）で
-- 「カタメン１予選」を実際に確認しており、値は正規化されたenumではなく
-- 公式サイトが表示する生の文字列（「優勝戦」を含むかで判定する想定）。
--
-- バックフィル方針: 過去レースへの遡及取得は行わない（scripts/daily/
-- update-race-info.jsの改修後、新規に取得されるレースのみに反映される）。
-- 既存行はrace_stageがNULLのままになる。

ALTER TABLE race_conditions
    ADD COLUMN IF NOT EXISTS race_stage VARCHAR(30);

COMMENT ON COLUMN race_conditions.race_stage IS
    '公式サイトracelistページの.title16_titleDetail__add2020から抽出したレースステージ名（例: 予選/準優勝戦/優勝戦/カタメン１予選）。正規化されていない生の文字列';
