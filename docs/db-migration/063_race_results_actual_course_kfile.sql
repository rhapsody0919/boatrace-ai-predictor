-- race_resultsに公式Kファイル（成績ファイル）方式で取得する実進入コースを追加する（BOA-257）
-- Supabase Dashboard > SQL Editor で実行する。
--
-- 背景: race_results.course_1〜6は scrapeCourseInfo()（scripts/daily/scrape-results.js）が
-- raceresultページHTMLの「スタート情報」テーブルから取得しているが、全保存レース（約4万件）で
-- 艇番と完全一致しており進入変化（前づけ）を検出できていないことが判明した（BOA-257）。
-- 調査の結果、参照しているHTML要素自体が実際の進入コースを表していない可能性が高いと判明。
--
-- 解決策: 公式の成績ファイル（Kファイル、https://www1.mbrace.or.jp/od2/K/{YYYYMM}/k{YYMMDD}.lzh）
-- には実際の進入コースが含まれている。実データ2026-09-11分（144レース・863艇）で検証済み:
-- 艇番と進入コースの不一致率10.2%（公式サイトが公開する枠番別コース取得率とほぼ一致）、
-- 1号艇0.0%→6号艇16.0%と単調増加しており物理的に整合する
-- （scripts/lib/kfileParser.js、scripts/maintenance/verify-actual-course-kfile-parser.js参照）。
--
-- 命名: 既存のcourse_1〜6（信頼できない、触らない）と明確に区別するため、
-- Kファイル由来であることが分かる actual_course_N とする（scripts/ml/backfill.py の
-- actual_course列と同じ命名、艇番Nが実際に進入したコース番号を表す）。
--
-- バックフィル方針: 2025-12-04以降の既存行はscripts/maintenance/backfill-actual-course.jsで
-- 別途バックフィルする（Kファイルアーカイブから取得するため、raceresultページの再スクレイピングは不要）。

ALTER TABLE race_results
    ADD COLUMN IF NOT EXISTS actual_course_1 SMALLINT,  -- 1号艇の実際の進入コース(1-6)
    ADD COLUMN IF NOT EXISTS actual_course_2 SMALLINT,  -- 2号艇の実際の進入コース(1-6)
    ADD COLUMN IF NOT EXISTS actual_course_3 SMALLINT,  -- 3号艇の実際の進入コース(1-6)
    ADD COLUMN IF NOT EXISTS actual_course_4 SMALLINT,  -- 4号艇の実際の進入コース(1-6)
    ADD COLUMN IF NOT EXISTS actual_course_5 SMALLINT,  -- 5号艇の実際の進入コース(1-6)
    ADD COLUMN IF NOT EXISTS actual_course_6 SMALLINT;  -- 6号艇の実際の進入コース(1-6、欠場等でKファイルに進入コース記載が無い艇はNULL)
