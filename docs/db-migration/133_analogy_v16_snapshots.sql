-- 133: アナロジー・ファインダー v16 のスナップショットの台帳 analogy_v16_snapshots（BOA-271 T3-1）
-- 対応spec/plan: docs/design/analogy-finder/plan.md「DB」「朝のバッチ」「展示後の段」
--
-- 背景: v16 は、朝のバッチ（GitHub Actions の scripts/ml/analogy/v16_morning.py）が今日の各レースの
--   facts・similar・scenario・layer を Storage の非公開のバケット analogy-v16 の `{日付}/{実行ID}/` に書き、
--   展示後に Vercel の JS（api/cron/analogy-v16-exhibition.js）が類似レースを並べ直して同じバケットに書く。
--   この表は「どのレースのどの時点の数字が、どの実行のファイルか」を指す。API はこの表で run_id を引き、
--   Storage の gzip を読む。実行ごとに新しいパスに書き、ファイルは上書きしないので、表示済みのレースの数字は
--   同じ日の後の実行で変わらない。マイグレーション 120（層別 S*）はこれで置き換えた（spec Q4）。
--
-- 列:
--   race_id        races の外部キー
--   stage          'racecard'（朝のバッチ、出走表の時点）／'exhibition'（展示後）
--   run_id         Storage のパス `{日付}/{run_id}/` の実行ID
--   computed_at    作った時刻（締切前に作れたかを夜の確認が数える）
--   pool_cutoff    母集団の最終日（前日）
--   model_version  類似レースの距離の重みに使った analogy_models の版
--   n_layer        そろえる条件の層の件数
--   status         'ok'／'empty_layer'（層が0件）／'absent'（欠場が分かった。exhibition の段で書く）
--   exact          展示後の並べ直しが厳密か（exhibition の段だけ。racecard は null）
--   racecard_hash  racecard の段: 出走表の内容のハッシュ。9:40・13:40 の回は、これが変わったレース（選手の差し替え）だけ
--                  作り直して上書きする（plan「朝のバッチ」の対象。plan の列の表に無かったので足した）
-- 主キー (race_id, stage)。exhibition は既にあれば書かない（ON CONFLICT DO NOTHING）。racecard はハッシュが
--   変わったときだけ上書き。どちらも締切前だけ書く（書き手が守る）。
--
-- 書き込み: service_role のみ（GitHub Actions の service key、Vercel の service key）。
-- 読み取り: API は service key で読む。匿名（anon）・authenticated は SELECT のみ（plan「DB」）。
-- 行数: 1日 約300行（約150レース × 2段）× 約200B。年に約11万行・約22MB。消さない（時点の記録）。
--
-- ⚠️ 本番へ未適用。適用はユーザーが行う。
-- 適用手順: Supabase Dashboard > SQL Editor で、このファイルの全文を実行する（BEGIN〜COMMIT を含む）。
--   新しい表を作るだけで、既存の表・読み手には触れない。朝のバッチの PR のマージより前に適用する
--   （未適用の間に朝のバッチが動くと、Storage に書いた後の snapshot の書き込みで失敗し、Slack に知らせる）。
-- 適用後の確認（読み取りのみ）:
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.analogy_v16_snapshots'::regclass;  → true
--   SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'analogy_v16_snapshots';
--     → analogy_v16_snapshots_select | SELECT | {anon,authenticated}
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--     WHERE table_name = 'analogy_v16_snapshots' AND grantee IN ('anon', 'authenticated');
--     → anon・authenticated の SELECT だけ
--
-- 検証: scripts/maintenance/verify-analogy-v16-snapshots-migration.js（PGlite、ci）

BEGIN;

CREATE TABLE IF NOT EXISTS public.analogy_v16_snapshots (
  race_id        varchar NOT NULL REFERENCES public.races(race_id) ON DELETE CASCADE,
  stage          text NOT NULL CHECK (stage IN ('racecard', 'exhibition')),
  run_id         text NOT NULL CHECK (run_id <> ''),
  computed_at    timestamptz NOT NULL DEFAULT now(),
  pool_cutoff    date NOT NULL,
  model_version  text,
  n_layer        integer NOT NULL CHECK (n_layer >= 0),
  status         text NOT NULL CHECK (status IN ('ok', 'empty_layer', 'absent')),
  exact          boolean,
  racecard_hash  text,
  PRIMARY KEY (race_id, stage),
  -- 欠場は展示後の段でだけ分かる。racecard の段は exact・欠場を持たず、ハッシュを持つ
  CONSTRAINT analogy_v16_snapshots_stage_fields CHECK (
    (stage = 'racecard' AND exact IS NULL AND status <> 'absent' AND racecard_hash IS NOT NULL)
    OR (stage = 'exhibition' AND racecard_hash IS NULL AND (status = 'absent' OR exact IS NOT NULL))
  )
);

-- 夜の確認が「前日の出力」を日付で数える
CREATE INDEX IF NOT EXISTS analogy_v16_snapshots_computed_at
  ON public.analogy_v16_snapshots (computed_at);

ALTER TABLE public.analogy_v16_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS analogy_v16_snapshots_select ON public.analogy_v16_snapshots;
CREATE POLICY analogy_v16_snapshots_select ON public.analogy_v16_snapshots
  FOR SELECT TO anon, authenticated USING (true);

-- 076 で新規テーブルの既定権限を剥奪しているので、読ませる権限を明示する（書き込みは付けない）
REVOKE ALL ON public.analogy_v16_snapshots FROM anon, authenticated;
GRANT SELECT ON public.analogy_v16_snapshots TO anon, authenticated;
GRANT ALL ON public.analogy_v16_snapshots TO service_role;

COMMIT;

-- ROLLBACK-BEGIN
-- DROP TABLE IF EXISTS public.analogy_v16_snapshots;
-- ROLLBACK-END
