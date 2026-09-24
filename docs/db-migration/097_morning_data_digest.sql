-- 097: 「本日のデータ一覧」ページ（BOA-402）の事前集計テーブル3表＋実行記録1表
--
-- 対応チケット: BOA-402（「本日のデータ一覧」ページとSNS毎朝展開）
-- 対応設計: docs/design/morning-data-digest/plan.md、docs/design/morning-data-digest/spec.md
-- 関連ADR: docs/adr/0070-morning-digest-precomputed-rows.md（日次の抽出結果を行として持つ）
--           docs/adr/0071-venue-adjusted-skill-delta.md（会場構成を調整した「地力」指標）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認後に、ユーザーが実行する。
--
-- 番号の根拠: origin/master の docs/db-migration/ の最大は 096（2026-09-24時点）。
--   094/095/096 は適用済み。`npm run verify:migration-numbers` で確認すること。
--
-- 設計の要点:
--   * 集計窓は「利用可能な全期間」の移動窓。365 等の固定値を書かず、window_start / window_end /
--     window_days に実測値を入れる（094 と同じ方式。ADR-0068 の失敗例を踏襲しない）
--   * 率はすべて NUMERIC(5,2)。unchangedRows.js の NUMERIC_SCALES に本マイグレーションの
--     4表分のエントリを追加しないと、毎日「全行に変更あり」と判定されて Disk IO を無駄にする
--   * last_updated は「値が実際に変わった日」。毎日書き換えない
--   * RLS を有効にし anon/authenticated には SELECT のみ与える（076 以降の方針、094 と同形）
--
-- 適用手順（ユーザーが実行する）:
--   Supabase Dashboard > SQL Editor で、次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
--
-- 適用後の確認（読み取りのみ）:
--   SELECT tablename, rowsecurity FROM pg_tables
--    WHERE schemaname='public' AND tablename IN
--      ('venue_course_technique_baseline','racer_course_technique_stats',
--       'morning_digest_rows','morning_digest_days');
--   → 4行、rowsecurity = true
--   SELECT has_table_privilege('anon', t, 'SELECT') AS can_select,
--          has_table_privilege('anon', t, 'INSERT') AS can_insert
--     FROM unnest(ARRAY['venue_course_technique_baseline','racer_course_technique_stats',
--                       'morning_digest_rows','morning_digest_days']) AS t;
--   → can_select = true、can_insert = false
--
-- ロールバック:
--   DROP TABLE IF EXISTS morning_digest_rows;
--   DROP TABLE IF EXISTS morning_digest_days;
--   DROP TABLE IF EXISTS racer_course_technique_stats;
--   DROP TABLE IF EXISTS venue_course_technique_baseline;

SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1) venue_course_technique_baseline: 会場 × グレード × 実進入コースの決まり手ベースライン
--    「地力」の算出（実績率 − 会場構成から期待される率）と、本日の会場での予測値に使う。
--
--    ⚠️ グレード軸は2026-09-24の独立レビュー（tasks.md G-0）の指摘H-2で追加した。
--       実測: グレード別の逃げ率は G1 62.2% / SG 61.3% / G2 54.4% / ippan 52.5% / G3 51.1%
--       （11.1ptの開き）。会場差20.3ptと同型の交絡で、会場だけ補正して「会場構成で説明できる
--       分を取り除いた」と称するのは overclaim だった。
--       ただし影響は会場交絡より1桁小さい。実際に表示される行（逃げ率70%以上・n>=10、216名）
--       での実測は 平均シフト1.29pt・最大8.00pt・3pt以上動く行が29/216（13.4%）。
--
--    行数: 会場×グレード×コースの実在セルは468（実測。median n=136、n<30 は6セルのみ）。
--          加えてフォールバック用に race_grade='ALL'（グレードを問わない集計）の 24×6=144 行を持つ。
--          合計 約612行。
--    フォールバック: 該当セルの runs が閾値（100）未満のときは 'ALL' 行を使う。
--          実測で n<100 のセルは180/468（38%）あるため、フォールバックは必須。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS venue_course_technique_baseline (
  venue_code   SMALLINT     NOT NULL,             -- 会場コード（1〜24。races.venue_code）
  race_grade   TEXT         NOT NULL,             -- races.race_grade（SG/G1/G2/G3/ippan）。NULLは'ippan'に寄せる。
                                                  -- 'ALL' はグレードを問わない集計（セルが小さいときのフォールバック）
  course       SMALLINT     NOT NULL,             -- 実進入コース（1〜6。race_results.actual_course_N 由来）
  window_start DATE         NOT NULL,             -- 集計窓の開始日（実測。固定値を書かない）
  window_end   DATE         NOT NULL,             -- 集計窓の終了日（実測。鮮度の監視はこの列で行う）
  window_days  SMALLINT     NOT NULL,             -- window_end - window_start + 1（実測値。2026-09-24時点で295。
                                                  -- 開催日数293とは別物なので混同しない）
  runs         INTEGER      NOT NULL,             -- 母数。そのセルでそのコースに進入した延べ走数
  nige_rate    NUMERIC(5,2),                      -- 逃げ率(%)。course=1 のみ。2〜6はNULL
  makuri_rate  NUMERIC(5,2) NOT NULL,             -- まくり率(%)。そのコースから まくり で1着になった割合
  nigashi_rate NUMERIC(5,2),                      -- 逃がし率(%)。course>=2 のみ。そのコース進入走のうち逃げ決着の割合。
                                                  -- ⚠️ 各レースに各コースがちょうど1艇ずつ存在するため、この値は
                                                  -- 定義上そのセルの逃げ率と一致する（実測: コース1〜6で52.98/52.98/
                                                  -- 52.98/52.98/52.98/52.95）。コース軸は情報を持たない。
                                                  -- 列として持つのは読み取り側の結合を単純にするためだけ（レビュー指摘H-5）
  last_updated DATE         NOT NULL,             -- 値が実際に変わった日（毎日書き換えない）
  created_at   TIMESTAMPTZ  DEFAULT NOW(),
  updated_at   TIMESTAMPTZ,
  PRIMARY KEY (venue_code, race_grade, course),
  CONSTRAINT vctb_venue_range  CHECK (venue_code BETWEEN 1 AND 24),
  CONSTRAINT vctb_course_range CHECK (course BETWEEN 1 AND 6),
  CONSTRAINT vctb_grade_values CHECK (race_grade IN ('SG','G1','G2','G3','ippan','ALL')),
  CONSTRAINT vctb_window_order CHECK (window_end >= window_start),
  -- 1コースは「逃げ率」を持ち「逃がし率」を持たない。2〜6コースはその逆
  CONSTRAINT vctb_rate_by_course CHECK (
    (course = 1 AND nige_rate IS NOT NULL AND nigashi_rate IS NULL)
    OR (course > 1 AND nige_rate IS NULL AND nigashi_rate IS NOT NULL)
  )
);

ALTER TABLE venue_course_technique_baseline ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS venue_course_technique_baseline_public_read ON public.venue_course_technique_baseline;
CREATE POLICY venue_course_technique_baseline_public_read ON public.venue_course_technique_baseline
  FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.venue_course_technique_baseline TO anon, authenticated;

COMMENT ON TABLE venue_course_technique_baseline IS
  '会場×グレード×実進入コースの決まり手ベースライン（BOA-402）。地力＝選手の実績率−会場・グレード構成から期待される率、の期待値算出と、本日の予測値に使う。race_grade=''ALL'' はセルの母数が閾値未満のときのフォールバック。日次バッチ scripts/daily/update-racer-course-technique-stats.js が更新する';

-- ---------------------------------------------------------------------------
-- 2) racer_course_technique_stats: 選手 × 実進入コースの決まり手実績
--    「地力窓（利用可能な全期間）」と「調子窓（直近90日）」の2層を1行に持つ。
--    約1,600選手 × 6コース ≒ 9,000行。
--
--    expected_* は「その選手が走った会場の構成でリーグ平均の選手が出したはずの率」。
--    地力 = *_rate − *_expected は保存しない（派生値の二重管理を避け、読み取り側で引く）。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS racer_course_technique_stats (
  racer_id         INTEGER      NOT NULL,         -- 選手登録番号（race_entries.racer_id）
  course           SMALLINT     NOT NULL,         -- 実進入コース（1〜6）
  window_start     DATE         NOT NULL,         -- 地力窓の開始日（実測）
  window_end       DATE         NOT NULL,         -- 地力窓の終了日（実測）
  window_days      SMALLINT     NOT NULL,         -- 地力窓の日数（実測値。365等の固定値を書かない）

  runs             INTEGER      NOT NULL,         -- 地力窓の母数（そのコースへの進入走数）
  nige_count       INTEGER,                       -- course=1 のみ。逃げで1着になった回数
  nige_rate        NUMERIC(5,2),                  -- course=1 のみ
  nige_expected    NUMERIC(5,2),                  -- course=1 のみ。会場構成から期待される逃げ率
  makuri_count     INTEGER      NOT NULL,         -- まくりで1着になった回数
  makuri_rate      NUMERIC(5,2) NOT NULL,
  makuri_expected  NUMERIC(5,2) NOT NULL,         -- 会場構成から期待されるまくり率
  nigashi_count    INTEGER,                       -- course>=2 のみ。1コースに逃げられた回数
  nigashi_rate     NUMERIC(5,2),                  -- course>=2 のみ
  nigashi_expected NUMERIC(5,2),                  -- course>=2 のみ。会場構成から期待される逃がし率

  runs_90d         INTEGER      NOT NULL,         -- 調子窓（直近90日）の母数。0もありうる
  nige_rate_90d    NUMERIC(5,2),                  -- runs_90d=0 のときNULL
  makuri_rate_90d  NUMERIC(5,2),
  nigashi_rate_90d NUMERIC(5,2),

  last_updated     DATE         NOT NULL,         -- 値が実際に変わった日（毎日書き換えない）
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  updated_at       TIMESTAMPTZ,
  PRIMARY KEY (racer_id, course),
  CONSTRAINT rcts_course_range CHECK (course BETWEEN 1 AND 6),
  CONSTRAINT rcts_window_order CHECK (window_end >= window_start),
  CONSTRAINT rcts_runs_positive CHECK (runs > 0 AND runs_90d >= 0),
  CONSTRAINT rcts_counts_within_runs CHECK (
    makuri_count <= runs
    AND (nige_count IS NULL OR nige_count <= runs)
    AND (nigashi_count IS NULL OR nigashi_count <= runs)
  ),
  -- 1コースは逃げ率を持ち逃がし率を持たない。2〜6コースはその逆（まくりは全コース共通で持つ。
  -- 1コースのまくり率は実測で常に0だが、CHECKで縛らず0として保存する）
  CONSTRAINT rcts_rate_by_course CHECK (
    (course = 1
       AND nige_count IS NOT NULL AND nige_rate IS NOT NULL AND nige_expected IS NOT NULL
       AND nigashi_count IS NULL AND nigashi_rate IS NULL AND nigashi_expected IS NULL)
    OR (course > 1
       AND nige_count IS NULL AND nige_rate IS NULL AND nige_expected IS NULL
       AND nigashi_count IS NOT NULL AND nigashi_rate IS NOT NULL AND nigashi_expected IS NOT NULL)
  ),
  -- 調子窓に走が無ければ率はNULL（0%にしない。「0%だった」と「走っていない」を区別する）
  CONSTRAINT rcts_90d_rates_null_when_no_runs CHECK (
    runs_90d > 0
    OR (nige_rate_90d IS NULL AND makuri_rate_90d IS NULL AND nigashi_rate_90d IS NULL)
  )
);

ALTER TABLE racer_course_technique_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS racer_course_technique_stats_public_read ON public.racer_course_technique_stats;
CREATE POLICY racer_course_technique_stats_public_read ON public.racer_course_technique_stats
  FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.racer_course_technique_stats TO anon, authenticated;

COMMENT ON TABLE racer_course_technique_stats IS
  '選手×実進入コースの決まり手実績（BOA-402）。地力窓（利用可能な全期間）と調子窓（直近90日）の2層。expected_* は会場構成から期待される率で、地力＝rate−expected は読み取り側で引く';

-- ---------------------------------------------------------------------------
-- 3) morning_digest_days: 1日ぶんのダイジェストの実行記録
--    ページが「集計期間」「データ不完全の警告」を出すための情報と、節境界ガードの記録。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS morning_digest_days (
  digest_date        DATE        NOT NULL,        -- 対象日（JST）
  generated_at       TIMESTAMPTZ,                 -- 生成完了時刻。**NULL可**（完了マーク）。
                                                  -- morning_digest_rows がこの表をFK参照するため、バッチは
                                                  -- (1)この行をNULLでINSERT →(2)rowsを投入 →(3)generated_atをUPDATE
                                                  -- の順で書く。途中でクラッシュするとNULLのまま残り、ページは
                                                  -- 「未生成」として扱える。逆順だと「該当0件」と混同される
                                                  -- （レビュー指摘M-8、ADR-0070の影響節）
  venue_count        SMALLINT    NOT NULL,        -- その日の開催会場数
  race_count         SMALLINT    NOT NULL,        -- その日の総レース数
  window_start       DATE        NOT NULL,        -- 生成時点の地力窓（実測）
  window_end         DATE        NOT NULL,
  window_days        SMALLINT    NOT NULL,
  flying_data_complete BOOLEAN   NOT NULL,        -- 前日のfinish_markが100%運用の期間内か（2026-09-21以降）
  suppressed_venues  SMALLINT[]  NOT NULL DEFAULT '{}',  -- 帰郷判定で節境界とみなして抑制した会場（FR-14）
  notes              JSONB,                       -- 各セクションの件数等、監視用の補助情報
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (digest_date),
  CONSTRAINT mdd_window_order CHECK (window_end >= window_start),
  CONSTRAINT mdd_counts_nonneg CHECK (venue_count >= 0 AND race_count >= 0)
);

ALTER TABLE morning_digest_days ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS morning_digest_days_public_read ON public.morning_digest_days;
CREATE POLICY morning_digest_days_public_read ON public.morning_digest_days
  FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.morning_digest_days TO anon, authenticated;

COMMENT ON TABLE morning_digest_days IS
  '「本日のデータ一覧」の1日ぶんの実行記録（BOA-402）。ページの集計期間表示・データ不完全の警告・帰郷判定の節境界ガードの記録に使う';

-- ---------------------------------------------------------------------------
-- 4) morning_digest_rows: 1日ぶんの抽出結果（ページとSNS下書きが共通で読む唯一の情報源）
--    日付ごとに残すため、?date= による過去日の参照が「その日の集計値」で正しく再現される
--    （ADR-0070）。1日あたり40〜60行程度、1年で約2万行。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS morning_digest_rows (
  digest_date      DATE         NOT NULL,         -- 対象日（JST）。morning_digest_days.digest_date
  section          TEXT         NOT NULL,         -- 'featured'|'nige'|'makuri'|'nigashi'|'flying'|'returned'
  rank             SMALLINT     NOT NULL,         -- セクション内の並び順（1始まり）

  race_id          VARCHAR(20),                   -- 対象レース。'returned'（帰郷）はNULL
  venue_code       SMALLINT     NOT NULL,
  race_number      SMALLINT,                      -- 'returned' はNULL
  start_time       TIME,                          -- 締切時刻。'returned' はNULL
  racer_id         INTEGER      NOT NULL,
  racer_name       TEXT         NOT NULL,         -- 表示用（結合を減らす。生の表記を保存する）
  grade            TEXT,                          -- A1/A2/B1/B2
  boat_number      SMALLINT,                      -- 枠番。'returned' はNULL
  course           SMALLINT,                      -- 指標の対象となる実進入コース。'flying'/'returned' はNULL

  metric_value     NUMERIC(5,2),                  -- その行の主指標(%)。逃げ率・まくり率・逃がし率
  metric_expected  NUMERIC(5,2),                  -- 会場構成から期待される率(%)
  metric_skill_delta NUMERIC(5,2),                -- 地力(pt) = metric_value - metric_expected
  metric_venue_baseline NUMERIC(5,2),             -- 本日の会場×グレード×コースのベースライン(%)
  metric_predicted NUMERIC(5,2),                  -- 本日の会場での予測(%) = baseline + skill_delta
  sample_size      INTEGER,                       -- 地力窓の母数
  is_small_sample  BOOLEAN      NOT NULL DEFAULT false,  -- 母数が20未満（sample_size < 20）。
                                                  -- ⚠️ 信頼区間検定ではない。当初は「Wilson95%下限 <
                                                  -- ベースレート」、次に「< 抽出閾値」としたが、実測で
                                                  -- まくり100%・逃げ89.4%の行に立ち判別力が無かった
                                                  -- （まくりはWilson95%下限の最大が24.6%で1行も閾値25%を
                                                  -- 超えられない）。確からしさは metric_wilson_lower で見せる
  metric_wilson_lower NUMERIC(5,2),               -- 主指標のWilson95%信頼下限(%)。
                                                  -- 実測の分布: 逃げ 46.9〜78.0（中央値59.8）、
                                                  -- まくり 10.2〜24.6（中央値14.2）
  rate_90d         NUMERIC(5,2),                  -- 調子窓の率(%)
  sample_size_90d  INTEGER,                       -- 調子窓の母数
  motor_2rate      NUMERIC(5,2),                  -- race_entries.motor_2rate のコピー
  volatility_percentile NUMERIC(5,2),             -- イン崩れ指数。**0〜100 に正規化して保存する**。
                                                  -- ⚠️ 情報源の predictions.feature_contributions.volatilityPercentile は
                                                  -- 0〜1（実測: 戸田4R=0.8373、最大0.9921）。×100 せずに入れると
                                                  -- NUMERIC(5,2) で 0.84 に丸められ情報が失われる（レビュー指摘H-1）。
                                                  -- isFallback（会場内サンプル不足のプレースホルダ0.5）の行はNULL

  detail           JSONB,                         -- 可変部分。期別推移・枠→進入コース傾向・
                                                  -- フライングのST・帰郷の理由・注目レースの選定理由
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  PRIMARY KEY (digest_date, section, rank),
  CONSTRAINT mdr_section_values CHECK (
    section IN ('featured','nige','makuri','nigashi','flying','returned')
  ),
  CONSTRAINT mdr_venue_range  CHECK (venue_code BETWEEN 1 AND 24),
  CONSTRAINT mdr_course_range CHECK (course IS NULL OR course BETWEEN 1 AND 6),
  CONSTRAINT mdr_boat_range   CHECK (boat_number IS NULL OR boat_number BETWEEN 1 AND 6),
  CONSTRAINT mdr_rank_positive CHECK (rank >= 1),
  -- レースに紐づくセクションは race_id / race_number / start_time / boat_number を必ず持つ。
  -- 'returned'（帰郷）はレース単位ではないため持たない
  CONSTRAINT mdr_race_fields_by_section CHECK (
    (section = 'returned' AND race_id IS NULL AND race_number IS NULL AND boat_number IS NULL)
    OR (section <> 'returned' AND race_id IS NOT NULL AND race_number IS NOT NULL AND boat_number IS NOT NULL)
  ),
  -- 指標を持つセクションは metric 一式を必ず持つ（片方だけ入る状態を作らない）
  CONSTRAINT mdr_metric_fields_by_section CHECK (
    section IN ('flying','returned')
    OR (metric_value IS NOT NULL AND metric_expected IS NOT NULL
        AND metric_skill_delta IS NOT NULL AND metric_venue_baseline IS NOT NULL
        AND metric_predicted IS NOT NULL AND sample_size IS NOT NULL AND course IS NOT NULL)
  ),
  CONSTRAINT mdr_days_fk FOREIGN KEY (digest_date)
    REFERENCES morning_digest_days (digest_date) ON DELETE CASCADE
);

-- ページは常に「1日ぶんを全セクションまとめて」読むため、PK の先頭列で足りる。
-- 選手ページからの逆引き（この選手が過去に何回載ったか）を将来足す場合に備えた索引のみ追加する。
CREATE INDEX IF NOT EXISTS morning_digest_rows_racer_idx
  ON morning_digest_rows (racer_id, digest_date DESC);

ALTER TABLE morning_digest_rows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS morning_digest_rows_public_read ON public.morning_digest_rows;
CREATE POLICY morning_digest_rows_public_read ON public.morning_digest_rows
  FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.morning_digest_rows TO anon, authenticated;

COMMENT ON TABLE morning_digest_rows IS
  '「本日のデータ一覧」の1日ぶんの抽出結果（BOA-402）。ページとSNS下書きがこの1表だけを読むことで、Web/SNS間で値が食い違わないことを構造的に保証する（ADR-0070）。日付ごとに残すため ?date= の過去日参照がその日の集計値で再現される';

-- ---------------------------------------------------------------------------
-- 5) 集計RPC（日次バッチが呼ぶ。service_role専用・匿名はREVOKE）
--
--    設計: plan.md §3.1。基礎CTEは全期間で約26万行（43,643レース×6艇）を読むため、
--    Node側に生データを持たず、結果の約612行＋約9,471行だけを返す。
--
--    ⚠️ CTEには MATERIALIZED を付ける。094で「付けないと base が複数回参照されて
--       その都度スキャンされ statement timeout になる」ことを実測済み。
--
--    GRANT EXECUTE しない（094と同じ）。画面は集計済みのテーブルを単純SELECTで読む。
-- ---------------------------------------------------------------------------

-- 5-1. 会場 × グレード × 実進入コースのベースライン
--
-- race_grade='ALL' の行（グレードを問わない集計）も同時に返す。
-- セルの母数が閾値未満のとき、5-2 のフォールバック先になる。
CREATE OR REPLACE FUNCTION compute_venue_course_technique_baseline()
RETURNS TABLE (
  venue_code   SMALLINT,
  race_grade   TEXT,
  course       SMALLINT,
  window_start DATE,
  window_end   DATE,
  window_days  SMALLINT,
  runs         INTEGER,
  nige_rate    NUMERIC,
  makuri_rate  NUMERIC,
  nigashi_rate NUMERIC
)
LANGUAGE sql
STABLE
AS $$
WITH base AS MATERIALIZED (
  SELECT
    ra.race_date,
    ra.venue_code,
    COALESCE(ra.race_grade, 'ippan') AS grade,
    rr.winning_technique,
    (rr.rank1 = e.boat_number)       AS is_self_win,
    CASE e.boat_number
      WHEN 1 THEN rr.actual_course_1 WHEN 2 THEN rr.actual_course_2
      WHEN 3 THEN rr.actual_course_3 WHEN 4 THEN rr.actual_course_4
      WHEN 5 THEN rr.actual_course_5 WHEN 6 THEN rr.actual_course_6
    END AS course
  FROM races ra
  JOIN race_results rr ON rr.race_id = ra.race_id
  JOIN race_entries e  ON e.race_id  = ra.race_id
  WHERE rr.actual_course_1 IS NOT NULL
    AND rr.winning_technique IS NOT NULL AND rr.winning_technique <> ''
    AND COALESCE(rr.is_cancelled, false) = false
    AND COALESCE(rr.is_no_race, false)   = false
    AND COALESCE(e.is_absent, false)     = false
    AND e.racer_id IS NOT NULL
),
win AS (SELECT MIN(race_date) AS ws, MAX(race_date) AS we FROM base),
agg AS (
  -- グレード別のセル
  SELECT b.venue_code, b.grade AS race_grade, b.course,
         COUNT(*) AS runs,
         COUNT(*) FILTER (WHERE b.winning_technique = '逃げ'   AND b.is_self_win) AS nige,
         COUNT(*) FILTER (WHERE b.winning_technique = 'まくり' AND b.is_self_win) AS makuri,
         COUNT(*) FILTER (WHERE b.winning_technique = '逃げ')                     AS nigashi
  FROM base b
  WHERE b.course BETWEEN 1 AND 6
  GROUP BY b.venue_code, b.grade, b.course
  UNION ALL
  -- グレードを問わないフォールバック行
  SELECT b.venue_code, 'ALL', b.course,
         COUNT(*),
         COUNT(*) FILTER (WHERE b.winning_technique = '逃げ'   AND b.is_self_win),
         COUNT(*) FILTER (WHERE b.winning_technique = 'まくり' AND b.is_self_win),
         COUNT(*) FILTER (WHERE b.winning_technique = '逃げ')
  FROM base b
  WHERE b.course BETWEEN 1 AND 6
  GROUP BY b.venue_code, b.course
)
SELECT
  a.venue_code::SMALLINT,
  a.race_grade::TEXT,
  a.course::SMALLINT,
  w.ws,
  w.we,
  (w.we - w.ws + 1)::SMALLINT,
  a.runs::INTEGER,
  -- 1コースのみ逃げ率を持つ（CHECK制約 vctb_rate_by_course に合わせる）
  CASE WHEN a.course = 1 THEN ROUND(a.nige::numeric / a.runs * 100, 2) END,
  ROUND(a.makuri::numeric / a.runs * 100, 2),
  -- 2〜6コースのみ逃がし率を持つ。値は定義上そのセルの逃げ率と一致する
  CASE WHEN a.course > 1 THEN ROUND(a.nigashi::numeric / a.runs * 100, 2) END
FROM agg a CROSS JOIN win w;
$$;

REVOKE ALL ON FUNCTION compute_venue_course_technique_baseline() FROM PUBLIC;
REVOKE ALL ON FUNCTION compute_venue_course_technique_baseline() FROM anon, authenticated;

COMMENT ON FUNCTION compute_venue_course_technique_baseline() IS
  'venue_course_technique_baseline の全行を算出して返す（BOA-402）。race_grade=''ALL'' のフォールバック行も含む。日次バッチ scripts/daily/update-racer-course-technique-stats.js が呼ぶ';

-- 5-2. 選手 × 実進入コースの決まり手実績
--
-- 期待値（expected）は「その選手の各走の、会場×グレード×コースのベースライン率」の平均。
-- **venue_course_technique_baseline を読む**ため、5-1 の結果を書き込んだ後に呼ぶこと。
-- セルの母数が MIN_BASELINE_RUNS(100) 未満のときは race_grade='ALL' 行へフォールバックする。
--
-- 調子窓（直近90日）の基準日は **JSTの当日**。データの最終日ではない
-- （「直近90日」は利用者から見た今日を起点にするのが自然なため）。
CREATE OR REPLACE FUNCTION compute_racer_course_technique_stats()
RETURNS TABLE (
  racer_id         INTEGER,
  course           SMALLINT,
  window_start     DATE,
  window_end       DATE,
  window_days      SMALLINT,
  runs             INTEGER,
  nige_count       INTEGER,
  nige_rate        NUMERIC,
  nige_expected    NUMERIC,
  makuri_count     INTEGER,
  makuri_rate      NUMERIC,
  makuri_expected  NUMERIC,
  nigashi_count    INTEGER,
  nigashi_rate     NUMERIC,
  nigashi_expected NUMERIC,
  runs_90d         INTEGER,
  nige_rate_90d    NUMERIC,
  makuri_rate_90d  NUMERIC,
  nigashi_rate_90d NUMERIC
)
LANGUAGE sql
STABLE
AS $$
WITH base AS MATERIALIZED (
  SELECT
    ra.race_date,
    ra.venue_code,
    COALESCE(ra.race_grade, 'ippan') AS grade,
    e.racer_id,
    rr.winning_technique,
    (rr.rank1 = e.boat_number)       AS is_self_win,
    CASE e.boat_number
      WHEN 1 THEN rr.actual_course_1 WHEN 2 THEN rr.actual_course_2
      WHEN 3 THEN rr.actual_course_3 WHEN 4 THEN rr.actual_course_4
      WHEN 5 THEN rr.actual_course_5 WHEN 6 THEN rr.actual_course_6
    END AS course
  FROM races ra
  JOIN race_results rr ON rr.race_id = ra.race_id
  JOIN race_entries e  ON e.race_id  = ra.race_id
  WHERE rr.actual_course_1 IS NOT NULL
    AND rr.winning_technique IS NOT NULL AND rr.winning_technique <> ''
    AND COALESCE(rr.is_cancelled, false) = false
    AND COALESCE(rr.is_no_race, false)   = false
    AND COALESCE(e.is_absent, false)     = false
    AND e.racer_id IS NOT NULL
),
win AS (SELECT MIN(race_date) AS ws, MAX(race_date) AS we FROM base),
-- 各走に、その走の会場×グレード×コースのベースラインを付ける（母数不足はALLへフォールバック）
withbase AS MATERIALIZED (
  SELECT
    b.*,
    COALESCE(
      CASE WHEN g.runs >= 100 THEN g.nige_rate    END, al.nige_rate)    AS bl_nige,
    COALESCE(
      CASE WHEN g.runs >= 100 THEN g.makuri_rate  END, al.makuri_rate)  AS bl_makuri,
    COALESCE(
      CASE WHEN g.runs >= 100 THEN g.nigashi_rate END, al.nigashi_rate) AS bl_nigashi
  FROM base b
  LEFT JOIN venue_course_technique_baseline g
    ON g.venue_code = b.venue_code AND g.race_grade = b.grade AND g.course = b.course
  LEFT JOIN venue_course_technique_baseline al
    ON al.venue_code = b.venue_code AND al.race_grade = 'ALL' AND al.course = b.course
  WHERE b.course BETWEEN 1 AND 6
),
cutoff AS (SELECT ((now() AT TIME ZONE 'Asia/Tokyo')::date - 90) AS d90)
SELECT
  w2.racer_id::INTEGER,
  w2.course::SMALLINT,
  win.ws,
  win.we,
  (win.we - win.ws + 1)::SMALLINT,
  COUNT(*)::INTEGER,
  -- 1コースのみ逃げの3列を持つ（CHECK制約 rcts_rate_by_course に合わせる）
  CASE WHEN w2.course = 1
       THEN COUNT(*) FILTER (WHERE w2.winning_technique = '逃げ' AND w2.is_self_win)::INTEGER END,
  CASE WHEN w2.course = 1
       THEN ROUND(COUNT(*) FILTER (WHERE w2.winning_technique = '逃げ' AND w2.is_self_win)::numeric
                  / COUNT(*) * 100, 2) END,
  CASE WHEN w2.course = 1 THEN ROUND(AVG(w2.bl_nige), 2) END,
  -- まくりは全コース共通（1コースは実測で常に0）
  COUNT(*) FILTER (WHERE w2.winning_technique = 'まくり' AND w2.is_self_win)::INTEGER,
  ROUND(COUNT(*) FILTER (WHERE w2.winning_technique = 'まくり' AND w2.is_self_win)::numeric
        / COUNT(*) * 100, 2),
  ROUND(AVG(w2.bl_makuri), 2),
  -- 2〜6コースのみ逃がしの3列を持つ
  CASE WHEN w2.course > 1
       THEN COUNT(*) FILTER (WHERE w2.winning_technique = '逃げ')::INTEGER END,
  CASE WHEN w2.course > 1
       THEN ROUND(COUNT(*) FILTER (WHERE w2.winning_technique = '逃げ')::numeric
                  / COUNT(*) * 100, 2) END,
  CASE WHEN w2.course > 1 THEN ROUND(AVG(w2.bl_nigashi), 2) END,
  -- 調子窓（直近90日）。母数0のときは率をNULLにする（CHECK制約 rcts_90d_rates_null_when_no_runs）
  COUNT(*) FILTER (WHERE w2.race_date >= c.d90)::INTEGER,
  CASE WHEN w2.course = 1 AND COUNT(*) FILTER (WHERE w2.race_date >= c.d90) > 0
       THEN ROUND(COUNT(*) FILTER (WHERE w2.race_date >= c.d90
                                     AND w2.winning_technique = '逃げ' AND w2.is_self_win)::numeric
                  / COUNT(*) FILTER (WHERE w2.race_date >= c.d90) * 100, 2) END,
  CASE WHEN COUNT(*) FILTER (WHERE w2.race_date >= c.d90) > 0
       THEN ROUND(COUNT(*) FILTER (WHERE w2.race_date >= c.d90
                                     AND w2.winning_technique = 'まくり' AND w2.is_self_win)::numeric
                  / COUNT(*) FILTER (WHERE w2.race_date >= c.d90) * 100, 2) END,
  CASE WHEN w2.course > 1 AND COUNT(*) FILTER (WHERE w2.race_date >= c.d90) > 0
       THEN ROUND(COUNT(*) FILTER (WHERE w2.race_date >= c.d90
                                     AND w2.winning_technique = '逃げ')::numeric
                  / COUNT(*) FILTER (WHERE w2.race_date >= c.d90) * 100, 2) END
FROM withbase w2 CROSS JOIN win CROSS JOIN cutoff c
GROUP BY w2.racer_id, w2.course, win.ws, win.we;
$$;

REVOKE ALL ON FUNCTION compute_racer_course_technique_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION compute_racer_course_technique_stats() FROM anon, authenticated;

COMMENT ON FUNCTION compute_racer_course_technique_stats() IS
  'racer_course_technique_stats の全行を算出して返す（BOA-402）。venue_course_technique_baseline を読むため、compute_venue_course_technique_baseline() の結果を書き込んだ後に呼ぶこと';
