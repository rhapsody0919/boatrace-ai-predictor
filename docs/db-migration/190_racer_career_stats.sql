-- 190: 選手ページ（艇国データバンクの受け皿、GS00 案2）の集計の表の土台。場別・期別・進入コース別・優勝戦の出走と、
--      その書き手が呼ぶ集計の RPC（service_role だけ）を作る
--
-- 対応spec/plan: docs/design/racer-period-stats/spec.md・docs/design/racer-period-stats/plan.md（§14）
-- 決定: docs/adr/0104-racer-career-stats-two-layer-tables.md（kb_archive の値を選手単位で匿名に出す。ADR-0067 の見直しの契機をオーナーに確かめた、2026-10-28）
-- 審査: docs/design/racer-period-stats/analysis/aggregate-tables-review.md（system-architect、設計 C）
--
-- ⚠️ この案は「本番へ未適用」。適用はオーナーが db-apply（GRANT と関数があるので heavy＝オーナーの1タップ）か SQL Editor で行う。
--
-- 作るもの:
--   表（どれも RLS 有効・anon と authenticated に SELECT だけ。書き手は service_role だけ）
--     racer_venue_stats     選手×会場×層×グレード×優勝戦か の、着のコードごとの件数
--     racer_term_stats      選手×期（5〜10月・11〜4月の始まりの日）×層×グレード×優勝戦か の、着のコードごとの件数
--     racer_course_stats    選手×進入コース×期×層 の、着のコードごとの件数（期を持つのは、公式の期別のコース別成績と照合し、直近の期だけを足せるようにするため）
--     racer_championships   優勝戦に出た艇（1レース最大6行）。優勝は finish_code='01'
--     racer_career_meta     層ごとの計算の記録（いつ・どの規則の版・元の表の行数の指紋）。画面は「未計算」と「0回」をこれで分ける
--   関数（どれも STABLE・SECURITY INVOKER・service_role だけ。書かずに返すだけで、書くのは呼び出し側の upsertChangedRows）
--     racer_career_inputs(p_era, p_from, p_to, p_active_from)        範囲の種別の原文・開催の題・（main だけ）直近に出た選手
--     racer_career_special_races(p_era, p_venue_days)                指定した開催日のレースと出た選手（グレードの補正の材料）
--     compute_racer_career_counts(p_era, p_from, p_to, p_racer_ids, p_final_stages, p_override_race_ids, p_override_grades)
--
-- 設計の要点（plan.md §14）:
--   - 層（era）は kb（kb_archive_*、race_date ≤ 2025-12-02）と main（races ほか、race_date ≥ 2025-12-03）。境目の日は
--     scripts/maintenance/kb-backfill.js の MAIN_TABLES_START（2025-12-03）。この SQL の 2 つの日付の定数は verify が照合する
--   - 率・勝率の点は持たない。着のコード（01〜06・F・L0・L1・K0・K1・S0・S1・S2・00）ごとの件数だけを持ち、
--     勝率・出走は src/pure/racerCareerStats.js（BOA-1193）の純関数で計算する。勝率の着順点はグレードと優勝戦かで変わるので、
--     場別・期別はその2つをキーに入れる（進入コース別は勝率を出さないので入れない）
--   - 優勝戦かどうかは、呼び出し側が src/pure/raceStageConfig.js の isFinalStage で種別の原文を判定し、p_final_stages で渡す
--     （kb_archive_races.stage_kind・is_final_day は使わない。GP優勝戦・賞金女王決定等を落とす）
--   - グレードは kb は kb_archive_venue_days.race_grade、main は races.race_grade、無ければ race_series.grade、それも無ければ
--     race_series.class_code（Lady・Takumi は G3、Rookie・Venus は ippan）。
--     QC/QCシリーズ・CC/レディースCC・唐津 2024-10-12〜14 は、呼び出し側がレースごとに決めて p_override_* で渡す
--   - kb は race_id の範囲（PK の先頭）で読む。kb_archive_boats に racer_id の索引は足さない
--   - main は race_entries の (racer_id, race_id) の索引で選手ごとに読む
--   - 戻り値は jsonb の1つ（集合で返すと PostgREST の上限1000行で黙って切れる）
--
-- 適用前の確認（読み取り）:
--   SELECT count(*) FROM pg_class WHERE relname IN ('racer_venue_stats','racer_term_stats','racer_course_stats','racer_championships','racer_career_meta');
--   → 0
--
-- 適用後の確認（読み取り。Claude が scripts/db/ro-query.js で行う）:
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'racer_c%' OR relname IN ('racer_venue_stats','racer_term_stats') ORDER BY 1;
--   → 5表とも relrowsecurity = true
--   SELECT has_table_privilege('anon', 'public.racer_venue_stats', 'SELECT'), has_any_column_privilege('anon', 'public.racer_venue_stats', 'INSERT');
--   → true / false（5表とも同じ）
--   SELECT has_function_privilege('anon', 'public.compute_racer_career_counts(text, date, date, integer[], text[], text[], text[])', 'EXECUTE');
--   → false（3関数とも anon・authenticated は false、service_role は true）
--   get_advisors（security）の rls_disabled_in_public が0件
--
-- 戻し方（書き込みの前なら安全。書いた後は計算し直せば戻る）:
--   DROP FUNCTION IF EXISTS public.compute_racer_career_counts(text, date, date, integer[], text[], text[], text[]);
--   DROP FUNCTION IF EXISTS public.racer_career_special_races(text, text[]);
--   DROP FUNCTION IF EXISTS public.racer_career_inputs(text, date, date, date);
--   DROP TABLE IF EXISTS racer_venue_stats, racer_term_stats, racer_course_stats, racer_championships, racer_career_meta;

BEGIN;

SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS racer_venue_stats (
  racer_id     integer  NOT NULL,
  venue_code   smallint NOT NULL CHECK (venue_code BETWEEN 1 AND 24),
  era          text     NOT NULL CHECK (era IN ('kb', 'main')),
  race_grade   text     NOT NULL CHECK (race_grade IN ('SG', 'G1', 'G2', 'G3', 'ippan', 'unknown')),
  is_final     boolean  NOT NULL,
  p1 integer NOT NULL DEFAULT 0, p2 integer NOT NULL DEFAULT 0, p3 integer NOT NULL DEFAULT 0,
  p4 integer NOT NULL DEFAULT 0, p5 integer NOT NULL DEFAULT 0, p6 integer NOT NULL DEFAULT 0,
  f  integer NOT NULL DEFAULT 0,
  l0 integer NOT NULL DEFAULT 0, l1 integer NOT NULL DEFAULT 0,
  k0 integer NOT NULL DEFAULT 0, k1 integer NOT NULL DEFAULT 0,
  s0 integer NOT NULL DEFAULT 0, s1 integer NOT NULL DEFAULT 0, s2 integer NOT NULL DEFAULT 0,
  code00     integer NOT NULL DEFAULT 0,
  other_code integer NOT NULL DEFAULT 0,
  updated_at timestamptz,
  PRIMARY KEY (racer_id, venue_code, era, race_grade, is_final),
  CONSTRAINT rvs_counts_nonneg CHECK (LEAST(p1, p2, p3, p4, p5, p6, f, l0, l1, k0, k1, s0, s1, s2, code00, other_code) >= 0)
);

CREATE TABLE IF NOT EXISTS racer_term_stats (
  racer_id     integer NOT NULL,
  term_start   date    NOT NULL CHECK (EXTRACT(DAY FROM term_start) = 1 AND EXTRACT(MONTH FROM term_start) IN (5, 11)),
  era          text    NOT NULL CHECK (era IN ('kb', 'main')),
  race_grade   text    NOT NULL CHECK (race_grade IN ('SG', 'G1', 'G2', 'G3', 'ippan', 'unknown')),
  is_final     boolean NOT NULL,
  p1 integer NOT NULL DEFAULT 0, p2 integer NOT NULL DEFAULT 0, p3 integer NOT NULL DEFAULT 0,
  p4 integer NOT NULL DEFAULT 0, p5 integer NOT NULL DEFAULT 0, p6 integer NOT NULL DEFAULT 0,
  f  integer NOT NULL DEFAULT 0,
  l0 integer NOT NULL DEFAULT 0, l1 integer NOT NULL DEFAULT 0,
  k0 integer NOT NULL DEFAULT 0, k1 integer NOT NULL DEFAULT 0,
  s0 integer NOT NULL DEFAULT 0, s1 integer NOT NULL DEFAULT 0, s2 integer NOT NULL DEFAULT 0,
  code00     integer NOT NULL DEFAULT 0,
  other_code integer NOT NULL DEFAULT 0,
  updated_at timestamptz,
  PRIMARY KEY (racer_id, term_start, era, race_grade, is_final),
  CONSTRAINT rts_counts_nonneg CHECK (LEAST(p1, p2, p3, p4, p5, p6, f, l0, l1, k0, k1, s0, s1, s2, code00, other_code) >= 0)
);

CREATE TABLE IF NOT EXISTS racer_course_stats (
  racer_id   integer  NOT NULL,
  course     smallint NOT NULL CHECK (course BETWEEN 1 AND 6),
  term_start date     NOT NULL CHECK (EXTRACT(DAY FROM term_start) = 1 AND EXTRACT(MONTH FROM term_start) IN (5, 11)),
  era        text     NOT NULL CHECK (era IN ('kb', 'main')),
  p1 integer NOT NULL DEFAULT 0, p2 integer NOT NULL DEFAULT 0, p3 integer NOT NULL DEFAULT 0,
  p4 integer NOT NULL DEFAULT 0, p5 integer NOT NULL DEFAULT 0, p6 integer NOT NULL DEFAULT 0,
  f  integer NOT NULL DEFAULT 0,
  l0 integer NOT NULL DEFAULT 0, l1 integer NOT NULL DEFAULT 0,
  k0 integer NOT NULL DEFAULT 0, k1 integer NOT NULL DEFAULT 0,
  s0 integer NOT NULL DEFAULT 0, s1 integer NOT NULL DEFAULT 0, s2 integer NOT NULL DEFAULT 0,
  code00     integer NOT NULL DEFAULT 0,
  other_code integer NOT NULL DEFAULT 0,
  updated_at timestamptz,
  PRIMARY KEY (racer_id, course, term_start, era),
  CONSTRAINT rcs_counts_nonneg CHECK (LEAST(p1, p2, p3, p4, p5, p6, f, l0, l1, k0, k1, s0, s1, s2, code00, other_code) >= 0)
);

CREATE TABLE IF NOT EXISTS racer_championships (
  race_id      text     NOT NULL,
  racer_id     integer  NOT NULL,
  era          text     NOT NULL CHECK (era IN ('kb', 'main')),
  race_date    date     NOT NULL,
  venue_code   smallint NOT NULL CHECK (venue_code BETWEEN 1 AND 24),
  race_grade   text     NOT NULL CHECK (race_grade IN ('SG', 'G1', 'G2', 'G3', 'ippan', 'unknown')),
  series_title text,
  stage        text,
  boat_number  smallint NOT NULL CHECK (boat_number BETWEEN 1 AND 6),
  course       smallint CHECK (course BETWEEN 1 AND 6),
  finish_code  text     NOT NULL,
  updated_at   timestamptz,
  PRIMARY KEY (race_id, racer_id)
);
-- 選手ページは選手ごとに日付の新しい順で読む
CREATE INDEX IF NOT EXISTS idx_racer_championships_racer ON racer_championships (racer_id, race_date DESC);

CREATE TABLE IF NOT EXISTS racer_career_meta (
  era          text PRIMARY KEY CHECK (era IN ('kb', 'main')),
  computed_at  timestamptz NOT NULL,
  rule_version text NOT NULL,
  source_from  date,
  source_to    date,
  source_rows  bigint NOT NULL CHECK (source_rows >= 0),
  fingerprint  jsonb  NOT NULL,
  report       jsonb,
  updated_at   timestamptz
);

REVOKE ALL ON racer_venue_stats, racer_term_stats, racer_course_stats, racer_championships, racer_career_meta FROM anon, authenticated;
ALTER TABLE racer_venue_stats   ENABLE ROW LEVEL SECURITY;
ALTER TABLE racer_term_stats    ENABLE ROW LEVEL SECURITY;
ALTER TABLE racer_course_stats  ENABLE ROW LEVEL SECURITY;
ALTER TABLE racer_championships ENABLE ROW LEVEL SECURITY;
ALTER TABLE racer_career_meta   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS racer_venue_stats_public_read ON racer_venue_stats;
CREATE POLICY racer_venue_stats_public_read ON racer_venue_stats FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS racer_term_stats_public_read ON racer_term_stats;
CREATE POLICY racer_term_stats_public_read ON racer_term_stats FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS racer_course_stats_public_read ON racer_course_stats;
CREATE POLICY racer_course_stats_public_read ON racer_course_stats FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS racer_championships_public_read ON racer_championships;
CREATE POLICY racer_championships_public_read ON racer_championships FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS racer_career_meta_public_read ON racer_career_meta;
CREATE POLICY racer_career_meta_public_read ON racer_career_meta FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON racer_venue_stats TO anon, authenticated;
GRANT SELECT ON racer_term_stats TO anon, authenticated;
GRANT SELECT ON racer_course_stats TO anon, authenticated;
GRANT SELECT ON racer_championships TO anon, authenticated;
GRANT SELECT ON racer_career_meta TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- racer_career_inputs: 範囲の種別の原文と開催の題（呼び出し側が isFinalStage とグレードの補正の規則を当てる）。
--   p_active_from を渡すと（main だけ）、その日以降に出走表に載った選手の racer_id も返す（毎晩の計算し直しの対象）。
--   kb は race_id の範囲で読む（p_from 以上 p_to 未満）。
-- 返す値: { "stages": [text], "series": [{venue_code, race_date, title}], "active_racer_ids": [int] }
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.racer_career_inputs(
  p_era text,
  p_from date,
  p_to date,
  p_active_from date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_from text := to_char(p_from, 'YYYY-MM-DD');
  v_to   text := to_char(p_to, 'YYYY-MM-DD');
BEGIN
  IF p_era = 'kb' THEN
    RETURN jsonb_build_object(
      'stages', COALESCE((
        SELECT jsonb_agg(DISTINCT r.stage) FROM kb_archive_races r
        WHERE r.race_id >= v_from AND r.race_id < v_to AND r.race_date <= DATE '2025-12-02' AND r.stage IS NOT NULL
      ), '[]'::jsonb),
      'series', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('venue_code', d.venue_code, 'race_date', d.race_date, 'title', d.title)
                         ORDER BY d.race_date, d.venue_code)
        FROM kb_archive_venue_days d
        WHERE d.race_date >= p_from AND d.race_date < p_to AND d.race_date <= DATE '2025-12-02'
      ), '[]'::jsonb),
      'active_racer_ids', '[]'::jsonb
    );
  ELSIF p_era = 'main' THEN
    RETURN jsonb_build_object(
      'stages', COALESCE((
        SELECT jsonb_agg(DISTINCT rc.race_stage) FROM race_conditions rc
        WHERE rc.race_id >= v_from AND rc.race_id < v_to AND rc.race_id >= '2025-12-03' AND rc.race_stage IS NOT NULL
      ), '[]'::jsonb),
      'series', COALESCE((
        SELECT jsonb_agg(x ORDER BY x->>'race_date', (x->>'venue_code')::int) FROM (
          SELECT DISTINCT jsonb_build_object('venue_code', ra.venue_code, 'race_date', ra.race_date,
                                             'title', COALESCE(rc.race_title, rs.title)) AS x
          FROM races ra
          LEFT JOIN race_conditions rc ON rc.race_id = ra.race_id
          LEFT JOIN LATERAL (
            SELECT s.title FROM race_series s
            WHERE s.venue_code = ra.venue_code AND ra.race_date BETWEEN s.start_date AND s.end_date
            ORDER BY s.start_date DESC LIMIT 1
          ) rs ON true
          WHERE ra.race_date >= p_from AND ra.race_date < p_to AND ra.race_date >= DATE '2025-12-03'
        ) t
      ), '[]'::jsonb),
      -- 直近に出走表に載った選手に、着のコードが直近に書き換わった選手（K ファイルの後からの訂正、071 の updated_at）を足す
      'active_racer_ids', CASE WHEN p_active_from IS NULL THEN '[]'::jsonb ELSE COALESCE((
        SELECT jsonb_agg(DISTINCT x.racer_id) FROM (
          SELECT re.racer_id FROM race_entries re
          JOIN races ra ON ra.race_id = re.race_id
          WHERE ra.race_date >= GREATEST(p_active_from, DATE '2025-12-03') AND ra.race_date < p_to AND re.racer_id IS NOT NULL
          UNION
          SELECT re.racer_id FROM race_start_timings rst
          JOIN race_entries re ON re.race_id = rst.race_id AND re.boat_number = rst.boat_number
          WHERE rst.updated_at >= (p_active_from::timestamp AT TIME ZONE 'Asia/Tokyo') AND rst.race_id >= '2025-12-03' AND rst.race_id < v_to AND re.racer_id IS NOT NULL
        ) x
      ), '[]'::jsonb) END
    );
  END IF;
  RAISE EXCEPTION 'racer_career_inputs: p_era は kb か main（%）', p_era;
END;
$$;

REVOKE ALL ON FUNCTION public.racer_career_inputs(text, date, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.racer_career_inputs(text, date, date, date) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.racer_career_inputs(text, date, date, date) TO service_role;

-- ---------------------------------------------------------------------------
-- racer_career_special_races: 開催日（'YYYY-MM-DD-VV'、会場は2桁）ごとのレースと出た選手。
--   QC/QCシリーズ・CC/レディースCC は同じ開催日に2つの格のレースが混ざるので、呼び出し側が選手のつながりで分ける。
-- 返す値: [{race_id, race_number, stage, racer_ids: [int]}]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.racer_career_special_races(
  p_era text,
  p_venue_days text[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_era = 'kb' THEN
    RETURN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('race_id', r.race_id, 'race_number', r.race_number, 'stage', r.stage,
                                          'racer_ids', (SELECT COALESCE(jsonb_agg(b.racer_id ORDER BY b.boat_number), '[]'::jsonb)
                                                        FROM kb_archive_boats b WHERE b.race_id = r.race_id AND b.racer_id IS NOT NULL))
                       ORDER BY r.race_id)
      FROM kb_archive_races r
      WHERE r.venue_day_id = ANY (p_venue_days) AND r.race_date <= DATE '2025-12-02'
    ), '[]'::jsonb);
  ELSIF p_era = 'main' THEN
    RETURN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('race_id', ra.race_id, 'race_number', ra.race_number, 'stage', rc.race_stage,
                                          'racer_ids', (SELECT COALESCE(jsonb_agg(e.racer_id ORDER BY e.boat_number), '[]'::jsonb)
                                                        FROM race_entries e WHERE e.race_id = ra.race_id AND e.racer_id IS NOT NULL))
                       ORDER BY ra.race_id)
      FROM races ra
      LEFT JOIN race_conditions rc ON rc.race_id = ra.race_id
      WHERE (to_char(ra.race_date, 'YYYY-MM-DD') || '-' || lpad(ra.venue_code::text, 2, '0')) = ANY (p_venue_days)
        AND ra.race_date >= DATE '2025-12-03'
    ), '[]'::jsonb);
  END IF;
  RAISE EXCEPTION 'racer_career_special_races: p_era は kb か main（%）', p_era;
END;
$$;

REVOKE ALL ON FUNCTION public.racer_career_special_races(text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.racer_career_special_races(text, text[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.racer_career_special_races(text, text[]) TO service_role;

-- ---------------------------------------------------------------------------
-- compute_racer_career_counts: 着のコードごとの件数を4つの集計にして返す（書かない）。
--   kb:   race_id が p_from 以上 p_to 未満（kb_archive_boats の PK の範囲読み）。p_racer_ids は NULL（全選手）
--   main: p_racer_ids の選手の、race_date が p_from 以上 p_to 未満の走（race_entries の (racer_id, race_id) 索引）
--   着のコードは kb が kb_archive_boats.finish_raw、main が race_start_timings.official_finish_code（どちらも K ファイルの生コード）。
--   コードが NULL の走（中止・順延・K の未着）は数えない。進入コースは kb が kb_archive_boats.course、main が race_results.actual_course_N。
-- 返す値: { "venue": [...], "term": [...], "course": [...], "finals": [...], "boat_rows": int, "max_race_date": date }
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_racer_career_counts(
  p_era text,
  p_from date,
  p_to date,
  p_racer_ids integer[],
  p_final_stages text[],
  p_override_race_ids text[],
  p_override_grades text[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_from text := to_char(p_from, 'YYYY-MM-DD');
  v_to   text := to_char(p_to, 'YYYY-MM-DD');
  v_result jsonb;
BEGIN
  IF p_era NOT IN ('kb', 'main') THEN
    RAISE EXCEPTION 'compute_racer_career_counts: p_era は kb か main（%）', p_era;
  END IF;
  IF p_era = 'main' AND p_racer_ids IS NULL THEN
    RAISE EXCEPTION 'compute_racer_career_counts: main は p_racer_ids を渡す（全選手を1回で読まない）';
  END IF;
  IF COALESCE(array_length(p_override_race_ids, 1), 0) <> COALESCE(array_length(p_override_grades, 1), 0) THEN
    RAISE EXCEPTION 'compute_racer_career_counts: p_override_race_ids と p_override_grades の長さが違う';
  END IF;

  WITH ov AS (
    SELECT o.race_id, o.grade FROM unnest(p_override_race_ids, p_override_grades) AS o(race_id, grade)
  ),
  kb AS (
    SELECT b.racer_id, r.race_id, r.race_date, r.venue_code, r.stage, d.race_grade AS base_grade, d.title,
           b.boat_number, b.course, b.finish_raw AS code
    FROM kb_archive_boats b
    JOIN kb_archive_races r ON r.race_id = b.race_id
    JOIN kb_archive_venue_days d ON d.venue_day_id = r.venue_day_id
    WHERE p_era = 'kb'
      AND b.race_id >= v_from AND b.race_id < v_to
      AND r.race_date <= DATE '2025-12-02'
      AND b.racer_id IS NOT NULL
      AND (p_racer_ids IS NULL OR b.racer_id = ANY (p_racer_ids))
  ),
  mn AS (
    SELECT re.racer_id, ra.race_id, ra.race_date, ra.venue_code, rc.race_stage AS stage,
           -- 2025-12-03〜2026-02-02 の Lady・Rookie・Takumi・Venus の節は races.race_grade も race_series.grade も NULL
           -- （876レース、system-architect の再審査）。月間スケジュールの class_code から公式の格に読み替える
           COALESCE(ra.race_grade, rs.grade,
                    CASE rs.class_code WHEN 'Lady' THEN 'G3' WHEN 'Takumi' THEN 'G3'
                                       WHEN 'Rookie' THEN 'ippan' WHEN 'Venus' THEN 'ippan' END) AS base_grade,
           COALESCE(rc.race_title, rs.title) AS title,
           re.boat_number,
           CASE re.boat_number
             WHEN 1 THEN rr.actual_course_1 WHEN 2 THEN rr.actual_course_2 WHEN 3 THEN rr.actual_course_3
             WHEN 4 THEN rr.actual_course_4 WHEN 5 THEN rr.actual_course_5 WHEN 6 THEN rr.actual_course_6
           END AS course,
           rst.official_finish_code AS code
    FROM race_entries re
    JOIN races ra ON ra.race_id = re.race_id
    LEFT JOIN race_start_timings rst ON rst.race_id = re.race_id AND rst.boat_number = re.boat_number
    LEFT JOIN race_results rr ON rr.race_id = re.race_id
    LEFT JOIN race_conditions rc ON rc.race_id = re.race_id
    LEFT JOIN LATERAL (
      SELECT s.grade, s.class_code, s.title FROM race_series s
      WHERE s.venue_code = ra.venue_code AND ra.race_date BETWEEN s.start_date AND s.end_date
      ORDER BY s.start_date DESC LIMIT 1
    ) rs ON true
    WHERE p_era = 'main'
      AND re.racer_id = ANY (p_racer_ids)
      AND re.race_id >= v_from AND re.race_id < v_to
      AND ra.race_date >= DATE '2025-12-03'
  ),
  base AS MATERIALIZED (
    SELECT s.racer_id, s.race_id, s.race_date, s.venue_code, s.stage, s.title, s.boat_number,
           CASE WHEN s.course BETWEEN 1 AND 6 THEN s.course END AS course,
           s.code,
           COALESCE(ov.grade,
                    CASE WHEN s.base_grade IN ('SG', 'G1', 'G2', 'G3', 'ippan') THEN s.base_grade ELSE 'unknown' END) AS race_grade,
           COALESCE(s.stage = ANY (p_final_stages), false) AS is_final,
           -- 期: 5〜10月は その年の5/1、11〜12月は その年の11/1、1〜4月は 前の年の11/1（公式の期別成績の算出期間）
           CASE
             WHEN EXTRACT(MONTH FROM s.race_date) BETWEEN 5 AND 10 THEN make_date(EXTRACT(YEAR FROM s.race_date)::int, 5, 1)
             WHEN EXTRACT(MONTH FROM s.race_date) >= 11 THEN make_date(EXTRACT(YEAR FROM s.race_date)::int, 11, 1)
             ELSE make_date(EXTRACT(YEAR FROM s.race_date)::int - 1, 11, 1)
           END AS term_start
    FROM (SELECT * FROM kb UNION ALL SELECT * FROM mn) s
    LEFT JOIN ov ON ov.race_id = s.race_id
    WHERE s.code IS NOT NULL
  ),
  venue AS (
    SELECT racer_id, venue_code, race_grade, is_final,
      count(*) FILTER (WHERE code = '01') AS p1, count(*) FILTER (WHERE code = '02') AS p2,
      count(*) FILTER (WHERE code = '03') AS p3, count(*) FILTER (WHERE code = '04') AS p4,
      count(*) FILTER (WHERE code = '05') AS p5, count(*) FILTER (WHERE code = '06') AS p6,
      count(*) FILTER (WHERE code = 'F') AS f,
      count(*) FILTER (WHERE code = 'L0') AS l0, count(*) FILTER (WHERE code = 'L1') AS l1,
      count(*) FILTER (WHERE code = 'K0') AS k0, count(*) FILTER (WHERE code = 'K1') AS k1,
      count(*) FILTER (WHERE code = 'S0') AS s0, count(*) FILTER (WHERE code = 'S1') AS s1,
      count(*) FILTER (WHERE code = 'S2') AS s2, count(*) FILTER (WHERE code = '00') AS code00,
      count(*) FILTER (WHERE code NOT IN ('01','02','03','04','05','06','F','L0','L1','K0','K1','S0','S1','S2','00')) AS other_code
    FROM base GROUP BY racer_id, venue_code, race_grade, is_final
  ),
  term AS (
    SELECT racer_id, term_start, race_grade, is_final,
      count(*) FILTER (WHERE code = '01') AS p1, count(*) FILTER (WHERE code = '02') AS p2,
      count(*) FILTER (WHERE code = '03') AS p3, count(*) FILTER (WHERE code = '04') AS p4,
      count(*) FILTER (WHERE code = '05') AS p5, count(*) FILTER (WHERE code = '06') AS p6,
      count(*) FILTER (WHERE code = 'F') AS f,
      count(*) FILTER (WHERE code = 'L0') AS l0, count(*) FILTER (WHERE code = 'L1') AS l1,
      count(*) FILTER (WHERE code = 'K0') AS k0, count(*) FILTER (WHERE code = 'K1') AS k1,
      count(*) FILTER (WHERE code = 'S0') AS s0, count(*) FILTER (WHERE code = 'S1') AS s1,
      count(*) FILTER (WHERE code = 'S2') AS s2, count(*) FILTER (WHERE code = '00') AS code00,
      count(*) FILTER (WHERE code NOT IN ('01','02','03','04','05','06','F','L0','L1','K0','K1','S0','S1','S2','00')) AS other_code
    FROM base GROUP BY racer_id, term_start, race_grade, is_final
  ),
  course AS (
    SELECT racer_id, course, term_start,
      count(*) FILTER (WHERE code = '01') AS p1, count(*) FILTER (WHERE code = '02') AS p2,
      count(*) FILTER (WHERE code = '03') AS p3, count(*) FILTER (WHERE code = '04') AS p4,
      count(*) FILTER (WHERE code = '05') AS p5, count(*) FILTER (WHERE code = '06') AS p6,
      count(*) FILTER (WHERE code = 'F') AS f,
      count(*) FILTER (WHERE code = 'L0') AS l0, count(*) FILTER (WHERE code = 'L1') AS l1,
      count(*) FILTER (WHERE code = 'K0') AS k0, count(*) FILTER (WHERE code = 'K1') AS k1,
      count(*) FILTER (WHERE code = 'S0') AS s0, count(*) FILTER (WHERE code = 'S1') AS s1,
      count(*) FILTER (WHERE code = 'S2') AS s2, count(*) FILTER (WHERE code = '00') AS code00,
      count(*) FILTER (WHERE code NOT IN ('01','02','03','04','05','06','F','L0','L1','K0','K1','S0','S1','S2','00')) AS other_code
    FROM base WHERE course IS NOT NULL GROUP BY racer_id, course, term_start
  ),
  finals AS (
    SELECT race_id, racer_id, race_date, venue_code, race_grade, title AS series_title, stage, boat_number, course,
           code AS finish_code
    FROM base WHERE is_final
  )
  SELECT jsonb_build_object(
    'venue',  COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.racer_id, v.venue_code, v.race_grade, v.is_final) FROM venue v), '[]'::jsonb),
    'term',   COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.racer_id, t.term_start, t.race_grade, t.is_final) FROM term t), '[]'::jsonb),
    'course', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.racer_id, c.course, c.term_start) FROM course c), '[]'::jsonb),
    'finals', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.race_id, x.racer_id) FROM finals x), '[]'::jsonb),
    'boat_rows', (SELECT count(*) FROM base),
    'max_race_date', (SELECT max(race_date) FROM base)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_racer_career_counts(text, date, date, integer[], text[], text[], text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_racer_career_counts(text, date, date, integer[], text[], text[], text[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_racer_career_counts(text, date, date, integer[], text[], text[], text[]) TO service_role;

COMMENT ON TABLE racer_venue_stats IS '選手×会場×層（kb=2019-04〜2025-12-02、main=2025-12-03〜）×グレード×優勝戦か の、着のコードごとの件数（190、GS00 案2）。率・勝率は持たない（src/pure/racerCareerStats.js で計算）。書き手は scripts/maintenance/racer-career-backfill.js（kb・main の初回）と api/cron/racer-career-main.js（main の毎晩）';
COMMENT ON TABLE racer_term_stats IS '選手×期（term_start=5/1 か 11/1、公式の期別成績の算出期間）×層×グレード×優勝戦か の、着のコードごとの件数（190）。暦の年ではない。kb の 2018-11-01 の期は 2019-04 の1か月だけ';
COMMENT ON TABLE racer_course_stats IS '選手×進入コース×期×層 の、着のコードごとの件数（190）。進入コースは kb_archive_boats.course・race_results.actual_course_N';
COMMENT ON TABLE racer_championships IS '優勝戦（src/pure/raceStageConfig.js の isFinalStage）に出た艇（190）。優勝は finish_code=''01''。優出に S0・K0 等を含めるかは読み手が finish_code で決める';
COMMENT ON TABLE racer_career_meta IS '層ごとの計算の記録（190）。行が無い層は「未計算」。fingerprint は元の表の行数と最大の日付（kb_archive の再投入を見張る）';

COMMIT;
