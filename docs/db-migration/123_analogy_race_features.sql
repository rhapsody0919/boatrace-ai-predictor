-- 123: レースごとの寄与度（B）の特徴量の表（BOA-271）
-- 対応spec/plan: docs/design/analogy-finder/plan.md（「学習側の設計」）、docs/adr/0083-per-race-contribution-treeshap-in-js.md
--
-- 背景: レースごとの寄与度は、Vercel の JS が TreeSHAP で計算する（出走表時点の段と展示後の段、ADR-0083）。選手の過去30走の
--   ST・成績などの36特徴量は Python（scripts/ml/analogy/features.py）でしか作れないので、日次の特徴量ジョブ
--   （GitHub Actions、JST 6:40・9:40・13:40）が今日のレースの36列をこの表に書き、JS が読む。
--   36列は「朝 6:40 に分かる値」で定義する（節の日目・最終日は race_series から、体重・支部は前日まで、2連率は toFixed(1)）。
--
-- テーブル
--   analogy_race_features  レース×艇の36特徴量（features の並びは per_race_meta.json の models.win_racecard.feature_names）
--
-- 監視の関数（data-health）は 124 に分けた（data-health の関数のマイグレーションには anon への GRANT を置かない規律のため）
--
-- 書き込み: service_role（日次の特徴量ジョブ scripts/ml/analogy/daily_features.py）。締切前で、input_hash（model_version と
--   36列から作る）が変わったときだけ上書きする。発走後は書かない。匿名（anon）は SELECT だけ（推論側の Vercel 関数が読む）。
--
-- 行数: 1日 約150R×6艇＝約900行、1行 約250B（features は real[36]）。年 約0.08GB。行は消さない
--
-- ⚠️ 本番へ未適用。適用はユーザーが行う。
-- 適用の順序: この SQL → 124 → 日次の特徴量ジョブを有効にする。data-health の監視は、表が空の間は「未導入」と扱う。

BEGIN;

CREATE TABLE IF NOT EXISTS analogy_race_features (
  race_id       text NOT NULL REFERENCES races(race_id) ON DELETE CASCADE,
  boat_number   smallint NOT NULL CHECK (boat_number BETWEEN 1 AND 6),
  model_version text NOT NULL,          -- 符号化（支部の対応表）と列の並びを決めた版。推論側はこの版のモデルで計算する
  features      real[] NOT NULL CHECK (cardinality(features) = 36),
  input_hash    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz,            -- 上書きした時刻（欠場・選手の差し替え・版の切り替え）。最初の書き込みでは NULL
  PRIMARY KEY (race_id, boat_number)
);

ALTER TABLE public.analogy_race_features ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS analogy_race_features_public_read ON public.analogy_race_features;
CREATE POLICY analogy_race_features_public_read ON public.analogy_race_features FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.analogy_race_features TO anon, authenticated;

COMMENT ON TABLE public.analogy_race_features IS 'BOA-271 B レースごとの寄与度の36特徴量（出走表時点）。日次の特徴量ジョブが書き、Vercel の JS が TreeSHAP に使う';


COMMIT;

-- 確認（読み取り）:
--   select relrowsecurity from pg_class where relname = 'analogy_race_features';                  -- t
--   select policyname, cmd, roles from pg_policies where tablename = 'analogy_race_features';    -- public_read・SELECT・{anon,authenticated}
--   select grantee, privilege_type from information_schema.role_table_grants
--     where table_name = 'analogy_race_features' and grantee in ('anon','authenticated');        -- SELECT だけ
