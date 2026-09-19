-- 会場平均（会場×枠番→実進入コースの分布、選手非依存）をvenuesに持たせる（FR-6）
-- Supabase Dashboard > SQL Editor で実行する。
--
-- 対応spec/plan: docs/design/course-entry-tendency-rework/spec.md FR-6 / plan.md FR-6
-- 判断: docs/adr/0065-venue-course-entry-baseline-precomputed-table.md
--
-- 選手×会場×枠番は走数が薄い（中央値2走）ため、選手の実績に添える基準線として、
-- 選手を問わない会場×枠番の集計（各枠1,500走以上）を夜間バッチで事前集計して保存する。
-- 24行しか無く参照は「全会場を一括取得」のみのため、専用テーブルではなく
-- 既存のvenuesテーブルのjsonb列とする。
--
-- course_entry_baselineの形:
--   { "since": "2025-09-19",
--     "waku": { "1": { "n": 1968, "courses": { "1": 1942, "2": 15, ... } }, ... } }
--   waku=艇番(出走した枠)、courses=実際に進入したコースごとの回数、n=その枠の総走数

ALTER TABLE venues
    ADD COLUMN IF NOT EXISTS course_entry_baseline JSONB,
    ADD COLUMN IF NOT EXISTS course_entry_baseline_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN venues.course_entry_baseline IS
    '会場×枠番→実進入コースの回数（選手非依存、直近12ヶ月）。夜間バッチ(update-venue-course-entry-baseline.js)が更新する。';

-- 1会場分を集計して返す。全会場を1回で集計するとPostgRESTのタイムアウトを踏みうるため、
-- 呼び出し側（update-venue-course-entry-baseline.js）が会場ごとに呼ぶ。
-- actual_course_Nは「N号艇が実際に進入したコース」（添字=艇番、値=コース、kfileParser.js参照）。
CREATE OR REPLACE FUNCTION compute_venue_course_entry_baseline(
    p_venue_code SMALLINT,
    p_since DATE
) RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
    WITH x AS (
        SELECT e.boat_number AS waku,
               CASE e.boat_number
                    WHEN 1 THEN r.actual_course_1
                    WHEN 2 THEN r.actual_course_2
                    WHEN 3 THEN r.actual_course_3
                    WHEN 4 THEN r.actual_course_4
                    WHEN 5 THEN r.actual_course_5
                    WHEN 6 THEN r.actual_course_6 END AS course,
               -- 内側の艇が欠場（進入コースの記録が無い）だと、外側の艇のコースが繰り上がる。
               -- 選手の意思による前づけ・枠なりではないため集計から除外する。
               ((e.boat_number > 1 AND r.actual_course_1 IS NULL)
                OR (e.boat_number > 2 AND r.actual_course_2 IS NULL)
                OR (e.boat_number > 3 AND r.actual_course_3 IS NULL)
                OR (e.boat_number > 4 AND r.actual_course_4 IS NULL)
                OR (e.boat_number > 5 AND r.actual_course_5 IS NULL)) AS shifted
        FROM races ra
        JOIN race_entries e ON e.race_id = ra.race_id
        JOIN race_results r ON r.race_id = ra.race_id
        WHERE ra.venue_code = p_venue_code
          AND ra.race_date >= p_since
          AND r.actual_course_1 IS NOT NULL
    ), c AS (
        SELECT waku, course, count(*) AS cnt
        FROM x WHERE course IS NOT NULL AND NOT shifted
        GROUP BY waku, course
    ), w AS (
        SELECT waku, sum(cnt)::int AS n, jsonb_object_agg(course::text, cnt) AS courses
        FROM c GROUP BY waku
    )
    SELECT jsonb_build_object(
        'since', p_since,
        'waku', COALESCE(
            jsonb_object_agg(waku::text, jsonb_build_object('n', n, 'courses', courses)),
            '{}'::jsonb)
    ) FROM w;
$$;

-- 集計は重いため、バッチ（service_role）からのみ呼べるようにする
REVOKE EXECUTE ON FUNCTION compute_venue_course_entry_baseline(SMALLINT, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION compute_venue_course_entry_baseline(SMALLINT, DATE) TO service_role;
