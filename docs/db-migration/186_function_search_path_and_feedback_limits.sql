-- 186: public の関数19本の search_path を固定し、analogy_feedback に全体の流量の制限と races の削除での連鎖を足す
--   （セキュリティの評価 2026-10-27、system-architect の打ち手 M・L）
--
-- M（search_path）:
--   Supabase の advisor（security）の function_search_path_mutable が出ている19関数に
--   `ALTER FUNCTION ... SET search_path = public, pg_temp` を足す。本文（prosrc）は変えない。
--   19本は本番の pg_proc から取った（2026-10-27、claude_ro。public・plpgsql/sql・proconfig に search_path が無い・拡張の所有でない）。
--   本文が extensions の関数（uuid_generate_*・digest・gen_random_bytes・crypt 等）を呼ぶものは無いので extensions は入れない
--   （gen_random_uuid・now 等は pg_catalog で、search_path に書かなくても先に探される）。
--   pg_temp を最後に置くのは、一時スキーマの同名の表・関数が public より先に解決されないようにするため。
--   LANGUAGE sql の10本（get_race_* の4本・get_latest_racer_grades・compute_* の5本）は SET を付けるとインライン展開されなくなる。
--   10本とも PostgREST から直に呼ぶ RPC かバッチが呼ぶ集計で、他の関数・ビューの中から呼ばれていない
--   （本番の prosrc と pg_views を検索、2026-10-27）ので、計画の変化は無視できる。
--   トリガーの関数（update_updated_at_column は venue_rules・rule_applications（storage.objects のは storage. の別の関数）、update_prediction_results は
--   race_results、trg_external_predictions_updated_at は external_predictions）の本文は NEW の列と public の表だけを使う。
--
-- L（analogy_feedback）:
--   (1) 全体の流量の制限を足す。今のトリガー（143）は「同じ client_key で24時間に40行」「全体で1時間に300行」。
--       client_key はブラウザの乱数なので、毎回変えれば1つめは効かず、全体は1日に7,200行まで入る。
--       本番の実績（2026-10-09〜10-26 の14行）: 10分の最大2行・1日の最大5行・8ブラウザ・1ブラウザ最大3行。
--       1回の回答は最大2行（vote・detail）。そこで次の2つに置き換える（1時間300行はこの2つより緩いので外す）:
--         全体で直近10分に30行 … 実績の最大の15倍。X の投稿などで15人が10分に2段目まで答えても通る
--         全体で直近24時間に300行 … 実績の最大の60倍。荒らしが入っても、hq の週のまとめに混ざるのは1日300行まで
--       数える前に pg_advisory_xact_lock で INSERT を1本ずつにする（同時の INSERT が互いの行を見ずに上限を越えないように。
--       流量は1日数行なので待ちは生じない）。超えたときは今と同じ P0001 で、画面は「送れませんでした」になる。
--   (2) races への外部キーを ON DELETE CASCADE にする。races を参照する外部キー21本のうち、NO ACTION は
--       analogy_feedback_race_id_fkey と sns_campaign_entries_race_id_fkey の2本だけ（2026-10-27、pg_constraint）。
--       NO ACTION のままだと、声が1行でもあるレースは races の削除が失敗し、他の19本は消える前提の処理が止まる。
--       声は匿名で、レースが消えれば読む意味も無い。sns_campaign_entries はこのマイグレーションの範囲外（別に判断する）。
--       制約は DROP して同じ名前で付け直す（1つのトランザクションの中。付け直しの検査は14行なので一瞬）。
--
-- コードは変えない（画面の送信 src/services/analogyFeedback.js はこのままで、制限に当たったときの応答も今と同じ）。
-- 発走中でも当ててよい（表の行は変えない。外部キーの付け直しは COMMIT まで analogy_feedback と races に SHARE ROW EXCLUSIVE を持つので、その間 races の書き込みは待つ。19本の ALTER FUNCTION と合わせて1秒未満の見込み）。
-- db-apply で当てる（関数・ALTER を含むので heavy の判定。オーナーの承認つきの経路）。
--
-- 適用前の確認（読み取り。19本の本文の md5 と、search_path が未設定であること）:
--   SELECT p.oid::regprocedure AS sig, md5(p.prosrc) AS md5, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('compute_nige_second_by_course','compute_racer_course_technique_stats','compute_st_course_baseline','compute_venue_course_entry_baseline','compute_venue_course_technique_baseline','get_accuracy_summary','get_latest_racer_grades','get_predictions_by_date','get_predictions_by_date_light','get_race_exhibition_trend','get_race_history_summary','get_race_return_rate','get_race_st_predictability','get_race_technique_profile','get_today_races','trg_external_predictions_updated_at','update_prediction_results','update_updated_at_column','update_venue_stats') ORDER BY 1;
--   期待: 19行、proconfig はすべて NULL。md5 は PR 本文の表と一致（2026-10-27 の本番）
--   SELECT conname, confdeltype FROM pg_constraint WHERE conrelid = 'public.analogy_feedback'::regclass AND contype = 'f';
--   期待: analogy_feedback_race_id_fkey | a
--   SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.analogy_feedback_guard()'::regprocedure;
--   期待: 143 の本文の md5（PR 本文に記載）
-- 適用後の確認（読み取り）:
--   SELECT p.oid::regprocedure AS sig, md5(p.prosrc) AS md5, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('compute_nige_second_by_course','compute_racer_course_technique_stats','compute_st_course_baseline','compute_venue_course_entry_baseline','compute_venue_course_technique_baseline','get_accuracy_summary','get_latest_racer_grades','get_predictions_by_date','get_predictions_by_date_light','get_race_exhibition_trend','get_race_history_summary','get_race_return_rate','get_race_st_predictability','get_race_technique_profile','get_today_races','trg_external_predictions_updated_at','update_prediction_results','update_updated_at_column','update_venue_stats') ORDER BY 1;
--   期待: 19行、proconfig はすべて {"search_path=public, pg_temp"}、md5 は適用前と同じ
--   SELECT conname, confdeltype, convalidated FROM pg_constraint WHERE conrelid = 'public.analogy_feedback'::regclass AND contype = 'f';
--   期待: analogy_feedback_race_id_fkey | c | true の1行だけ
--   SELECT position('10 minutes' IN prosrc) > 0 AS has_10min, position('pg_advisory_xact_lock' IN prosrc) > 0 AS has_lock, proconfig FROM pg_proc WHERE oid = 'public.analogy_feedback_guard()'::regprocedure;
--   期待: true | true | {"search_path=public, pg_temp"}
--   Supabase の advisor（security）で function_search_path_mutable が0件
--
-- 戻し方: 末尾の ROLLBACK-BEGIN〜ROLLBACK-END（search_path を外す・143 のトリガーの本文に戻す・外部キーを NO ACTION に戻す）
--
-- 検証: node scripts/maintenance/verify-function-search-path-migration.js（PGlite、本番には接続しない）

BEGIN;

-- M: 19関数の search_path（本文は変えない）
ALTER FUNCTION public.compute_nige_second_by_course() SET search_path = public, pg_temp;
ALTER FUNCTION public.compute_racer_course_technique_stats() SET search_path = public, pg_temp;
ALTER FUNCTION public.compute_st_course_baseline() SET search_path = public, pg_temp;
ALTER FUNCTION public.compute_venue_course_entry_baseline(smallint, date) SET search_path = public, pg_temp;
ALTER FUNCTION public.compute_venue_course_technique_baseline() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_accuracy_summary() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_latest_racer_grades() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_predictions_by_date(date) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_predictions_by_date_light(date) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_race_exhibition_trend(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_race_history_summary(integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_race_return_rate(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_race_st_predictability(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_race_technique_profile(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_today_races() SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_external_predictions_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_prediction_results() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_venue_stats() SET search_path = public, pg_temp;

-- L(1): 全体の流量の制限（143 の本文に10分・24時間の全体の上限を足し、1時間300行を外す）
CREATE OR REPLACE FUNCTION public.analogy_feedback_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.created_at := now();
  -- 同時の INSERT が互いの行を見ずに上限を越えないよう、数える前に1本ずつにする（トランザクションの終わりで外れる）
  PERFORM pg_advisory_xact_lock(hashtext('public.analogy_feedback_guard'));
  IF (SELECT count(*) FROM public.analogy_feedback
      WHERE client_key = NEW.client_key
        AND created_at > now() - interval '24 hours') >= 40 THEN
    RAISE EXCEPTION 'analogy_feedback: too many from this client' USING ERRCODE = 'P0001';
  END IF;
  -- 全体の上限（186）。実績は10分の最大2行・1日の最大5行（2026-10-09〜10-26 の14行）。根拠はファイルの冒頭
  IF (SELECT count(*) FROM public.analogy_feedback
      WHERE created_at > now() - interval '10 minutes') >= 30 THEN
    RAISE EXCEPTION 'analogy_feedback: too many overall' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.analogy_feedback
      WHERE created_at > now() - interval '24 hours') >= 300 THEN
    RAISE EXCEPTION 'analogy_feedback: too many overall' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.analogy_feedback_guard() FROM PUBLIC;

-- L(2): races の削除で声も消す（NO ACTION → CASCADE）。付け直しの検査は14行なので一瞬
ALTER TABLE public.analogy_feedback DROP CONSTRAINT IF EXISTS analogy_feedback_race_id_fkey;
ALTER TABLE public.analogy_feedback
  ADD CONSTRAINT analogy_feedback_race_id_fkey
  FOREIGN KEY (race_id) REFERENCES public.races (race_id) ON DELETE CASCADE;

COMMIT;

-- 戻し方（search_path を外し、143 のトリガーの本文と NO ACTION の外部キーに戻す）:
-- ROLLBACK-BEGIN
-- BEGIN;
-- ALTER FUNCTION public.compute_nige_second_by_course() RESET search_path;
-- ALTER FUNCTION public.compute_racer_course_technique_stats() RESET search_path;
-- ALTER FUNCTION public.compute_st_course_baseline() RESET search_path;
-- ALTER FUNCTION public.compute_venue_course_entry_baseline(smallint, date) RESET search_path;
-- ALTER FUNCTION public.compute_venue_course_technique_baseline() RESET search_path;
-- ALTER FUNCTION public.get_accuracy_summary() RESET search_path;
-- ALTER FUNCTION public.get_latest_racer_grades() RESET search_path;
-- ALTER FUNCTION public.get_predictions_by_date(date) RESET search_path;
-- ALTER FUNCTION public.get_predictions_by_date_light(date) RESET search_path;
-- ALTER FUNCTION public.get_race_exhibition_trend(text) RESET search_path;
-- ALTER FUNCTION public.get_race_history_summary(integer) RESET search_path;
-- ALTER FUNCTION public.get_race_return_rate(text) RESET search_path;
-- ALTER FUNCTION public.get_race_st_predictability(text) RESET search_path;
-- ALTER FUNCTION public.get_race_technique_profile(text) RESET search_path;
-- ALTER FUNCTION public.get_today_races() RESET search_path;
-- ALTER FUNCTION public.trg_external_predictions_updated_at() RESET search_path;
-- ALTER FUNCTION public.update_prediction_results() RESET search_path;
-- ALTER FUNCTION public.update_updated_at_column() RESET search_path;
-- ALTER FUNCTION public.update_venue_stats() RESET search_path;
-- CREATE OR REPLACE FUNCTION public.analogy_feedback_guard()
-- RETURNS trigger
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public, pg_temp
-- AS $$
-- BEGIN
--   NEW.created_at := now();
--   IF (SELECT count(*) FROM public.analogy_feedback
--       WHERE client_key = NEW.client_key
--         AND created_at > now() - interval '24 hours') >= 40 THEN
--     RAISE EXCEPTION 'analogy_feedback: too many from this client' USING ERRCODE = 'P0001';
--   END IF;
--   IF (SELECT count(*) FROM public.analogy_feedback
--       WHERE created_at > now() - interval '1 hour') >= 300 THEN
--     RAISE EXCEPTION 'analogy_feedback: too many overall' USING ERRCODE = 'P0001';
--   END IF;
--   RETURN NEW;
-- END;
-- $$;
-- REVOKE ALL ON FUNCTION public.analogy_feedback_guard() FROM PUBLIC;
-- ALTER TABLE public.analogy_feedback DROP CONSTRAINT IF EXISTS analogy_feedback_race_id_fkey;
-- ALTER TABLE public.analogy_feedback
--   ADD CONSTRAINT analogy_feedback_race_id_fkey
--   FOREIGN KEY (race_id) REFERENCES public.races (race_id);
-- COMMIT;
-- ROLLBACK-END
