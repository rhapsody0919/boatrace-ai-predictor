-- 094: コース×級別のベースラインの事前集計テーブル2つ（phase a / FR-1・FR-6）
--
-- 対応設計: docs/design/analysis-visualization-upgrade/plan.md §2 / spec.md FR-1・FR-6 / docs/adr/0068-course-baseline-precomputation.md
-- 対応Linearチケット: BOA-305（レース詳細のUI/UX改善）配下
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認のもとで行う（docs/db-migration/APPLIED.md）。
--
-- 2026-09-23改訂: /step4 着手前の独立レビュー（.claude/rules/sdd-workflow.md）を受けて、
--   * st_course_baseline の主キーを course（6行）から (course, grade)（24行）に変更した。
--     級別の交絡がコース差と同じ大きさで実在し（1コース安定率 A1 74.4% vs B2 56.5% = 17.9pt）、
--     24セルすべてで n >= 1,079 あるため。「級別に分けるとnが減る」という当初の却下理由は実測で否定された
--   * 集計窓を window_days = 365 の固定値から、実測の window_start / window_end / window_days に変更した。
--     実データは 2025-12-03〜2026-09-23 の295日しかなく、クライアント側（getRacerScopedRaceStats）は
--     730日窓で取る。今は両方が全件を指すため一致するが、1年を超えると静かにずれる。
--     画面は window_start / window_end を読み、選手側の集計も同じ範囲でフィルタする
--   * 抜出率を率（breakout_rate）から実回数ベース（breakout_count / runs）に変更した。
--     5・6コースは30走あたりの期待回数が0.2〜0.4回で、率にすると 0.0% が並ぶか1回で3.3%に跳ねる
--   * Fの符号反転をやめ、Fを母数からもST順1位の基準からも除外する方式にした（ADR-0068 却下5）
--
-- 適用手順: Supabase Dashboard > SQL Editor、またはManagement API で、次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
--
-- 適用後の確認（読み取りのみ）:
--   SELECT has_table_privilege('anon','public.st_course_baseline','SELECT'),
--          has_table_privilege('anon','public.st_course_baseline','INSERT');
--   → true, false（nige_second_by_course も同じ）
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname IN
--     ('st_course_baseline','nige_second_by_course'); → 2行とも true
--
-- ロールバック:
--   DROP TABLE IF EXISTS public.nige_second_by_course;
--   DROP TABLE IF EXISTS public.st_course_baseline;
--   ※ロールバックしてもクライアントの localStorage キャッシュには最大7日間、
--     古い値が残りうる（inferTtlFromKey の PAST_RACE_CACHE_TTL）。画面側は
--     キャッシュキーにスキーマ版を含め、撤回時にキーを変えて無効化する（plan.md §6）
--
-- 設計上の要点:
--   * どちらも「レース詳細を開くたびに集計すると重い」指標の事前集計。日次バッチ
--     （scripts/daily/update-course-baseline-stats.js）が upsert する。画面は単純な SELECT で読む
--   * 匿名（画面）が読むテーブルなので SELECT ポリシーと GRANT SELECT を付ける。書き込みは
--     service_role のみ（BOA-370 のRLS規律。076以降は新規テーブルの既定権限を剥奪しているため GRANT を明示する）
--   * 既存の nige_outcome_distribution（027、艇番基準・90日・3連単粒度）は BOA-158 の
--     「逃げ成功時分布」タブが使用中のため変更しない。本テーブルはコース基準・全期間・2着粒度で別物
--   * 行数は極小（st_course_baseline 24行、nige_second_by_course 最大120行）。Disk IO への影響は無視できる
--   * last_updated は「値が実際に変わった日」を入れる（毎日書き換えない）。鮮度の監視は window_end で行う

SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. ST考察の「同コース・同級別の平均」ベースライン
-- ---------------------------------------------------------------------------
-- 画面は、選手個人の安定率・出遅率とこの値の差を併記する。
-- 生の値だけでは順位が逆転する（例: 出遅率 5コース34.3% と 6コース22.9% は、
-- 同コース・同級別の平均 22.4% / 33.1% との差では +11.9pt と −10.2pt で逆になる）。
CREATE TABLE IF NOT EXISTS st_course_baseline (
  course         SMALLINT     NOT NULL,             -- 実進入コース（1〜6。race_results.actual_course_N 由来）
  grade          TEXT         NOT NULL,             -- 級別（A1/A2/B1/B2。race_entries.grade、そのレース時点の値）
  window_start   DATE         NOT NULL,             -- 集計窓の開始日（実測。固定値を書かない）
  window_end     DATE         NOT NULL,             -- 集計窓の終了日（実測。鮮度の監視はこの列で行う）
  window_days    SMALLINT     NOT NULL,             -- window_end - window_start + 1（実測値）
  runs           INTEGER      NOT NULL,             -- 母数（走数。Fの行と実進入コース不明の行を除いた後）
  avg_st         NUMERIC(5,3) NOT NULL,             -- 平均ST（Fを除く）
  stable_rate    NUMERIC(5,2) NOT NULL,             -- 安定率(%) ST順1位（Fを除いた最小ST）との差が0.05以内
  late_rate      NUMERIC(5,2) NOT NULL,             -- 出遅率(%) ST順1位より0.1以上遅い
  breakout_count INTEGER,                           -- 抜出回数（すべての内側艇より0.07以上早い）。1コースはNULL
  breakout_rate  NUMERIC(5,2),                      -- 抜出率(%)（補助表示用。主表示は実回数）。1コースはNULL
  st_histogram   JSONB        NOT NULL,             -- STの分布（0.05刻みのビン。{"0.00":n,"0.05":n,...,"0.30+":n}）
  last_updated   DATE         NOT NULL,             -- 値が実際に変わった日（毎日書き換えない）
  created_at     TIMESTAMPTZ  DEFAULT NOW(),
  updated_at     TIMESTAMPTZ,
  PRIMARY KEY (course, grade),
  CONSTRAINT st_course_baseline_course_range CHECK (course BETWEEN 1 AND 6),
  CONSTRAINT st_course_baseline_grade_values CHECK (grade IN ('A1','A2','B1','B2')),
  -- 1コースは内側艇が存在しないため抜出率を算出しない。2〜6コースは必ず持つ
  CONSTRAINT st_course_baseline_breakout_null_only_course1
    CHECK ((course = 1 AND breakout_count IS NULL AND breakout_rate IS NULL)
        OR (course > 1 AND breakout_count IS NOT NULL AND breakout_rate IS NOT NULL)),
  CONSTRAINT st_course_baseline_window_order CHECK (window_end >= window_start)
);

ALTER TABLE st_course_baseline ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS st_course_baseline_public_read ON public.st_course_baseline;
CREATE POLICY st_course_baseline_public_read ON public.st_course_baseline
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.st_course_baseline TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. 逃げシミュレーション（会場別）
-- ---------------------------------------------------------------------------
-- 「1コースが逃げた」= race_results.winning_technique = '逃げ' かつ 1着艇の実進入コースが1。
-- venue_code は race_results に無いため races とJOINして取る。
--
-- 分母は total_races（結果確定 かつ actual_course_1 あり）に統一する。
-- 揃えないと sum(exacta_rate) が P(1コース逃げ) と3.6%ずれる（当初の設計の誤り）。
-- 実測（全国・全期間）: total_races 43,497 / nige_races 23,029（52.9%）、
-- 逃し時2着率 2〜6コース 34.4 / 29.1 / 18.8 / 12.4 / 5.4（合計100.1%、丸め誤差）、
-- 2連単確率の合計 52.9% = P(1コース逃げ) で一致することを確認済み。
-- 会場別の母数は24会場すべてで「1コース逃げ」674〜1,220レース（平均960）あり、分割しても成立する。
CREATE TABLE IF NOT EXISTS nige_second_by_course (
  venue_code    SMALLINT     NOT NULL,             -- 会場コード（1〜24。races.venue_code）
  second_course SMALLINT     NOT NULL,             -- 2着に来た実進入コース（2〜6）
  window_start  DATE         NOT NULL,             -- 集計窓の開始日（実測）
  window_end    DATE         NOT NULL,             -- 集計窓の終了日（実測）
  window_days   SMALLINT     NOT NULL,             -- window_end - window_start + 1（実測値）
  total_races   INTEGER      NOT NULL,             -- その会場の「結果確定 かつ actual_course_1 あり」レース数
  nige_races    INTEGER      NOT NULL,             -- うち「1コース逃げ」のレース数（second_rate の分母）
  second_count  INTEGER      NOT NULL,             -- そのコースが2着だった回数
  second_rate   NUMERIC(5,2) NOT NULL,             -- 逃し時2着率(%) = second_count / nige_races
  exacta_rate   NUMERIC(5,2) NOT NULL,             -- 2連単確率(%) = second_count / total_races
  last_updated  DATE         NOT NULL,             -- 値が実際に変わった日（毎日書き換えない）
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  updated_at    TIMESTAMPTZ,
  PRIMARY KEY (venue_code, second_course),
  CONSTRAINT nige_second_by_course_venue_range CHECK (venue_code BETWEEN 1 AND 24),
  CONSTRAINT nige_second_by_course_course_range CHECK (second_course BETWEEN 2 AND 6),
  CONSTRAINT nige_second_by_course_denominators CHECK (nige_races <= total_races AND second_count <= nige_races),
  CONSTRAINT nige_second_by_course_window_order CHECK (window_end >= window_start)
);

ALTER TABLE nige_second_by_course ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nige_second_by_course_public_read ON public.nige_second_by_course;
CREATE POLICY nige_second_by_course_public_read ON public.nige_second_by_course
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.nige_second_by_course TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. 集計RPC（日次バッチが呼ぶ。結果の24行＋最大120行だけを返す）
-- ---------------------------------------------------------------------------
-- 基礎CTEは race_start_timings 約242,000行＋race_results 約43,500行＋
-- race_entries 約280,000行を読む。これをNode側に持つと転送量もメモリも無駄なので、
-- 集計をDB側で完結させ、結果だけを返す（plan.md §5.1）。
--
-- 2つの関数は同じ基礎CTE（Fを除外したST × 実進入コース）を共有したいが、
-- 戻り値の形が違うため関数を分ける。日次1回の実行なのでスキャン2回は許容する
-- （画面から毎回呼ぶわけではない。ADR-0068 却下1）。
--
-- ⚠️ 権限: どちらも service_role だけが実行する（バッチ専用）。匿名には
-- GRANT EXECUTE しない。画面は集計済みのテーブルを単純SELECTで読む。
-- SECURITY INVOKER（既定）のままにし、呼び出し元の権限で動かす。

-- 3-1. ST考察のベースライン（コース×級別の24セル）
CREATE OR REPLACE FUNCTION compute_st_course_baseline()
RETURNS TABLE (
  course        SMALLINT,
  grade         TEXT,
  window_start  DATE,
  window_end    DATE,
  window_days   SMALLINT,
  runs          INTEGER,
  avg_st        NUMERIC,
  stable_rate   NUMERIC,
  late_rate     NUMERIC,
  breakout_count INTEGER,
  breakout_rate NUMERIC,
  st_histogram  JSONB
)
LANGUAGE sql
STABLE
AS $$
WITH st AS (
  SELECT t.race_id, t.boat_number, t.is_flying, t.start_timing::numeric AS st
  FROM race_start_timings t
  WHERE t.start_timing IS NOT NULL
),
crs AS (
  SELECT r.race_id, b.n AS boat_number,
    CASE b.n
      WHEN 1 THEN r.actual_course_1 WHEN 2 THEN r.actual_course_2
      WHEN 3 THEN r.actual_course_3 WHEN 4 THEN r.actual_course_4
      WHEN 5 THEN r.actual_course_5 WHEN 6 THEN r.actual_course_6
    END AS course
  FROM race_results r
  CROSS JOIN (SELECT generate_series(1, 6) AS n) b
),
j AS (
  -- Fの行は「ST順1位」の基準からも母数からも外す（符号反転はしない。ADR-0068 却下5）。
  -- best は filter (where not is_flying) で、Fを除いた最小STになる
  SELECT
    st.race_id, st.boat_number, st.is_flying, st.st, crs.course, e.grade,
    ra.race_date,
    MIN(st.st) FILTER (WHERE NOT st.is_flying) OVER (PARTITION BY st.race_id) AS best,
    MIN(st.st) FILTER (WHERE NOT st.is_flying) OVER (
      PARTITION BY st.race_id ORDER BY crs.course
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS inner_min
  FROM st
  JOIN crs ON crs.race_id = st.race_id AND crs.boat_number = st.boat_number
  JOIN race_entries e ON e.race_id = st.race_id AND e.boat_number = st.boat_number
  JOIN races ra ON ra.race_id = st.race_id
  WHERE crs.course BETWEEN 1 AND 6 AND e.grade IS NOT NULL
),
win AS (
  SELECT MIN(race_date) AS ws, MAX(race_date) AS we FROM j
)
SELECT
  j.course::SMALLINT,
  j.grade::TEXT,
  w.ws,
  w.we,
  (w.we - w.ws + 1)::SMALLINT,
  COUNT(*)::INTEGER,
  ROUND(AVG(j.st), 3),
  ROUND(AVG(CASE WHEN j.st - j.best <= 0.05 THEN 1 ELSE 0 END) * 100, 2),
  ROUND(AVG(CASE WHEN j.st - j.best >= 0.10 THEN 1 ELSE 0 END) * 100, 2),
  -- 1コースは内側艇が存在しないため抜出を算出しない（0ではなくNULL）
  CASE WHEN j.course = 1 THEN NULL
       ELSE COUNT(*) FILTER (WHERE j.inner_min IS NOT NULL AND j.st <= j.inner_min - 0.07)::INTEGER
  END,
  CASE WHEN j.course = 1 THEN NULL
       WHEN COUNT(*) FILTER (WHERE j.inner_min IS NOT NULL) = 0 THEN NULL
       ELSE ROUND(
         COUNT(*) FILTER (WHERE j.inner_min IS NOT NULL AND j.st <= j.inner_min - 0.07)::numeric
         / COUNT(*) FILTER (WHERE j.inner_min IS NOT NULL) * 100, 2)
  END,
  -- STの分布（0.05刻み。ビンの合計 = runs になる）
  jsonb_build_object(
    '0.00', COUNT(*) FILTER (WHERE j.st < 0.05),
    '0.05', COUNT(*) FILTER (WHERE j.st >= 0.05 AND j.st < 0.10),
    '0.10', COUNT(*) FILTER (WHERE j.st >= 0.10 AND j.st < 0.15),
    '0.15', COUNT(*) FILTER (WHERE j.st >= 0.15 AND j.st < 0.20),
    '0.20', COUNT(*) FILTER (WHERE j.st >= 0.20 AND j.st < 0.25),
    '0.25', COUNT(*) FILTER (WHERE j.st >= 0.25 AND j.st < 0.30),
    '0.30+', COUNT(*) FILTER (WHERE j.st >= 0.30)
  )
FROM j CROSS JOIN win w
WHERE NOT j.is_flying
GROUP BY j.course, j.grade, w.ws, w.we
ORDER BY j.course, j.grade;
$$;

REVOKE ALL ON FUNCTION compute_st_course_baseline() FROM PUBLIC;
REVOKE ALL ON FUNCTION compute_st_course_baseline() FROM anon, authenticated;

-- 3-2. 逃げシミュレーション（会場 × 2着コース）
--
-- ⚠️ CTEには MATERIALIZED を付ける（2026-09-24）。付けないと base が
-- totals / nige / seconds / win から複数回参照されてその都度スキャンされ、
-- statement timeout になることを実測で確認した。base を1回だけ実体化し、
-- 「1コース逃げか」「2着艇の実進入コース」をその場で列にして後段を軽くする。
CREATE OR REPLACE FUNCTION compute_nige_second_by_course()
RETURNS TABLE (
  venue_code    SMALLINT,
  second_course SMALLINT,
  window_start  DATE,
  window_end    DATE,
  window_days   SMALLINT,
  total_races   INTEGER,
  nige_races    INTEGER,
  second_count  INTEGER,
  second_rate   NUMERIC,
  exacta_rate   NUMERIC
)
LANGUAGE sql
STABLE
AS $$
WITH base AS MATERIALIZED (
  -- 分母は「結果確定 かつ actual_course_1 が取れたレース」に統一する。
  -- 揃えないと sum(exacta_rate) が P(1コース逃げ) と3.6%ずれる（当初の設計の誤り）
  SELECT ra.venue_code, ra.race_date, r.rank1, r.rank2, r.winning_technique,
    r.actual_course_1, r.actual_course_2, r.actual_course_3,
    r.actual_course_4, r.actual_course_5, r.actual_course_6
  FROM race_results r
  JOIN races ra ON ra.race_id = r.race_id
  WHERE r.rank1 IS NOT NULL AND r.rank2 IS NOT NULL AND r.actual_course_1 IS NOT NULL
),
flagged AS MATERIALIZED (
  SELECT b.venue_code, b.race_date,
    -- 「1コースが逃げた」= winning_technique='逃げ' かつ 1着艇の実進入コースが1
    (b.winning_technique = '逃げ' AND CASE b.rank1
       WHEN 1 THEN b.actual_course_1 WHEN 2 THEN b.actual_course_2
       WHEN 3 THEN b.actual_course_3 WHEN 4 THEN b.actual_course_4
       WHEN 5 THEN b.actual_course_5 WHEN 6 THEN b.actual_course_6 END = 1) AS is_nige,
    -- 2着艇の実進入コース
    CASE b.rank2
      WHEN 1 THEN b.actual_course_1 WHEN 2 THEN b.actual_course_2
      WHEN 3 THEN b.actual_course_3 WHEN 4 THEN b.actual_course_4
      WHEN 5 THEN b.actual_course_5 WHEN 6 THEN b.actual_course_6 END AS second_course
  FROM base b
),
win AS (SELECT MIN(race_date) AS ws, MAX(race_date) AS we FROM flagged),
venue_tot AS (
  SELECT venue_code,
    COUNT(*)::INTEGER AS total_races,
    COUNT(*) FILTER (WHERE is_nige)::INTEGER AS nige_races
  FROM flagged GROUP BY venue_code
)
SELECT
  f.venue_code::SMALLINT,
  f.second_course::SMALLINT,
  w.ws,
  w.we,
  (w.we - w.ws + 1)::SMALLINT,
  v.total_races,
  v.nige_races,
  COUNT(*)::INTEGER,
  ROUND(COUNT(*)::numeric / v.nige_races * 100, 2),
  ROUND(COUNT(*)::numeric / v.total_races * 100, 2)
FROM flagged f
JOIN venue_tot v ON v.venue_code = f.venue_code
CROSS JOIN win w
WHERE f.is_nige AND f.second_course BETWEEN 2 AND 6
GROUP BY f.venue_code, f.second_course, w.ws, w.we, v.total_races, v.nige_races
ORDER BY f.venue_code, f.second_course;
$$;

REVOKE ALL ON FUNCTION compute_nige_second_by_course() FROM PUBLIC;
REVOKE ALL ON FUNCTION compute_nige_second_by_course() FROM anon, authenticated;
