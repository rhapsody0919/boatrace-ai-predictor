-- 132: analogy_contribution_profiles に段（stage）と枠の構成比（frame_ratio）を足す（BOA-271 AIの見立て）
-- 対応spec/plan: docs/design/analogy-finder/plan.md（#1134）「寄与度用モデルの集計」4・「既存の表・マイグレーションの扱い」
--
-- 背景: AIの見立て（spec FR-E）は、展示後のモデル（win・top2・top3）の集計に加えて、展示前に出走表時点のモデル
--   （win_racecard・top2_racecard・top3_racecard）の集計も出す。同じ版の中に2段の行を持つため、列 stage を足し、
--   主キーに含める。版名で段を分ける案は、analogy_models の is_active の切り替え（1版を1回で入れ替える）と
--   噛み合わないので採らない。
--
-- frame_ratio: 枠（boat_number）の SHAP は割合から除くが、その大きさを7テーマの大きさの和に対する比で残す。
--   画面の1号艇の注記「枠の有利さと選手の格がまざる分（約15%）」の数字（spec FR-E）。既存の行は NULL。
--
-- 既存の行（版 2026-10-02 の 12,180 行）は DEFAULT で 'exhibition' になる。
-- 読み手（api/analogy/contribution.js・src/services/analogyService.js・src/utils/analogyContribution.js）は
--   stage の条件を付けて読み、書き手（scripts/ml/analogy/db.py）は stage を書く。
--
-- ⚠️ 本番へ未適用。適用はユーザーが行う（docs/db-migration/132-runbook.md）。
-- 適用の順序: この SQL を本番へ適用 → stage を読み書きするコードのマージ → train-analogy.yml を1回手動実行。
--   コードを先にマージすると、読み手の stage=eq.… が「列が無い」で失敗し、学習の書き込みも失敗する。

BEGIN;

ALTER TABLE public.analogy_contribution_profiles
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'exhibition';

ALTER TABLE public.analogy_contribution_profiles
  DROP CONSTRAINT IF EXISTS analogy_contribution_profiles_stage_check;
ALTER TABLE public.analogy_contribution_profiles
  ADD CONSTRAINT analogy_contribution_profiles_stage_check
  CHECK (stage IN ('exhibition', 'racecard'));

ALTER TABLE public.analogy_contribution_profiles
  ADD COLUMN IF NOT EXISTS frame_ratio double precision;

-- 主キーを stage を含む形に作り直す（同じ版・同じスライスに2段の行を置くため）
ALTER TABLE public.analogy_contribution_profiles
  DROP CONSTRAINT IF EXISTS analogy_contribution_profiles_pkey;
ALTER TABLE public.analogy_contribution_profiles
  ADD CONSTRAINT analogy_contribution_profiles_pkey
  PRIMARY KEY (model_version, stage, finish_target, venue_code, grade, round, boat_number);

COMMENT ON COLUMN public.analogy_contribution_profiles.stage IS
  'BOA-271 段。exhibition＝展示後のモデル（直前情報あり）、racecard＝出走表時点のモデル（直前情報なし）';

COMMENT ON COLUMN public.analogy_contribution_profiles.frame_ratio IS
  'BOA-271 枠（boat_number）の SHAP の大きさ ÷ テーマの大きさの和（割合から除いた枠の分。同じ二重の中心化）';

COMMIT;
