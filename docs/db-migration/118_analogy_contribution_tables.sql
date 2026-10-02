-- 118: アナロジー・ファインダーの寄与度（FR-1）のテーブル（BOA-271）
-- 対応spec/plan: docs/design/analogy-finder/plan.md
--
-- 背景: BOA-271 は、新しい主モデル（艇単位の着順モデル）の SHAP を条件ごとに集計した「寄与度」（FR-1）と、
--   今日のレースに近い過去のレースの決着（FR-2・FR-3）を AI予想タブに出す。FR-2 の類似の定義を見直している間に
--   FR-1 を先に出すため、設計時のマイグレーション案 115（4テーブル＋RPC2本）から、寄与度に要る部分だけを切り出した
--   （2026-10-02 オーケストレーター合意）。
--   analogy_models からは FR-2 専用の列（pool_cutoff・neighbor_k・venue_penalty）を外した。FR-2 の定義が決まった時点で、
--   FR-2 のマイグレーションが ADD COLUMN IF NOT EXISTS で足す（寄与度だけの版にダミー値を入れないため）。
--
-- テーブル
--   analogy_models                 学習したモデルの版。テーマの一覧（可変）とメトリクスを持つ。表示に使うのは is_active の1行
--   analogy_contribution_profiles  条件スライスごとのテーマ別シェア（FR-1）
--
-- 関数
--   activate_analogy_model(p_model_version)  表示に使う版を1トランザクションで入れ替える（service_role のみ）
--
-- 書き込み: すべて service_role（GitHub Actions の train-analogy.yml → scripts/ml/analogy/db.py）。
--   匿名（anon）は SELECT だけ。
--
-- 行数: analogy_contribution_profiles は1版あたり最大 15,750 行（着順3 × 会場25 × グレード6 × ラウンド5 × 艇番7。
--   n が0のセルは書かない）× 約1.3KB。直近2版だけ残す（db.py）。analogy_models は週1行で、行は消さない。
--
-- ⚠️ 本番へ未適用。適用はユーザーが行う。
-- 適用の順序: この SQL を本番へ適用 → train-analogy.yml を1回手動実行（モデル・寄与度を書く）→ 画面の PR をマージ。
--   画面は is_active の版が無いとき寄与度を出さないので、順番がずれても壊れない。

BEGIN;

-- ---------------------------------------------------------------
-- 1. モデルの版
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analogy_models (
  model_version   text PRIMARY KEY,                 -- 例: '2026-10-05'（学習日、JST）
  trained_at      timestamptz NOT NULL,
  feature_columns text[] NOT NULL,                  -- SHAP に使った特徴量
  themes          jsonb NOT NULL,                   -- [{key,name,description,features:[...],groups:[{key,label}]}]。テーマ数は可変（spec FR-1）
  metrics         jsonb NOT NULL,                   -- 対数損失・基準・品質ゲートの判定・期間
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
  breakdown     jsonb,            -- {theme_key: [{key, share}]}（テーマ内の内訳。key は themes[].groups[].key）
  PRIMARY KEY (model_version, finish_target, venue_code, grade, round, boat_number)
);

-- ---------------------------------------------------------------
-- 3. 表示に使う版の入れ替え。旧版 false → 新版 true を1トランザクションで行い、is_active が0件になる瞬間を作らない
-- ---------------------------------------------------------------
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
-- 4. RLS（匿名は SELECT のみ。書き込みは service_role）
-- ---------------------------------------------------------------
ALTER TABLE public.analogy_models ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS analogy_models_public_read ON public.analogy_models;
CREATE POLICY analogy_models_public_read ON public.analogy_models FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.analogy_models TO anon, authenticated;

ALTER TABLE public.analogy_contribution_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS analogy_contribution_profiles_public_read ON public.analogy_contribution_profiles;
CREATE POLICY analogy_contribution_profiles_public_read ON public.analogy_contribution_profiles FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.analogy_contribution_profiles TO anon, authenticated;

COMMENT ON TABLE public.analogy_models IS 'BOA-271 アナロジー・ファインダーの主モデルの版。themes はテーマの一覧（可変）';
COMMENT ON TABLE public.analogy_contribution_profiles IS 'BOA-271 FR-1 条件スライスごとのテーマ別シェア（平均|SHAP|の比）';

COMMIT;
