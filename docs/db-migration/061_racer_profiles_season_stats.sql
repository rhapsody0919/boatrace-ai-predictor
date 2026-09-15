-- racer_profilesに公式「期別成績」ページ由来のデータを追加
-- docs/design/scraping-full-coverage/plan.md FR-2 参照。BOA-321対応。
--
-- 背景: 選手ごとの公式ページ（boatrace.jp/owpc/pc/data/racersearch/season?toban=）に
-- 能力指数（級別審査に使う公式複合評価指数）・フライング回数・出遅れ回数（選手責任）が
-- 掲載されているが、現行未取得（BOA-321、2026-09-15調査）。
--
-- official_win_rate_period等は自社集計値との検算用途
-- （docs/design/scraping-full-coverage/plan.md「自社集計値との検算」、
-- scripts/analysis/verify-racer-season-stats-accuracy.js参照）。

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
    '集計対象期の識別子（例: 2026-first/2026-second）。前期=5/1-10/31集計、翌年1/1-6/30適用。後期=11/1-4/30集計、7/1-12/31適用。
発表タイミングは審査終了から約2ヶ月後（前期→11月上旬発表、後期→5月上旬発表）で確定（2026-09-15、複数年分の公式ニュースで裏取り済み:
boatrace.jp公式ニュース「2025年7月から適用の選手級別（2025年後期）を発表」2025-05公開が「後期審査→5月発表→7月適用」の実例、
boat-fan.jp「級別審査『2025年前期』まとめ」等の複数の第三者まとめ記事も同じ「前期=1月適用/後期=7月適用、発表は審査終了2ヶ月後」の説明で一致）。
この識別子自体はスクレイピング時に期別成績ページの「集計期間：YYYY/MM/DD-YYYY/MM/DD」表記の終了日から
scripts/lib/racerSeasonStats.js の derivePeriodLabel() で機械的に算出する（発表日を直接パースするわけではない）';
