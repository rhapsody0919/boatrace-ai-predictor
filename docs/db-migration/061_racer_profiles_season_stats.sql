-- racer_profilesに公式「期別成績」ページ由来のデータを追加
-- 【草案】docs/design/scraping-full-coverage/plan.md FR-2 参照。
-- 実装時は現行mainブランチの最新マイグレーション番号を確認の上、採番し直すこと。
--
-- 背景: 選手ごとの公式ページ（boatrace.jp/owpc/pc/data/racersearch/season?toban=）に
-- 能力指数（級別審査に使う公式複合評価指数）・フライング回数・出遅れ回数（選手責任）が
-- 掲載されているが、現行未取得（BOA-321、2026-09-15調査）。
--
-- official_win_rate_period等は自社racer_aggregated_statsとの検算用途
-- （docs/design/scraping-full-coverage/plan.md「自社集計値との検算」参照）。

ALTER TABLE racer_profiles
    ADD COLUMN IF NOT EXISTS ability_index INTEGER,
    ADD COLUMN IF NOT EXISTS flying_count_period INTEGER,
    ADD COLUMN IF NOT EXISTS false_start_count_period INTEGER,
    ADD COLUMN IF NOT EXISTS period_label VARCHAR(20),
    ADD COLUMN IF NOT EXISTS official_win_rate_period NUMERIC(5, 2),
    ADD COLUMN IF NOT EXISTS official_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN racer_profiles.ability_index IS
    '公式サイト期別成績ページの能力指数。級別（A1/A2/B1/B2）決定に使う複合評価指数';
COMMENT ON COLUMN racer_profiles.flying_count_period IS
    '直近集計期間（前期/後期）のフライング回数（公式集計）';
COMMENT ON COLUMN racer_profiles.false_start_count_period IS
    '直近集計期間の出遅れ回数（選手責任と公式が認定したもののみ）';
COMMENT ON COLUMN racer_profiles.period_label IS
    '集計対象期の識別子（例: 2026-first/2026-second）。前期=5/1-10/31集計、翌年1/1-6/30適用（新級別の発表・期別成績ページ更新は集計終了直後の11月頃と推定）。後期=11/1-4/30集計、7/1-12/31適用（発表・ページ更新は5月頃と推定）。発表の正確な日付は未検証（2026-09-15、Web検索で確認した公式ニュース例:2026年後期の発表が2026年5月に行われた事例1件のみ、実装時に複数年分確認して裏取りすること）';
