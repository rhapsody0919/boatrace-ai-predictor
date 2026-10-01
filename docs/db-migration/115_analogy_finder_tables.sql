-- 115: アナロジー・ファインダー（寄与度・類似レース）と時点付きスナップショットのテーブル（BOA-271・BOA-627）
-- 対応spec/plan: docs/design/analogy-finder/plan.md
--
-- 背景: BOA-271 は、新しい主モデル（艇単位の着順モデル）の SHAP を条件ごとに集計した「寄与度」（FR-1）と、
--   今日のレースに近い過去のレース800件の決着（FR-2・FR-3）を AI予想タブに出す。近傍は GitHub Actions の
--   バッチで事前計算し（ADR-0080）、表示したものを時点固定で残す（BOA-627）。
--   近傍の as-of は「出走表時点（前日までの成績）」の1段だけ使う（設計レビュー 2026-10-01 で直前情報時点の段を外した）。
--   asof_stage 列は時点の定義を記録するために残す。
--
-- テーブル
--   analogy_models                 学習したモデルの版。テーマの一覧（可変）とメトリクスを持つ。表示に使うのは is_active の1行
--   analogy_contribution_profiles  条件スライスごとのテーマ別シェア（FR-1）
--   analogy_pool_outcomes          近傍の母集団（2019-04〜）の決着。長期（kb_archive）と本体の両方を同じ形にそろえる
--   analogy_snapshots              今日のレースの as-of 特徴量と近傍800件（BOA-627 の1・2）
--
-- 関数
--   get_analogy_neighbors(p_race_id, p_stage)  近傍800件を決着つきで返す（AI予想タブと BOA-635 が使う）
--   activate_analogy_model(p_model_version)     表示に使う版を1トランザクションで入れ替える（service_role のみ）
--
-- 書き込み: すべて service_role（GitHub Actions の train-analogy.yml / generate-analogy-neighbors.yml）。
--   匿名（anon）は SELECT と上の関数の EXECUTE だけ。113 で関数の既定権限を剥奪したので、EXECUTE は明示的に付ける。
--
-- ⚠️ 本番へ未適用。適用はユーザーの承認後に、ユーザーが実行する（Phase U の着手後。spec「実装開始の前提条件」）。
-- 適用の順序: この SQL を本番へ適用 → train-analogy.yml を1回手動実行（モデル・寄与度・母集団を書く）
--   → 近傍の起動（Vercel Cron → workflow_dispatch）を有効化 → 画面の PR をマージ。
--   画面は analogy_models に is_active の行が無い／スナップショットが無いとき節ごと出さないので、順番がずれても壊れない。

BEGIN;

-- ---------------------------------------------------------------
-- 1. モデルの版
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analogy_models (
  model_version   text PRIMARY KEY,                 -- 例: '2026-10-05'（学習日）
  trained_at      timestamptz NOT NULL,
  pool_cutoff     date NOT NULL,                    -- 近傍の母集団に入れたレースの最終日
  feature_columns text[] NOT NULL,                  -- 距離と SHAP に使った特徴量（as-of の段つきの名前）
  themes          jsonb NOT NULL,                   -- [{key,name,description,features:[...]}]。テーマ数は可変（spec FR-1）
  neighbor_k      smallint NOT NULL DEFAULT 800,
  venue_penalty   real NOT NULL,                    -- 会場が違うときに距離へ足す値（MD-6 の λ）
  metrics         jsonb NOT NULL,                   -- 対数損失・基準・品質ゲートの判定
  is_active       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analogy_models_themes_is_array CHECK (jsonb_typeof(themes) = 'array')
);
CREATE UNIQUE INDEX IF NOT EXISTS analogy_models_one_active
  ON public.analogy_models (is_active) WHERE is_active;

-- ---------------------------------------------------------------
-- 2. 寄与度（FR-1）
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analogy_contribution_profiles (
  model_version text NOT NULL REFERENCES analogy_models(model_version) ON DELETE CASCADE,
  finish_target smallint NOT NULL CHECK (finish_target IN (1, 2, 3)),   -- 1着／2着以内／3着以内
  venue_code    smallint NOT NULL CHECK (venue_code BETWEEN 0 AND 24),  -- 0 = 全会場
  grade         text NOT NULL CHECK (grade IN ('all', 'ippan', 'G3', 'G2', 'G1', 'SG')),
  round         text NOT NULL CHECK (round IN ('all', 'yosen', 'junyu', 'yusho', 'other')),
  boat_number   smallint NOT NULL CHECK (boat_number BETWEEN 0 AND 6),  -- 0 = 全艇
  n_boats       integer NOT NULL,
  n_races       integer NOT NULL,
  period_from   date NOT NULL,
  period_to     date NOT NULL,
  shares        jsonb NOT NULL,   -- {theme_key: share}。合計1
  share_sd      jsonb,            -- {theme_key: SD}（seed を変えた再学習のばらつき）
  breakdown     jsonb,            -- {theme_key: [{feature, label, share}]}（テーマ内の内訳）
  PRIMARY KEY (model_version, finish_target, venue_code, grade, round, boat_number)
);

-- ---------------------------------------------------------------
-- 3. 近傍の母集団の決着
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analogy_pool_outcomes (
  race_id           varchar PRIMARY KEY,           -- races.race_id と同じ形 'YYYY-MM-DD-VV-RR'（長期分は races に行が無いので外部キーにしない）
                                                   -- 入れないレース: 不成立、および1〜3着に返還艇（F・L・欠）が入るレース（本体の rank は返還艇も公式の並びのまま入るため。
                                                   --   例 2026-03-02-24-09 は F の1号艇が rank3）。判定は race_status に加えて race_start_timings.is_flying・is_late_start・finish_mark
                                                   --   （race_status は 2026-09-20 より前でほぼ NULL）。母集団の特徴量行列からも同じレースを外し、集合を一致させる
  race_date         date NOT NULL,
  venue_code        smallint NOT NULL,
  race_number       smallint NOT NULL,
  grade             text,                          -- 'ippan'|'G3'|'G2'|'G1'|'SG'|NULL（長期の約1割は不明。BOA-651）
  round             text,                          -- 'yosen'|'junyu'|'yusho'|'other'|NULL
  rank1             smallint NOT NULL,
  rank2             smallint NOT NULL,
  rank3             smallint NOT NULL,
  winning_technique text NOT NULL,                 -- 6分類
  winner_course     smallint,                      -- 1着艇の進入コース
  course_by_boat    smallint[],                    -- [1号艇のコース, ..., 6号艇のコース]。実進入が分からない艇は NULL（艇番で埋めない。BOA-523 の欠落期間で枠なりに化けるため）
  st_by_course      numeric(4,2)[],                -- [1コースのST, ..., 6コースのST]（BOA-635 のスリットの判定に使う）。フライング・出遅れ・欠場のコースは NULL
                                                   --   （数値のままだと F の艇が「速い ST」に見える。本体は race_start_timings.is_flying・is_late_start、長期は kb_archive_boats.is_flying・is_late_start で判定）
  payout_3tan       integer,                       -- 3連単の払戻（円）。列名は kb_archive_races.payout_3tan と同じ。
                                                   --   ⚠️ race_results は列名と券種が逆（payout_trio＝3連単、payout_trifecta＝3連複。111 のコメント参照）。本体から作るときは payout_trio を入れる
                                                   --   不成立・特払いのレース（race_results.race_status）は NULL（不成立の ¥100 を入れない）
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analogy_pool_outcomes_date ON public.analogy_pool_outcomes (race_date);

-- ---------------------------------------------------------------
-- 4. 時点付きスナップショット（BOA-627）
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analogy_snapshots (
  snapshot_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  race_id            varchar NOT NULL REFERENCES races(race_id) ON DELETE CASCADE,
  model_version      text NOT NULL REFERENCES analogy_models(model_version),  -- analogy_models の行は消さない運用（1版1行で小さい）。消すのは寄与度の古い版の行だけ
  asof_stage         text NOT NULL CHECK (asof_stage IN ('racecard', 'exhibition')),  -- 出走表時点／直前情報時点
  asof_at            timestamptz NOT NULL,          -- 使ったデータのうち最も新しい取得時刻
  computed_at        timestamptz NOT NULL DEFAULT now(),
  features           jsonb NOT NULL,                -- as-of 特徴量（6艇分＋レース共通。距離の入力そのもの）
  neighbor_ids       varchar[],                     -- 近い順（analogy_pool_outcomes.race_id）
  neighbor_distances real[],                        -- 上と同じ順の距離
  CONSTRAINT analogy_snapshots_one_per_stage UNIQUE (race_id, asof_stage),  -- 版をまたいで1レース1つ（同じ日のうちに週次の新しい版で近傍が入れ替わらないように）。書き込みは ON CONFLICT DO NOTHING
  CONSTRAINT analogy_snapshots_same_length CHECK (
    (neighbor_ids IS NULL AND neighbor_distances IS NULL)
    OR cardinality(neighbor_ids) = cardinality(neighbor_distances)
  )
);
CREATE INDEX IF NOT EXISTS analogy_snapshots_race ON public.analogy_snapshots (race_id, computed_at DESC);

-- ---------------------------------------------------------------
-- 5. 近傍を決着つきで返す
--    p_stage が NULL なら、直前情報時点があればそれを、無ければ出走表時点を返す。
--    発走後も同じスナップショットを返す（発走後に作り直さない。バッチ側で締切後は書かない）
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_analogy_neighbors(p_race_id varchar, p_stage text DEFAULT NULL)
RETURNS TABLE (
  neighbor_rank     integer,
  race_id           varchar,
  distance          real,
  race_date         date,
  venue_code        smallint,
  race_number       smallint,
  rank1             smallint,
  rank2             smallint,
  rank3             smallint,
  winning_technique text,
  winner_course     smallint,
  course_by_boat    smallint[],
  st_by_course      numeric(4,2)[],
  payout_3tan       integer,
  model_version     text,
  asof_stage        text,
  asof_at           timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
SET statement_timeout = '5s'
AS $$
  WITH s AS (
    SELECT sn.*
    FROM public.analogy_snapshots sn
    JOIN public.analogy_models m ON m.model_version = sn.model_version
    WHERE sn.race_id = p_race_id
      AND (p_stage IS NULL OR sn.asof_stage = p_stage)
      AND sn.neighbor_ids IS NOT NULL
    ORDER BY (sn.asof_stage = 'exhibition') DESC, sn.computed_at DESC
    LIMIT 1
  )
  SELECT u.ord::integer, u.nid::varchar, u.dist, o.race_date, o.venue_code, o.race_number,
         o.rank1, o.rank2, o.rank3, o.winning_technique, o.winner_course,
         o.course_by_boat, o.st_by_course, o.payout_3tan,
         s.model_version, s.asof_stage, s.asof_at
  FROM s
  CROSS JOIN LATERAL unnest(s.neighbor_ids, s.neighbor_distances) WITH ORDINALITY AS u(nid, dist, ord)
  LEFT JOIN public.analogy_pool_outcomes o ON o.race_id = u.nid  -- 母集団と決着の集合がずれても順位を黙って詰めない（verify で一致を検査する）
  ORDER BY u.ord;
$$;

REVOKE ALL ON FUNCTION public.get_analogy_neighbors(varchar, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_analogy_neighbors(varchar, text) TO anon, authenticated, service_role;

-- 表示に使う版の入れ替え。旧版を false → 新版を true を1トランザクションで行い、is_active が0件になる瞬間を作らない
CREATE OR REPLACE FUNCTION public.activate_analogy_model(p_model_version text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.analogy_models WHERE model_version = p_model_version) THEN
    RAISE EXCEPTION 'analogy_models に版 % がありません', p_model_version;
  END IF;
  UPDATE public.analogy_models SET is_active = false WHERE is_active AND model_version <> p_model_version;
  UPDATE public.analogy_models SET is_active = true WHERE model_version = p_model_version;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_analogy_model(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_analogy_model(text) TO service_role;

-- ---------------------------------------------------------------
-- 6. RLS（匿名は SELECT のみ。書き込みは service_role）
-- ---------------------------------------------------------------
ALTER TABLE public.analogy_models ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS analogy_models_public_read ON public.analogy_models;
CREATE POLICY analogy_models_public_read ON public.analogy_models FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.analogy_models TO anon, authenticated;

ALTER TABLE public.analogy_contribution_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS analogy_contribution_profiles_public_read ON public.analogy_contribution_profiles;
CREATE POLICY analogy_contribution_profiles_public_read ON public.analogy_contribution_profiles FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.analogy_contribution_profiles TO anon, authenticated;

ALTER TABLE public.analogy_pool_outcomes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS analogy_pool_outcomes_public_read ON public.analogy_pool_outcomes;
CREATE POLICY analogy_pool_outcomes_public_read ON public.analogy_pool_outcomes FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.analogy_pool_outcomes TO anon, authenticated;

ALTER TABLE public.analogy_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS analogy_snapshots_public_read ON public.analogy_snapshots;
CREATE POLICY analogy_snapshots_public_read ON public.analogy_snapshots FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.analogy_snapshots TO anon, authenticated;

COMMENT ON TABLE public.analogy_models IS 'BOA-271 アナロジー・ファインダーの主モデルの版。themes はテーマの一覧（可変）';
COMMENT ON TABLE public.analogy_contribution_profiles IS 'BOA-271 FR-1 条件スライスごとのテーマ別シェア（平均|SHAP|の比）';
COMMENT ON TABLE public.analogy_pool_outcomes IS 'BOA-271 類似レースの母集団（2019-04〜）の決着。長期と本体をそろえた形';
COMMENT ON TABLE public.analogy_snapshots IS 'BOA-627 時点付きスナップショット。as-of 特徴量と近傍（近い順）。発走後は書き換えない';

COMMIT;
