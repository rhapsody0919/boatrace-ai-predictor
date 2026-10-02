-- 120: アナロジー・ファインダーの類似レース（FR-2・FR-3、層別 S*）の母集団・スナップショット・RPC（BOA-271・BOA-627）
-- 対応: docs/adr/0082-analogy-strata-counted-in-sql.md、docs/design/analogy-finder/plan.md
--
-- 背景: FR-2 は「今日のレースと4条件がすべて同じ過去レース」の決着の分布を出す（層別 S*、2026-10-02 ユーザー決定）。
--   条件: 1号艇と他艇の勝率差5帯 → 1号艇の級別 → 会場 → 勝率1位の艇。200件未満なら末尾の条件から外す（m=200）。
--   設計時の案 115（k-NN の近傍をバッチで作る形）は適用しないまま破棄し、この 120 に置き換えた。
--   条件の定義は scripts/ml/analogy/features.py（分析 scripts/analysis/analogy-finder-fr2-strat/cm2.py）と同じにする。
--   一致は scripts/maintenance/verify-analogy-pool.js で本番データを使って検査する。
--   「ほかのテーマでも絞る」（screens.md Q6、2026-10-02 ユーザー承認）: ラウンド・グレード・1号艇のモーター順位帯を、
--   今の深さの層の上に任意で重ねる。自動の深さの選び方には使わない（検証した4条件のまま）。スナップショットにも入れない
--   （探索用）。今日のレースの値は表示のたびに出走表から作る（race_grade・race_stage・motor_2rate は朝 5時台の
--   初期化で入る。2026-09-28〜10-02 の全 768R で3列とも埋まっていたことを本番の読み取りで確認）。ST は後回し。
--
-- テーブル
--   analogy_pool_outcomes  母集団（完全レース1行）。条件の4列・任意の3列と決着。長期分は kb_archive_*、2025-12-03 以降は本体から作る
--   analogy_snapshots      BOA-627。今日のレースの条件の値・自動で選んだ深さ・深さごとの件数・母集団の最終日（1レース1行）
--
-- 関数
--   analogy_gap_band(gap)                       勝率差 → 帯（0〜4、勝率が取れないときは 5）。1/100単位で比べ、境界ちょうどは上の帯
--   analogy_round_from_stage(stage)             race_stage → ラウンド（getRaceStageCategory と同じ規則）
--   analogy_round_from_kb(stage, kind)          長期分のラウンド（stage_kind を土台に、準優・優勝戦は本体の規則で上書き）
--   analogy_grade_of(grade, venue, date)        グレード。無ければ race_series の期間で補う
--   analogy_motor_band(rank)                    1号艇のモーター2連率の6艇内順位 → 帯（0〜3）
--   analogy_race_conditions(race_id)            今日のレースの4条件（race_entries から）
--   analogy_race_extras(race_id)                今日のレースの任意の3条件（ラウンド・グレード・モーター順位帯）
--   analogy_pool_rows_kb(from, to)              長期分の母集団の行（kb_archive、〜2025-12-02）
--   analogy_pool_rows_main(from, to)            本体の母集団の行（2025-12-03〜）
--   refresh_analogy_pool(from, to)              上の2つを upsert し、範囲内で完全レースでなくなった行を消す（service_role のみ）
--   analogy_layer_counts(...)                   深さ1〜4の件数
--   analogy_auto_depth(n_by_depth)              件数が200以上になる最も深い層（m=200）
--   analogy_layer_distribution(...)             層の分布（スナップショットと画面の RPC で共用）。任意の3条件で絞れる
--   analogy_optional_counts(...)                任意の条件をそれぞれ足したときの件数（「足すと N件」）
--   create_analogy_snapshots(date)              その日の締切前のレースのスナップショットを作る（service_role のみ）
--   analogy_resolve_race(race_id)               スナップショット、無ければ出走表から作った条件と母集団の範囲（2つの RPC で共用）
--   get_analogy_similar(race_id, depth, round, grade, motor)
--                                               画面の RPC。条件・深さごとの件数・分布・同じ層の新しい順20件・任意の条件（jsonb）
--   get_analogy_similar_races(race_id)          BOA-635 の RPC。自動の深さの層の行を新しい順に最大2,000件（jsonb）
--
-- 権限: 関数はすべて SECURITY INVOKER（public に SECURITY DEFINER を置かない。113 の監査）。
--   匿名が EXECUTE できるのは get_analogy_similar・get_analogy_similar_races と、その中で呼ぶ読み取りだけの関数11本
--   （check-anon-access.js の ANON_RPCS に足す）。2表は RLS 有効・匿名は SELECT のみ。
--   書き込みは service_role（Vercel Cron の api/cron/analogy-pool.js → refresh_analogy_pool、
--   api/cron/analogy-snapshots.js → create_analogy_snapshots）。
--
-- 行数: analogy_pool_outcomes 約40万行（2019-04〜）× 約140B ≒ 60MB、1日約150行増える。
--   analogy_snapshots 1日約150行 × 数KB（自動で選んだ深さの分布を含む）。年に約0.2GB。
--
-- ⚠️ 本番へ未適用。適用はユーザーが行う。
-- 適用の順序: この SQL を適用 → 長期分を投入（下の「初回の投入」）→ Vercel Cron（analogy-pool・analogy-snapshots）を shadow → live
--   → 画面の PR をマージ。画面はスナップショットも母集団も無いレースでは節を出さないので、順番がずれても壊れない。
--
-- 初回の投入（SQL エディタで1行ずつ。1行あたり約1.5万レース）:
--   SELECT refresh_analogy_pool('2019-04-01', '2019-06-30');
--   SELECT refresh_analogy_pool('2019-07-01', '2019-09-30');
--   …（3か月ずつ）…
--   SELECT refresh_analogy_pool('2025-10-01', current_date - 1);
-- 確認: SELECT count(*), min(race_date), max(race_date) FROM analogy_pool_outcomes;
--   （期待値: 2019-04〜前日の完全レース。Phase M の 2019-04〜2026-09 で 409,588R・データの穴の期間を除く）

BEGIN;

-- ---------------------------------------------------------------
-- 1. 勝率差の帯
-- ---------------------------------------------------------------
-- 境界は分析で確定した値（fr2-strat-result.md）。境界ちょうどは上の帯（分析の searchsorted(side='right') と同じ向き。
-- 分析は float32 で計算したため、境界ちょうどの勝率差は浮動小数の誤差でどちらにも振れていた）。
-- 境界を変えるときは、analogy_pool_outcomes.gap_band を作り直すマイグレーションが要る。
CREATE OR REPLACE FUNCTION analogy_gap_band(p_gap numeric)
RETURNS smallint
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT (CASE
    WHEN p_gap IS NULL THEN 5
    WHEN p_gap >= 0.19 THEN 4
    WHEN p_gap >= -0.49 THEN 3
    WHEN p_gap >= -1.14 THEN 2
    WHEN p_gap >= -1.91 THEN 1
    ELSE 0
  END)::smallint
$$;

-- ---------------------------------------------------------------
-- 1b. 任意の3条件の分類（Q6「ほかのテーマでも絞る」）
-- ---------------------------------------------------------------
-- ラウンド（yosen／junyu／yusho／other、ステージが空なら NULL）。
-- src/constants/raceStageConfig.js の RACE_STAGE_CATEGORY_RULES と同じ順に部分一致させ、
-- scripts/ml/analogy/features.py の round_from_stage と同じ4区分に寄せる（予選・予選の特別戦 → yosen、
-- 準優勝戦 → junyu、優勝戦 → yusho、それ以外と分類できない企画レース名 → other）。
-- 規則が JS・Python・この SQL の3か所にあるので、verify-analogy-strata-migration.js が JS と同じ分類になることを
-- 固定の文字列で検査する。JS の規則を変えたらここも変える。
CREATE OR REPLACE FUNCTION analogy_round_from_stage(p_stage text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_stage IS NULL OR p_stage = '' THEN NULL
    ELSE (WITH n AS (SELECT normalize(p_stage, NFKC) AS s),
               k AS (SELECT s, (s LIKE '%特選%' OR s LIKE '%特賞%' OR s LIKE '%特別%' OR s LIKE '%選抜%') AS sp FROM n)
          SELECT CASE
            WHEN s LIKE '%準々%' OR s LIKE '%準優進出%' THEN 'other'   -- semifinalQualifier
            WHEN s LIKE '%準優勝戦%' THEN 'junyu'                        -- semifinal
            WHEN s LIKE '%優勝戦%' THEN 'yusho'                          -- final
            WHEN s LIKE '%ドリーム%' OR s LIKE '%DR%' THEN 'other'      -- dream
            WHEN s LIKE '%予選%' AND sp THEN 'yosen'                     -- qualifierSpecial
            WHEN s LIKE '%一般%' AND sp THEN 'other'                     -- generalSpecial
            WHEN sp THEN 'other'                                         -- selection・special
            WHEN s LIKE '%予選%' THEN 'yosen'                            -- qualifier
            ELSE 'other'                                                 -- general・分類できない
          END FROM k)
  END
$$;

-- 長期分は kb_archive_races.stage_kind を土台にし、準優・優勝戦の判定だけ本体の規則で上書きする。
-- stage_kind（scripts/lib/kbArchiveRows.js の classifyStage）は前方一致なので、「準優進出戦」（1,298R）を semifinal に、
-- 接頭つきの「W準優勝戦前」「GP優勝戦」等を other に入れていて、本体と「準優勝戦」の中身が違う（design-reviewer 指摘1、
-- 2026-10-02 本番の読み取りで確認）。stage の文字列は途中で切れていることがある（「準優勝」「モーニング予」）ので、
-- 本体の規則で準優勝戦・優勝戦と言える行と、準優進出・準々の行だけを上書きし、それ以外は stage_kind のまま。
-- 残る差: 切れて「優勝戦」が読めない企画名の優勝戦（「団体・優勝」「シリーズ優勝」等、約30R）は other のまま。
-- features.py の round_from_kb_kind は stage_kind だけを見るので、長期分のラウンドはこの SQL と違う（FR-1 側へ申し送り）
CREATE OR REPLACE FUNCTION analogy_round_from_kb(p_stage text, p_kind text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_stage LIKE '%準優進出%' OR p_stage LIKE '%準々%' THEN 'other'
    WHEN analogy_round_from_stage(p_stage) IN ('junyu', 'yusho') THEN analogy_round_from_stage(p_stage)
    ELSE CASE p_kind WHEN 'qualifier' THEN 'yosen' WHEN 'semifinal' THEN 'junyu'
                     WHEN 'final' THEN 'yusho' WHEN 'other' THEN 'other' END
  END
$$;

-- グレード（ippan／G3／G2／G1／SG、不明は NULL）。レースの値（長期: kb_archive_venue_days.race_grade、
-- 本体: races.race_grade）が5区分のどれかならそれ、無ければ race_series の期間（会場・開始日〜終了日）で補う。
-- 期間が重なるときは開始日の早いほう（features.py の attach_grade_from_series と同じ）
CREATE OR REPLACE FUNCTION analogy_grade_of(p_grade text, p_venue_code smallint, p_date date)
RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE WHEN p_grade IN ('ippan', 'G3', 'G2', 'G1', 'SG') THEN p_grade
    ELSE (SELECT s.grade FROM race_series s
          WHERE s.venue_code = p_venue_code AND p_date BETWEEN s.start_date AND s.end_date
            AND s.grade IN ('ippan', 'G3', 'G2', 'G1', 'SG')
          ORDER BY s.start_date LIMIT 1)
  END
$$;

-- 1号艇のモーター2連率の6艇内順位（高い順、同率は上の順位）→ 帯。0=1〜2位、1=3〜4位、2=5〜6位、3=不明
-- （分析 cm2.py の M1b と同じ）。順位を付ける前に、2連率 0 は不明として除く（新モーターで未出走の値。
-- 6艇とも 0 だと全艇1位、1号艇だけ 0 だと5〜6位になり、画面の「6艇中1〜2位」が事実と違うため。
-- cm2.py とはここが違う。design-reviewer 指摘2、本体 2025-12-03 以降で1号艇 0 が 1,920R）
CREATE OR REPLACE FUNCTION analogy_motor_band(p_rank integer)
RETURNS smallint
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT (CASE WHEN p_rank IS NULL THEN 3 WHEN p_rank <= 2 THEN 0 WHEN p_rank <= 4 THEN 1 ELSE 2 END)::smallint
$$;

-- ---------------------------------------------------------------
-- 2. 母集団
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analogy_pool_outcomes (
  race_id           varchar PRIMARY KEY,           -- 'YYYY-MM-DD-VV-RR'（長期分は races に行が無いので外部キーにしない）
  race_date         date NOT NULL,
  venue_code        smallint NOT NULL,
  race_number       smallint NOT NULL,
  -- 条件（出走表時点）
  b1_class          text NOT NULL CHECK (b1_class IN ('A1', 'A2', 'B1', 'B2', '')),   -- 1号艇の級別。不明は ''
  b1_win_gap        numeric(4,2),                 -- 1号艇の全国勝率 − 2〜6号艇の全国勝率の最大。取れなければ NULL
  gap_band          smallint GENERATED ALWAYS AS (analogy_gap_band(b1_win_gap)) STORED,
  top_boat          smallint NOT NULL CHECK (top_boat BETWEEN 1 AND 6),  -- 全国勝率が最大の艇番（同率は小さい艇番）
  -- 任意の条件（Q6。自動の深さには使わない）
  round             text CHECK (round IN ('yosen', 'junyu', 'yusho', 'other')),         -- ステージが無いレースは NULL
  grade             text CHECK (grade IN ('ippan', 'G3', 'G2', 'G1', 'SG')),            -- 不明は NULL
  b1_motor_band     smallint NOT NULL CHECK (b1_motor_band BETWEEN 0 AND 3),            -- 3=1号艇のモーター2連率が不明
  -- 決着
  rank1             smallint NOT NULL,
  rank2             smallint NOT NULL,
  rank3             smallint NOT NULL,
  winning_technique text CHECK (winning_technique IN ('逃げ', '差し', 'まくり', 'まくり差し', '抜き', '恵まれ')),  -- 6分類以外（逃げ抜き等）・不明は NULL
  winner_course     smallint CHECK (winner_course BETWEEN 1 AND 6),        -- 1着艇の進入コース。不明は NULL
  course_by_boat    smallint[] NOT NULL,           -- [1号艇のコース, …, 6号艇]。実進入が分からない艇は NULL（艇番で埋めない。BOA-523）
  st_by_course      numeric(4,2)[] NOT NULL,      -- [1コースのST, …, 6コース]。フライング・出遅れ・不明のコースは NULL
  payout_3tan       integer,                       -- 3連単の払戻（円）。本体は race_results.payout_trio（列名と券種が逆）。不成立は母集団に入れない
  source            text NOT NULL CHECK (source IN ('kb', 'main')),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE analogy_pool_outcomes IS 'BOA-271 FR-2 類似レース（層別 S*）の母集団。完全レース（6艇・欠場なし・1〜3着に返還艇なし・不成立でない）1行。refresh_analogy_pool が作る';

-- 条件の順の複合索引。どの深さの層も先頭一致で引ける（深さ4: 4列、深さ1: gap_band だけ）
CREATE INDEX IF NOT EXISTS idx_analogy_pool_strata
  ON analogy_pool_outcomes (gap_band, b1_class, venue_code, top_boat, race_date DESC);
CREATE INDEX IF NOT EXISTS idx_analogy_pool_date ON analogy_pool_outcomes (race_date);
-- 深さ1〜3の「新しい順」の一覧（recent・BOA-635 の最大2,000件）を、層の全件を並べ替えずに読むための索引。
-- 本番適用後に深さ1〜4で EXPLAIN (ANALYZE, BUFFERS) を取り、使われない索引は落とす（BOA-635 のレーンと合意）
CREATE INDEX IF NOT EXISTS idx_analogy_pool_d1 ON analogy_pool_outcomes (gap_band, race_date DESC);
CREATE INDEX IF NOT EXISTS idx_analogy_pool_d2 ON analogy_pool_outcomes (gap_band, b1_class, race_date DESC);
CREATE INDEX IF NOT EXISTS idx_analogy_pool_d3 ON analogy_pool_outcomes (gap_band, b1_class, venue_code, race_date DESC);

ALTER TABLE analogy_pool_outcomes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read access" ON analogy_pool_outcomes;
CREATE POLICY "Public read access" ON analogy_pool_outcomes FOR SELECT USING (true);
REVOKE ALL ON analogy_pool_outcomes FROM anon, authenticated;
GRANT SELECT ON analogy_pool_outcomes TO anon, authenticated;

-- ---------------------------------------------------------------
-- 3. スナップショット（BOA-627）
-- ---------------------------------------------------------------
-- 自動で選んだ深さの分布を保存し、表示ではそれをそのまま返す（ADR-0082 決定4）。
-- 条件チップで深さを変えた表示だけ、pool_cutoff 以前の母集団で数え直す（探索用で、時点固定の対象にしない）。
CREATE TABLE IF NOT EXISTS analogy_snapshots (
  race_id      varchar PRIMARY KEY REFERENCES races(race_id) ON DELETE CASCADE,  -- 1レース1行（BOA-635 の D-6）
  b1_class     text NOT NULL,
  b1_win_gap   numeric(4,2),
  gap_band     smallint NOT NULL,
  venue_code   smallint NOT NULL,
  top_boat     smallint NOT NULL,
  auto_depth   smallint NOT NULL CHECK (auto_depth BETWEEN 1 AND 4),
  n_by_depth   integer[] NOT NULL,               -- [深さ1, 深さ2, 深さ3, 深さ4] の件数
  pool_from    date NOT NULL,
  pool_cutoff  date NOT NULL,                    -- 数えた母集団の最終日（今日より前）
  distribution jsonb NOT NULL,                   -- auto_depth の層の分布（analogy_layer_distribution の返り値）。1行あたり数KB
  created_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE analogy_snapshots IS 'BOA-627 類似レースの発走前の時点固定。条件・深さ・深さごとの件数・母集団の期間と、自動で選んだ深さの分布';

ALTER TABLE analogy_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read access" ON analogy_snapshots;
CREATE POLICY "Public read access" ON analogy_snapshots FOR SELECT USING (true);
REVOKE ALL ON analogy_snapshots FROM anon, authenticated;
GRANT SELECT ON analogy_snapshots TO anon, authenticated;

-- ---------------------------------------------------------------
-- 4. 今日のレースの4条件（出走表時点）
-- ---------------------------------------------------------------
-- 6艇の出走表がそろわないレースは0行。欠場（is_absent）の艇がいても出走表の値で作る（発走前の表示のため）。
CREATE OR REPLACE FUNCTION analogy_race_conditions(p_race_id varchar)
RETURNS TABLE (race_id varchar, race_date date, venue_code smallint, b1_class text,
               b1_win_gap numeric, gap_band smallint, top_boat smallint)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT r.race_id, r.race_date, r.venue_code::smallint,
    coalesce(max(e.grade) FILTER (WHERE e.boat_number = 1 AND e.grade IN ('A1', 'A2', 'B1', 'B2')), ''),
    round(max(e.win_rate) FILTER (WHERE e.boat_number = 1) - max(e.win_rate) FILTER (WHERE e.boat_number > 1), 2),
    analogy_gap_band(round(max(e.win_rate) FILTER (WHERE e.boat_number = 1) - max(e.win_rate) FILTER (WHERE e.boat_number > 1), 2)),
    ((array_agg(e.boat_number ORDER BY e.win_rate DESC NULLS LAST, e.boat_number))[1])::smallint
  FROM races r
  JOIN race_entries e ON e.race_id = r.race_id
  WHERE r.race_id = p_race_id
  GROUP BY r.race_id, r.race_date, r.venue_code
  HAVING count(*) = 6
$$;

-- 今日のレースの任意の3条件。6艇の出走表がそろわないレースは0行
CREATE OR REPLACE FUNCTION analogy_race_extras(p_race_id varchar)
RETURNS TABLE (round text, grade text, b1_motor_band smallint)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT analogy_round_from_stage(max(c.race_stage)),
    analogy_grade_of(max(r.race_grade), r.venue_code::smallint, r.race_date),
    analogy_motor_band(CASE WHEN b1.m IS NOT NULL
                            THEN 1 + count(*) FILTER (WHERE e.boat_number > 1 AND nullif(e.motor_2rate, 0) > b1.m) END::int)
  FROM races r
  JOIN race_entries e ON e.race_id = r.race_id
  LEFT JOIN race_conditions c ON c.race_id = r.race_id
  LEFT JOIN LATERAL (SELECT nullif(e1.motor_2rate, 0) AS m FROM race_entries e1
                     WHERE e1.race_id = r.race_id AND e1.boat_number = 1) b1 ON true
  WHERE r.race_id = p_race_id
  GROUP BY r.race_id, r.race_date, r.venue_code, b1.m
  HAVING count(*) = 6
$$;

-- ---------------------------------------------------------------
-- 5. 母集団の行（長期分・本体）
-- ---------------------------------------------------------------
-- 完全レースの判定は features.py の load_kb / load_main / add_labels と同じ:
--   6艇、欠場（長期: 着順欄が K で始まる・空、本体: race_entries / exhibition_data の is_absent）が無い、
--   結果がある（長期: has_result、本体: rank1 あり・is_cancelled / is_no_race でない・race_status <> 'no_race'・
--   races.cancellation_status が空）、1着が返還艇でない艇1艇、1〜3着に返還艇（フライング・出遅れ）が無い。
CREATE OR REPLACE FUNCTION analogy_pool_rows_kb(p_from date, p_to date)
RETURNS TABLE (race_id varchar, race_date date, venue_code smallint, race_number smallint, b1_class text,
               b1_win_gap numeric, top_boat smallint, round text, grade text, b1_motor_band smallint,
               rank1 smallint, rank2 smallint, rank3 smallint,
               winning_technique text, winner_course smallint, course_by_boat smallint[], st_by_course numeric[],
               payout_3tan integer, source text)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH r AS (
    SELECT kr.race_id, kr.race_date, kr.venue_code, kr.race_number, kr.technique, kr.payout_3tan,
      analogy_round_from_kb(kr.stage, kr.stage_kind) AS round,
      analogy_grade_of(vd.race_grade, kr.venue_code::smallint, kr.race_date) AS grade
    FROM kb_archive_races kr
    LEFT JOIN kb_archive_venue_days vd ON vd.venue_day_id = kr.venue_day_id
    WHERE kr.has_result AND kr.race_date BETWEEN p_from AND least(p_to, DATE '2025-12-02')
  ), b AS (
    SELECT b.race_id, b.boat_number, b.class, b.national_win_rate AS w, nullif(b.motor_2rate, 0) AS m,
      max(nullif(b.motor_2rate, 0)) FILTER (WHERE b.boat_number = 1) OVER (PARTITION BY b.race_id) AS m1,
      CASE WHEN b.course BETWEEN 1 AND 6 THEN b.course END AS course,
      coalesce(b.is_flying, false) OR coalesce(b.is_late_start, false) AS returned,
      b.start_timing, b.finish_rank, b.finish_raw
    FROM kb_archive_boats b JOIN r ON r.race_id = b.race_id
  ), a AS (
    SELECT race_id,
      count(*) AS n_boats,
      bool_or(finish_raw IS NULL OR finish_raw LIKE 'K%') AS has_absent,
      bool_or(returned AND finish_rank <= 3) AS returned_top3,
      count(*) FILTER (WHERE finish_rank = 1 AND NOT returned) AS n_win,
      coalesce(max(class) FILTER (WHERE boat_number = 1 AND class IN ('A1', 'A2', 'B1', 'B2')), '') AS b1_class,
      round(max(w) FILTER (WHERE boat_number = 1) - max(w) FILTER (WHERE boat_number > 1), 2) AS gap,
      (array_agg(boat_number ORDER BY w DESC NULLS LAST, boat_number))[1] AS top_boat,
      -- 1号艇のモーター2連率の順位（高い順、同率は上の順位。features.py の rank(method="min")。0 は不明として除く）
      CASE WHEN max(m1) IS NOT NULL THEN 1 + count(*) FILTER (WHERE boat_number > 1 AND m > m1) END AS motor_rank,
      max(boat_number) FILTER (WHERE finish_rank = 1) AS rank1,
      max(boat_number) FILTER (WHERE finish_rank = 2) AS rank2,
      max(boat_number) FILTER (WHERE finish_rank = 3) AS rank3,
      max(course) FILTER (WHERE finish_rank = 1) AS winner_course,
      array_agg(course ORDER BY boat_number) AS course_by_boat,
      ARRAY[1, 2, 3, 4, 5, 6]::smallint[] AS cs,
      jsonb_object_agg(coalesce(course, 0), CASE WHEN NOT returned THEN start_timing END) AS st_map
    FROM b GROUP BY race_id
  )
  SELECT r.race_id, r.race_date, r.venue_code::smallint, r.race_number::smallint,
    a.b1_class, a.gap, a.top_boat::smallint, r.round, r.grade, analogy_motor_band(a.motor_rank::int),
    a.rank1::smallint, a.rank2::smallint, a.rank3::smallint,
    CASE WHEN r.technique IN ('逃げ', '差し', 'まくり', 'まくり差し', '抜き', '恵まれ') THEN r.technique END,
    a.winner_course::smallint,
    a.course_by_boat::smallint[],
    ARRAY(SELECT (a.st_map ->> c::text)::numeric(4,2) FROM unnest(a.cs) AS c ORDER BY c),
    r.payout_3tan, 'kb'
  FROM a JOIN r ON r.race_id = a.race_id
  WHERE a.n_boats = 6 AND NOT a.has_absent AND NOT a.returned_top3 AND a.n_win = 1
    AND a.rank2 IS NOT NULL AND a.rank3 IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION analogy_pool_rows_main(p_from date, p_to date)
RETURNS TABLE (race_id varchar, race_date date, venue_code smallint, race_number smallint, b1_class text,
               b1_win_gap numeric, top_boat smallint, round text, grade text, b1_motor_band smallint,
               rank1 smallint, rank2 smallint, rank3 smallint,
               winning_technique text, winner_course smallint, course_by_boat smallint[], st_by_course numeric[],
               payout_3tan integer, source text)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH r AS (
    SELECT r.race_id, r.race_date, r.venue_code, r.race_number,
      analogy_round_from_stage(c.race_stage) AS round,
      analogy_grade_of(r.race_grade, r.venue_code::smallint, r.race_date) AS grade
    FROM races r
    LEFT JOIN race_conditions c ON c.race_id = r.race_id
    WHERE r.race_date BETWEEN greatest(p_from, DATE '2025-12-03') AND p_to
      AND coalesce(r.cancellation_status, '') = ''
  ), res AS (
    SELECT rr.*
    FROM race_results rr JOIN r ON r.race_id = rr.race_id
    WHERE rr.rank1 IS NOT NULL AND NOT coalesce(rr.is_cancelled, false) AND NOT coalesce(rr.is_no_race, false)
      AND coalesce(rr.race_status, 'normal') <> 'no_race'
  ), b AS (
    SELECT e.race_id, e.boat_number, e.grade, e.win_rate AS w, nullif(e.motor_2rate, 0) AS m,
      max(nullif(e.motor_2rate, 0)) FILTER (WHERE e.boat_number = 1) OVER (PARTITION BY e.race_id) AS m1,
      coalesce(e.is_absent, false) OR coalesce(x.is_absent, false) AS absent,
      -- 返還艇: フライング・出遅れのフラグに加えて、着の欄（F・L・欠）と返還艇の一覧も見る（BOA-635 の依頼。
      -- フラグが立っていないのに着欄が F・L・欠のレースが 247艇あった。features.py より厳しい）
      coalesce(st.is_flying, false) OR coalesce(st.is_late_start, false)
        OR coalesce(st.finish_mark IN ('F', 'L', '欠'), false)
        OR e.boat_number = ANY (coalesce(res.refund_boats, '{}')) AS returned,
      st.start_timing,
      (ARRAY[res.actual_course_1, res.actual_course_2, res.actual_course_3,
             res.actual_course_4, res.actual_course_5, res.actual_course_6])[e.boat_number] AS course,
      array_position(ARRAY[res.rank1, res.rank2, res.rank3, res.rank4, res.rank5, res.rank6], e.boat_number) AS finish_rank
    FROM race_entries e
    JOIN res ON res.race_id = e.race_id
    LEFT JOIN exhibition_data x ON x.race_id = e.race_id AND x.boat_number = e.boat_number
    LEFT JOIN race_start_timings st ON st.race_id = e.race_id AND st.boat_number = e.boat_number
  ), a AS (
    SELECT race_id,
      count(*) AS n_boats,
      bool_or(absent) AS has_absent,
      bool_or(returned AND finish_rank <= 3) AS returned_top3,
      count(*) FILTER (WHERE finish_rank = 1 AND NOT returned) AS n_win,
      coalesce(max(grade) FILTER (WHERE boat_number = 1 AND grade IN ('A1', 'A2', 'B1', 'B2')), '') AS b1_class,
      round(max(w) FILTER (WHERE boat_number = 1) - max(w) FILTER (WHERE boat_number > 1), 2) AS gap,
      (array_agg(boat_number ORDER BY w DESC NULLS LAST, boat_number))[1] AS top_boat,
      -- 1号艇のモーター2連率の順位（高い順、同率は上の順位。features.py の rank(method="min")。0 は不明として除く）
      CASE WHEN max(m1) IS NOT NULL THEN 1 + count(*) FILTER (WHERE boat_number > 1 AND m > m1) END AS motor_rank,
      max(boat_number) FILTER (WHERE finish_rank = 1) AS rank1,
      max(boat_number) FILTER (WHERE finish_rank = 2) AS rank2,
      max(boat_number) FILTER (WHERE finish_rank = 3) AS rank3,
      max(CASE WHEN course BETWEEN 1 AND 6 THEN course END) FILTER (WHERE finish_rank = 1) AS winner_course,
      array_agg(CASE WHEN course BETWEEN 1 AND 6 THEN course END ORDER BY boat_number) AS course_by_boat,
      ARRAY[1, 2, 3, 4, 5, 6]::smallint[] AS cs,
      jsonb_object_agg(CASE WHEN course BETWEEN 1 AND 6 THEN course ELSE 0 END,
                       CASE WHEN NOT returned THEN start_timing END) AS st_map
    FROM b GROUP BY race_id
  )
  SELECT r.race_id, r.race_date, r.venue_code::smallint, r.race_number::smallint,
    a.b1_class, a.gap, a.top_boat::smallint, r.round, r.grade, analogy_motor_band(a.motor_rank::int),
    a.rank1::smallint, a.rank2::smallint, a.rank3::smallint,
    CASE WHEN res.winning_technique IN ('逃げ', '差し', 'まくり', 'まくり差し', '抜き', '恵まれ') THEN res.winning_technique END,
    a.winner_course::smallint,
    a.course_by_boat::smallint[],
    ARRAY(SELECT (a.st_map ->> c::text)::numeric(4,2) FROM unnest(a.cs) AS c ORDER BY c),
    res.payout_trio, 'main'
  FROM a
  JOIN r ON r.race_id = a.race_id
  JOIN res ON res.race_id = a.race_id
  WHERE a.n_boats = 6 AND NOT a.has_absent AND NOT a.returned_top3 AND a.n_win = 1
    AND a.rank2 IS NOT NULL AND a.rank3 IS NOT NULL
$$;

-- ---------------------------------------------------------------
-- 6. 母集団の更新（service_role のみ）
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_analogy_pool(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
SET statement_timeout = '180s'
AS $$
DECLARE
  v_src integer; v_upserted integer; v_deleted integer;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'refresh_analogy_pool: 期間が不正です (% 〜 %)', p_from, p_to;
  END IF;

  CREATE TEMP TABLE _analogy_src ON COMMIT DROP AS
    SELECT * FROM analogy_pool_rows_kb(p_from, p_to)
    UNION ALL
    SELECT * FROM analogy_pool_rows_main(p_from, p_to);
  GET DIAGNOSTICS v_src = ROW_COUNT;

  -- 値が変わった行だけ書く（全行 UPDATE しない）
  INSERT INTO analogy_pool_outcomes AS t (race_id, race_date, venue_code, race_number, b1_class, b1_win_gap,
    top_boat, round, grade, b1_motor_band, rank1, rank2, rank3, winning_technique, winner_course, course_by_boat, st_by_course,
    payout_3tan, source, updated_at)
  SELECT race_id, race_date, venue_code, race_number, b1_class, b1_win_gap,
    top_boat, round, grade, b1_motor_band, rank1, rank2, rank3, winning_technique, winner_course, course_by_boat, st_by_course,
    payout_3tan, source, now()
  FROM _analogy_src
  ON CONFLICT (race_id) DO UPDATE SET
    race_date = EXCLUDED.race_date, venue_code = EXCLUDED.venue_code, race_number = EXCLUDED.race_number,
    b1_class = EXCLUDED.b1_class, b1_win_gap = EXCLUDED.b1_win_gap, top_boat = EXCLUDED.top_boat,
    round = EXCLUDED.round, grade = EXCLUDED.grade, b1_motor_band = EXCLUDED.b1_motor_band,
    rank1 = EXCLUDED.rank1, rank2 = EXCLUDED.rank2, rank3 = EXCLUDED.rank3,
    winning_technique = EXCLUDED.winning_technique, winner_course = EXCLUDED.winner_course,
    course_by_boat = EXCLUDED.course_by_boat, st_by_course = EXCLUDED.st_by_course,
    payout_3tan = EXCLUDED.payout_3tan, source = EXCLUDED.source, updated_at = now()
  WHERE (t.b1_class, t.b1_win_gap, t.top_boat, t.round, t.grade, t.b1_motor_band, t.rank1, t.rank2, t.rank3, t.winning_technique,
         t.winner_course, t.course_by_boat, t.st_by_course, t.payout_3tan)
     IS DISTINCT FROM
        (EXCLUDED.b1_class, EXCLUDED.b1_win_gap, EXCLUDED.top_boat, EXCLUDED.round, EXCLUDED.grade,
         EXCLUDED.b1_motor_band, EXCLUDED.rank1, EXCLUDED.rank2,
         EXCLUDED.rank3, EXCLUDED.winning_technique, EXCLUDED.winner_course, EXCLUDED.course_by_boat,
         EXCLUDED.st_by_course, EXCLUDED.payout_3tan);
  GET DIAGNOSTICS v_upserted = ROW_COUNT;

  -- 範囲内で完全レースでなくなった行（結果の訂正・中止の後付け等）を消す
  DELETE FROM analogy_pool_outcomes t
  WHERE t.race_date BETWEEN p_from AND p_to
    AND NOT EXISTS (SELECT 1 FROM _analogy_src s WHERE s.race_id = t.race_id);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  DROP TABLE _analogy_src;
  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'source_rows', v_src,
                            'upserted', v_upserted, 'deleted', v_deleted);
END;
$$;

-- ---------------------------------------------------------------
-- 7. 層の件数と分布
-- ---------------------------------------------------------------
-- 深さごとの件数 [深さ1, 深さ2, 深さ3, 深さ4]。深さを決める n は層の行数（決まり手・進入の欠けも数える）
-- p_round・p_grade・p_motor_band は任意の条件（NULL なら絞らない）。任意の条件をオンにしたまま「戻す」ときの件数に使う
CREATE OR REPLACE FUNCTION analogy_layer_counts(p_gap_band smallint, p_b1_class text, p_venue_code smallint,
                                                p_top_boat smallint, p_cutoff date,
                                                p_round text DEFAULT NULL, p_grade text DEFAULT NULL,
                                                p_motor_band smallint DEFAULT NULL)
RETURNS integer[]
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT ARRAY[count(*)::int,
    (count(*) FILTER (WHERE p.b1_class = p_b1_class))::int,
    (count(*) FILTER (WHERE p.b1_class = p_b1_class AND p.venue_code = p_venue_code))::int,
    (count(*) FILTER (WHERE p.b1_class = p_b1_class AND p.venue_code = p_venue_code AND p.top_boat = p_top_boat))::int]
  FROM analogy_pool_outcomes p
  WHERE p.gap_band = p_gap_band AND p.race_date <= p_cutoff
    AND (p_round IS NULL OR p.round = p_round)
    AND (p_grade IS NULL OR p.grade = p_grade)
    AND (p_motor_band IS NULL OR p.b1_motor_band = p_motor_band)
$$;

-- 件数が200以上になる最も深い層（m=200）。どの深さでも足りなければ1
CREATE OR REPLACE FUNCTION analogy_auto_depth(p_n_by_depth integer[])
RETURNS smallint
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT (CASE WHEN p_n_by_depth[4] >= 200 THEN 4 WHEN p_n_by_depth[3] >= 200 THEN 3
               WHEN p_n_by_depth[2] >= 200 THEN 2 ELSE 1 END)::smallint
$$;

-- 層の分布（スナップショットと画面の RPC で共用）。返す jsonb:
--   n
--   technique      {"逃げ": 件数, …, "不明": 件数}
--   winner_boat    {"1": 件数, …}
--   winner_course  {"1": 件数, …, "不明": 件数}
--   trifecta       {"1-2-3": 件数, …}（出た組み合わせすべて。FR-3 のサンキー図・組み合わせ一覧はここから作る）
--   course_flow    {"<1着の進入>-<2着の進入>|<決まり手>": 件数}（FR-3 のコールアウト用。進入不明は 0）
-- p_round・p_grade・p_motor_band は任意の条件（Q6）。NULL なら絞らない。スナップショットは渡さない
CREATE OR REPLACE FUNCTION analogy_layer_distribution(p_gap_band smallint, p_b1_class text, p_venue_code smallint,
                                                      p_top_boat smallint, p_depth smallint, p_cutoff date,
                                                      p_round text DEFAULT NULL, p_grade text DEFAULT NULL,
                                                      p_motor_band smallint DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH l AS (
    SELECT p.rank1, p.rank2, p.rank3, p.winning_technique, p.winner_course, p.course_by_boat
    FROM analogy_pool_outcomes p
    WHERE p.gap_band = p_gap_band
      AND (p_depth < 2 OR p.b1_class = p_b1_class)
      AND (p_depth < 3 OR p.venue_code = p_venue_code)
      AND (p_depth < 4 OR p.top_boat = p_top_boat)
      AND (p_round IS NULL OR p.round = p_round)
      AND (p_grade IS NULL OR p.grade = p_grade)
      AND (p_motor_band IS NULL OR p.b1_motor_band = p_motor_band)
      AND p.race_date <= p_cutoff
  )
  SELECT jsonb_build_object(
    'n', (SELECT count(*) FROM l),
    'technique', (SELECT coalesce(jsonb_object_agg(k, c), '{}') FROM
                   (SELECT coalesce(winning_technique, '不明') AS k, count(*) AS c FROM l GROUP BY 1) t),
    'winner_boat', (SELECT coalesce(jsonb_object_agg(k, c), '{}') FROM
                   (SELECT rank1 AS k, count(*) AS c FROM l GROUP BY 1) t),
    'winner_course', (SELECT coalesce(jsonb_object_agg(k, c), '{}') FROM
                   (SELECT coalesce(winner_course::text, '不明') AS k, count(*) AS c FROM l GROUP BY 1) t),
    'trifecta', (SELECT coalesce(jsonb_object_agg(k, c), '{}') FROM
                   (SELECT rank1 || '-' || rank2 || '-' || rank3 AS k, count(*) AS c FROM l GROUP BY 1) t),
    'course_flow', (SELECT coalesce(jsonb_object_agg(k, c), '{}') FROM
                   (SELECT coalesce(winner_course, 0) || '-' || coalesce(course_by_boat[rank2], 0)
                           || '|' || coalesce(winning_technique, '不明') AS k, count(*) AS c FROM l GROUP BY 1) t)
  )
$$;

-- 任意の条件を「足すと N件」（Q6）。今の層（深さ＋オンの任意の条件）に、それぞれ1つずつ足したときの件数。
-- 今日のレースの値が不明な条件（ステージ・グレードが無い、1号艇のモーター2連率が無い）は NULL（足せない）。
-- 既にオンの条件は今の件数と同じ値になる。返す jsonb: {"round": N|null, "grade": N|null, "motor": N|null}
CREATE OR REPLACE FUNCTION analogy_optional_counts(p_gap_band smallint, p_b1_class text, p_venue_code smallint,
                                                   p_top_boat smallint, p_depth smallint, p_cutoff date,
                                                   p_round text, p_grade text, p_motor_band smallint,
                                                   p_use_round boolean, p_use_grade boolean, p_use_motor boolean)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH l AS (
    SELECT p.round = p_round AS m_round, p.grade = p_grade AS m_grade, p.b1_motor_band = p_motor_band AS m_motor
    FROM analogy_pool_outcomes p
    WHERE p.gap_band = p_gap_band
      AND (p_depth < 2 OR p.b1_class = p_b1_class)
      AND (p_depth < 3 OR p.venue_code = p_venue_code)
      AND (p_depth < 4 OR p.top_boat = p_top_boat)
      AND (NOT p_use_round OR p.round = p_round)
      AND (NOT p_use_grade OR p.grade = p_grade)
      AND (NOT p_use_motor OR p.b1_motor_band = p_motor_band)
      AND p.race_date <= p_cutoff
  )
  SELECT jsonb_build_object(
    'round', CASE WHEN p_round IS NOT NULL THEN (SELECT count(*) FILTER (WHERE m_round) FROM l) END,
    'grade', CASE WHEN p_grade IS NOT NULL THEN (SELECT count(*) FILTER (WHERE m_grade) FROM l) END,
    'motor', CASE WHEN p_motor_band < 3 THEN (SELECT count(*) FILTER (WHERE m_motor) FROM l) END)
$$;

-- ---------------------------------------------------------------
-- 8. スナップショットの作成（service_role のみ）
-- ---------------------------------------------------------------
-- 締切前（races.start_time は JST）・中止でない・6艇の出走表がそろったレースだけ。既にあれば作らない。
-- 母集団はその日より前の行だけを数える。作った行数を返す。
CREATE OR REPLACE FUNCTION create_analogy_snapshots(p_date date)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
SET statement_timeout = '240s'
AS $$
DECLARE
  v_from date; v_cutoff date; v_n integer;
BEGIN
  SELECT min(race_date), max(race_date) INTO v_from, v_cutoff
  FROM analogy_pool_outcomes WHERE race_date < p_date;
  IF v_cutoff IS NULL THEN
    RAISE EXCEPTION 'create_analogy_snapshots: % より前の母集団がありません（refresh_analogy_pool が未実行）', p_date;
  END IF;

  INSERT INTO analogy_snapshots (race_id, b1_class, b1_win_gap, gap_band, venue_code, top_boat,
                                 auto_depth, n_by_depth, pool_from, pool_cutoff, distribution)
  SELECT c.race_id, c.b1_class, c.b1_win_gap, c.gap_band, c.venue_code, c.top_boat,
    d.auto_depth, n.n_by_depth, v_from, v_cutoff,
    analogy_layer_distribution(c.gap_band, c.b1_class, c.venue_code, c.top_boat, d.auto_depth, v_cutoff)
  FROM races r
  CROSS JOIN LATERAL analogy_race_conditions(r.race_id) c
  CROSS JOIN LATERAL (SELECT analogy_layer_counts(c.gap_band, c.b1_class, c.venue_code, c.top_boat, v_cutoff)
                        AS n_by_depth) n
  CROSS JOIN LATERAL (SELECT analogy_auto_depth(n.n_by_depth) AS auto_depth) d
  WHERE r.race_date = p_date
    AND coalesce(r.cancellation_status, '') = ''
    AND (r.race_date + r.start_time) > (now() AT TIME ZONE 'Asia/Tokyo')
    AND NOT EXISTS (SELECT 1 FROM analogy_snapshots s WHERE s.race_id = r.race_id)
  ON CONFLICT (race_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- ---------------------------------------------------------------
-- 8b. レースの条件と母集団の範囲（2つの RPC で共用）
-- ---------------------------------------------------------------
-- スナップショットがあればその行。無ければ出走表から条件を作り、その日より前の母集団で深さごとの件数を数えた行
-- （created_at と distribution は NULL）。出走表が6艇そろわない・母集団が無いときは NULL。
CREATE OR REPLACE FUNCTION analogy_resolve_race(p_race_id varchar)
RETURNS analogy_snapshots
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  s analogy_snapshots%ROWTYPE;
BEGIN
  SELECT * INTO s FROM analogy_snapshots WHERE race_id = p_race_id;
  IF FOUND THEN RETURN s; END IF;

  SELECT c.race_id, c.b1_class, c.b1_win_gap, c.gap_band, c.venue_code, c.top_boat
    INTO s.race_id, s.b1_class, s.b1_win_gap, s.gap_band, s.venue_code, s.top_boat
  FROM analogy_race_conditions(p_race_id) c;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT min(p.race_date), max(p.race_date) INTO s.pool_from, s.pool_cutoff
  FROM analogy_pool_outcomes p
  WHERE p.race_date < (SELECT race_date FROM races WHERE race_id = p_race_id);
  IF s.pool_cutoff IS NULL THEN RETURN NULL; END IF;
  s.n_by_depth := analogy_layer_counts(s.gap_band, s.b1_class, s.venue_code, s.top_boat, s.pool_cutoff);
  s.auto_depth := analogy_auto_depth(s.n_by_depth);
  RETURN s;
END;
$$;

-- ---------------------------------------------------------------
-- 9. 画面の RPC
-- ---------------------------------------------------------------
-- p_depth を省略すると自動の深さ。1〜4 を渡すとその層（条件チップ）。
-- p_round・p_grade・p_motor を true にすると、その任意の条件（Q6）を今の深さの上に重ねる（今日のレースと同じ値の行だけ）。
-- スナップショットがあり、深さが自動の深さで、任意の条件がすべてオフなら、保存した分布をそのまま返す（時点固定）。
-- それ以外（チップで深さを変えた・任意の条件を足した・スナップショットが無い）は、pool_cutoff 以前の母集団で数える。
-- スナップショットが無いときは、出走表から条件を作り、その日より前の母集団で数える。
-- 今日のレースの値が不明な任意の条件をオンにしたときは例外（画面はその条件を足せる形で出さない）。
-- 返す jsonb: analogy_layer_distribution の中身に加えて
--   race_id, snapshot（bool）, snapshot_at, from_snapshot（分布が保存した値か）,
--   conditions{b1_class,b1_win_gap,gap_band,venue_code,top_boat}, depth, auto_depth, n_by_depth[1..4],
--   extras{round,grade,b1_motor_band}（今日のレースの任意の条件の値。不明は null、モーターの不明は 3）,
--   filters{round,grade,motor}（オンにした任意の条件）,
--   n_if_added{round,grade,motor}（今の層にそれぞれ足したときの件数。足せない条件は null）,
--   n_by_depth_filtered[1..4]（オンにした任意の条件を重ねた深さごとの件数。「戻す」「外す」の先が0件かを画面が見る。
--   任意の条件がすべてオフなら n_by_depth と同じ）,
--   pool_from, pool_cutoff,
--   recent[{race_id, race_date, venue_code, race_number, rank1, rank2, rank3, winning_technique}]（同じ層の新しい順20件）
-- 該当なし（出走表が6艇そろわない・母集団が無い）は NULL。
CREATE OR REPLACE FUNCTION get_analogy_similar(p_race_id varchar, p_depth smallint DEFAULT NULL,
                                               p_round boolean DEFAULT false, p_grade boolean DEFAULT false,
                                               p_motor boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '5s'
AS $$
DECLARE
  s analogy_snapshots%ROWTYPE;
  x record;
  v_snap boolean;
  v_depth smallint;
  v_any boolean;
  v_round text; v_grade text; v_motor smallint;
  v_dist jsonb;
  v_recent jsonb;
BEGIN
  s := analogy_resolve_race(p_race_id);
  IF s.race_id IS NULL THEN RETURN NULL; END IF;
  v_snap := s.created_at IS NOT NULL;

  v_depth := coalesce(p_depth, s.auto_depth);
  IF v_depth NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION 'get_analogy_similar: p_depth は 1〜4 です（%）', v_depth;
  END IF;

  SELECT * INTO x FROM analogy_race_extras(p_race_id);
  IF coalesce(p_round, false) AND x.round IS NULL THEN
    RAISE EXCEPTION 'get_analogy_similar: % はステージが分からないため、ラウンドで絞れません', p_race_id;
  END IF;
  IF coalesce(p_grade, false) AND x.grade IS NULL THEN
    RAISE EXCEPTION 'get_analogy_similar: % はグレードが分からないため、グレードで絞れません', p_race_id;
  END IF;
  IF coalesce(p_motor, false) AND coalesce(x.b1_motor_band, 3) = 3 THEN
    RAISE EXCEPTION 'get_analogy_similar: % は1号艇のモーター2連率が分からないため、モーターで絞れません', p_race_id;
  END IF;
  v_round := CASE WHEN p_round THEN x.round END;
  v_grade := CASE WHEN p_grade THEN x.grade END;
  v_motor := CASE WHEN p_motor THEN x.b1_motor_band END;
  v_any := v_round IS NOT NULL OR v_grade IS NOT NULL OR v_motor IS NOT NULL;

  IF v_snap AND v_depth = s.auto_depth AND NOT v_any THEN
    v_dist := s.distribution;
  ELSE
    v_dist := analogy_layer_distribution(s.gap_band, s.b1_class, s.venue_code, s.top_boat, v_depth, s.pool_cutoff,
                                         v_round, v_grade, v_motor);
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.race_date DESC, t.race_id DESC), '[]') INTO v_recent
  FROM (SELECT p.race_id, p.race_date, p.venue_code, p.race_number, p.rank1, p.rank2, p.rank3, p.winning_technique
        FROM analogy_pool_outcomes p
        WHERE p.gap_band = s.gap_band
          AND (v_depth < 2 OR p.b1_class = s.b1_class)
          AND (v_depth < 3 OR p.venue_code = s.venue_code)
          AND (v_depth < 4 OR p.top_boat = s.top_boat)
          AND (v_round IS NULL OR p.round = v_round)
          AND (v_grade IS NULL OR p.grade = v_grade)
          AND (v_motor IS NULL OR p.b1_motor_band = v_motor)
          AND p.race_date <= s.pool_cutoff
        ORDER BY p.race_date DESC, p.race_id DESC LIMIT 20) t;

  RETURN v_dist || jsonb_build_object(
    'race_id', p_race_id,
    'snapshot', v_snap,
    'snapshot_at', s.created_at,
    'from_snapshot', v_snap AND v_depth = s.auto_depth AND NOT v_any,
    'conditions', jsonb_build_object('b1_class', s.b1_class, 'b1_win_gap', s.b1_win_gap, 'gap_band', s.gap_band,
                                     'venue_code', s.venue_code, 'top_boat', s.top_boat),
    'depth', v_depth, 'auto_depth', s.auto_depth, 'n_by_depth', to_jsonb(s.n_by_depth),
    'extras', jsonb_build_object('round', x.round, 'grade', x.grade, 'b1_motor_band', coalesce(x.b1_motor_band, 3)),
    'filters', jsonb_build_object('round', v_round IS NOT NULL, 'grade', v_grade IS NOT NULL,
                                  'motor', v_motor IS NOT NULL),
    'n_by_depth_filtered', CASE WHEN v_any
      THEN to_jsonb(analogy_layer_counts(s.gap_band, s.b1_class, s.venue_code, s.top_boat, s.pool_cutoff,
                                         v_round, v_grade, v_motor))
      ELSE to_jsonb(s.n_by_depth) END,
    'n_if_added', analogy_optional_counts(s.gap_band, s.b1_class, s.venue_code, s.top_boat, v_depth, s.pool_cutoff,
                                          x.round, x.grade, coalesce(x.b1_motor_band, 3)::smallint,
                                          v_round IS NOT NULL, v_grade IS NOT NULL, v_motor IS NOT NULL),
    'pool_from', s.pool_from, 'pool_cutoff', s.pool_cutoff,
    'recent', v_recent);
END;
$$;

-- ---------------------------------------------------------------
-- 9b. BOA-635 の RPC（自動の深さの層の行。2026-10-02 BOA-635 のレーンと合意）
-- ---------------------------------------------------------------
-- 自動の深さの層から、pool_cutoff 以前を新しい順に最大2,000件。発走後も同じ範囲で返す（スナップショットの pool_cutoff）。
-- 返す jsonb: snapshot, snapshot_at, depth, conditions, n_total（層の総件数）, n_returned, pool_from, pool_cutoff,
--   rows[{race_date, rank1, rank2, rank3, winning_technique, course_by_boat, st_by_course, payout_3tan}]
-- 該当なしは NULL。
CREATE OR REPLACE FUNCTION get_analogy_similar_races(p_race_id varchar)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '5s'
AS $$
DECLARE
  s analogy_snapshots%ROWTYPE;
  v_rows jsonb;
BEGIN
  s := analogy_resolve_race(p_race_id);
  IF s.race_id IS NULL THEN RETURN NULL; END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.race_date DESC, t.race_id DESC) , '[]') INTO v_rows
  FROM (SELECT p.race_id, p.race_date, p.rank1, p.rank2, p.rank3, p.winning_technique, p.course_by_boat,
               p.st_by_course, p.payout_3tan
        FROM analogy_pool_outcomes p
        WHERE p.gap_band = s.gap_band
          AND (s.auto_depth < 2 OR p.b1_class = s.b1_class)
          AND (s.auto_depth < 3 OR p.venue_code = s.venue_code)
          AND (s.auto_depth < 4 OR p.top_boat = s.top_boat)
          AND p.race_date <= s.pool_cutoff
        ORDER BY p.race_date DESC, p.race_id DESC LIMIT 2000) t;

  RETURN jsonb_build_object(
    'snapshot', s.created_at IS NOT NULL,
    'snapshot_at', s.created_at,
    'depth', s.auto_depth,
    'conditions', jsonb_build_object('b1_class', s.b1_class, 'b1_win_gap', s.b1_win_gap, 'gap_band', s.gap_band,
                                     'venue_code', s.venue_code, 'top_boat', s.top_boat),
    'n_total', s.n_by_depth[s.auto_depth],
    'n_returned', jsonb_array_length(v_rows),
    'pool_from', s.pool_from, 'pool_cutoff', s.pool_cutoff,
    -- 行の race_id は並びを決めるためだけに使い、返さない（BOA-635 の列の合意）
    'rows', (SELECT coalesce(jsonb_agg(r - 'race_id'), '[]') FROM jsonb_array_elements(v_rows) AS r));
END;
$$;

-- ---------------------------------------------------------------
-- 10. 権限
-- ---------------------------------------------------------------
REVOKE ALL ON FUNCTION analogy_gap_band(numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION analogy_round_from_stage(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION analogy_round_from_kb(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION analogy_grade_of(text, smallint, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION analogy_motor_band(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION analogy_race_extras(varchar) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION analogy_optional_counts(smallint, text, smallint, smallint, smallint, date, text, text, smallint, boolean, boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION analogy_race_conditions(varchar) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION analogy_pool_rows_kb(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION analogy_pool_rows_main(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION refresh_analogy_pool(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION analogy_layer_counts(smallint, text, smallint, smallint, date, text, text, smallint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION analogy_auto_depth(integer[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION analogy_layer_distribution(smallint, text, smallint, smallint, smallint, date, text, text, smallint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION create_analogy_snapshots(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_analogy_similar(varchar, smallint, boolean, boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_analogy_similar_races(varchar) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION analogy_resolve_race(varchar) FROM PUBLIC, anon, authenticated;

-- 匿名: 画面の RPC と、その中で呼ぶ読み取りだけの関数（SECURITY INVOKER なので呼び出し側にも EXECUTE が要る）
GRANT EXECUTE ON FUNCTION get_analogy_similar(varchar, smallint, boolean, boolean, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_analogy_similar_races(varchar) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION analogy_resolve_race(varchar) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION analogy_gap_band(numeric) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION analogy_race_conditions(varchar) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION analogy_layer_counts(smallint, text, smallint, smallint, date, text, text, smallint) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION analogy_auto_depth(integer[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION analogy_round_from_stage(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION analogy_grade_of(text, smallint, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION analogy_motor_band(integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION analogy_race_extras(varchar) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION analogy_optional_counts(smallint, text, smallint, smallint, smallint, date, text, text, smallint, boolean, boolean, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION analogy_layer_distribution(smallint, text, smallint, smallint, smallint, date, text, text, smallint) TO anon, authenticated, service_role;
-- 書き込み: service_role だけ
GRANT EXECUTE ON FUNCTION analogy_pool_rows_kb(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION analogy_round_from_kb(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION analogy_pool_rows_main(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION refresh_analogy_pool(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION create_analogy_snapshots(date) TO service_role;
GRANT ALL ON analogy_pool_outcomes, analogy_snapshots TO service_role;

COMMIT;

-- ---------------------------------------------------------------
-- 確認（適用後、読み取りで）
-- ---------------------------------------------------------------
-- SELECT tablename, policyname FROM pg_policies WHERE tablename IN ('analogy_pool_outcomes', 'analogy_snapshots');  -- 2本
-- SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname LIKE '%analogy%' ORDER BY 1;
--   -- anon_exec が true: get_analogy_similar・get_analogy_similar_races・analogy_resolve_race・analogy_gap_band・
--   --   analogy_race_conditions・analogy_layer_counts・analogy_auto_depth・analogy_layer_distribution・
--   --   analogy_round_from_stage・analogy_grade_of・analogy_motor_band・analogy_race_extras・analogy_optional_counts の13本。
--   --   false: analogy_pool_rows_kb・analogy_pool_rows_main・analogy_round_from_kb・
--   --   refresh_analogy_pool・create_analogy_snapshots（と 118 の activate_analogy_model）
--
-- 元に戻す（緊急時のみ。データも消える）:
-- BEGIN;
-- DROP FUNCTION IF EXISTS get_analogy_similar_races(varchar);
-- DROP FUNCTION IF EXISTS get_analogy_similar(varchar, smallint, boolean, boolean, boolean);
-- DROP FUNCTION IF EXISTS analogy_resolve_race(varchar);
-- DROP FUNCTION IF EXISTS create_analogy_snapshots(date);
-- DROP FUNCTION IF EXISTS analogy_layer_distribution(smallint, text, smallint, smallint, smallint, date, text, text, smallint);
-- DROP FUNCTION IF EXISTS analogy_auto_depth(integer[]);
-- DROP FUNCTION IF EXISTS analogy_layer_counts(smallint, text, smallint, smallint, date, text, text, smallint);
-- DROP FUNCTION IF EXISTS refresh_analogy_pool(date, date);
-- DROP FUNCTION IF EXISTS analogy_pool_rows_main(date, date);
-- DROP FUNCTION IF EXISTS analogy_pool_rows_kb(date, date);
-- DROP FUNCTION IF EXISTS analogy_optional_counts(smallint, text, smallint, smallint, smallint, date, text, text, smallint, boolean, boolean, boolean);
-- DROP FUNCTION IF EXISTS analogy_race_extras(varchar);
-- DROP FUNCTION IF EXISTS analogy_race_conditions(varchar);
-- DROP TABLE IF EXISTS analogy_snapshots;
-- DROP TABLE IF EXISTS analogy_pool_outcomes;
-- DROP FUNCTION IF EXISTS analogy_gap_band(numeric);
-- DROP FUNCTION IF EXISTS analogy_motor_band(integer);
-- DROP FUNCTION IF EXISTS analogy_grade_of(text, smallint, date);
-- DROP FUNCTION IF EXISTS analogy_round_from_kb(text, text);
-- DROP FUNCTION IF EXISTS analogy_round_from_stage(text);
-- COMMIT;
