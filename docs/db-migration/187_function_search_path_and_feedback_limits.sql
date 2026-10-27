-- 187: public の関数19本の search_path を固定し、analogy_feedback に全体の流量の制限と races の削除での連鎖を足す
--   （セキュリティの評価 2026-10-27、system-architect の打ち手 M・L）
--
-- M（search_path）:
--   Supabase の advisor（security）の function_search_path_mutable が出ている19関数に
--   `ALTER FUNCTION ... SET search_path = public, pg_temp` を足す。本文（prosrc）は変えない。
--   19本は本番の pg_proc から取った（2026-10-27、claude_ro。public・plpgsql/sql・proconfig に search_path が無い・拡張の所有でない）。
--   本文が extensions の関数（uuid_generate_*・digest・gen_random_bytes・crypt 等）を呼ぶものは無いので extensions は入れない
--   （gen_random_uuid・now 等は pg_catalog で、search_path に書かなくても先に探される）。
--   pg_temp を最後に置くのは、一時スキーマの同名の表・関数が public より先に解決されないようにするため。
--   LANGUAGE sql の関数は SET を付けるとインライン展開されなくなるが、候補は集合を返す5本（get_latest_racer_grades・
--   compute_venue_course_entry_baseline 以外の compute_* の4本）だけで、どれも呼び出しは全件の取得（バッチ）。他の関数・ビューの
--   中からは呼ばれていない（本番の prosrc と pg_views を検索、2026-10-27）。get_latest_racer_grades の本文はどのみち全体を走査する
--   （本番の EXPLAIN ANALYZE で 1.18s・1639行、system-architect の審査）ので、計画の変化は無視できる。
--   トリガーの関数（update_updated_at_column は venue_rules・rule_applications（storage.objects のは storage. の別の関数）、update_prediction_results は
--   race_results、trg_external_predictions_updated_at は external_predictions）の本文は NEW の列と public の表だけを使う。
--
-- L（analogy_feedback）:
--   (1) 全体の流量の制限を足す。今のトリガー（143）は「同じ client_key で24時間に40行」「全体で1時間に300行」。
--       client_key はブラウザの乱数なので、毎回変えれば1つめは効かず、全体は1日に7,200行まで入る。
--       本番の実績（2026-10-09〜10-26 の14行）: 10分の最大2行・1日の最大5行・8ブラウザ・1ブラウザ最大3行。
--       1回の回答は最大2行（vote・detail）。そこで「全体で1時間に300行」を「全体で直近10分に30行」に置き換える
--       （実績の最大の15倍。X の投稿などで15人が10分に2段目まで答えても通る。根拠は実績の倍数で、目安）。
--       荒らしの入る量は1時間180行・1日4,320行まで（今の1時間300行・1日7,200行から4割減）。
--       24時間の全体の上限（案の段の300行）は入れない: 荒らしが約100分で埋めると、正規の声も最大24時間「送れませんでした」になり、
--       弾いた回数はどこにも残らない（system-architect・/code-review の指摘）。10分の窓なら止まるのは最大10分で、荒らしの行は表に残るので
--       hq のまとめで見つけて service_role で消せる（声が黙って止まるより、行が残って気づける方を採る）
--       数える前に pg_advisory_xact_lock で INSERT を1本ずつにする（同時の INSERT が互いの行を見ずに上限を越えないように。
--       流量は1日数行なので待ちは生じない）。超えたときは今と同じ P0001 で、画面は「送れませんでした」になる。
--   (2) races への外部キーを ON DELETE CASCADE にする。races を参照する外部キー21本のうち、NO ACTION は
--       analogy_feedback_race_id_fkey と sns_campaign_entries_race_id_fkey の2本だけ（2026-10-27、pg_constraint）。
--       NO ACTION のままだと、声が1行でもあるレースは races の削除が失敗し、他の19本は消える前提の処理が止まる。
--       声は匿名で、レースが消えれば読む意味も無い。143 の「期限なしで保存」（2026-10-08 ユーザー決定）の例外は
--       races の削除だけ（コードに races を DELETE する経路は無く、手での運用のときだけ）。ON UPDATE は NO ACTION のまま。sns_campaign_entries はこのマイグレーションの範囲外（別に判断する）。
--       制約は DROP して同じ名前で付け直す（1つのトランザクションの中。付け直しの検査は14行なので一瞬）。
--
-- コードは変えない（画面の送信 src/services/analogyFeedback.js はこのままで、制限に当たったときの応答も今と同じ）。
-- 発走の無い夜間に当てる。外部キーの DROP CONSTRAINT は参照先の races にも ACCESS EXCLUSIVE を COMMIT まで取る（ADD は
--   SHARE ROW EXCLUSIVE。PGlite の pg_locks で実測、system-architect の審査）。その間は races を読む画面の RPC も並んで、anon の
--   statement_timeout（3秒）で落ちうる。そこで BEGIN の直後に lock_timeout を1秒にし、ロックが取れなければ全体が失敗して何も変わらない
--   （時間を置いて再実行する）。取れた後は19本の ALTER FUNCTION と合わせて1秒未満の見込み。
-- db-apply で当てる（関数・ALTER を含むので heavy の判定。オーナーの承認つきの経路）。
--
-- 適用前の確認（読み取り。19本の本文の md5 と、search_path が未設定であること）:
--   SELECT p.oid::regprocedure AS sig, md5(p.prosrc) AS md5, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('compute_nige_second_by_course','compute_racer_course_technique_stats','compute_st_course_baseline','compute_venue_course_entry_baseline','compute_venue_course_technique_baseline','get_accuracy_summary','get_latest_racer_grades','get_predictions_by_date','get_predictions_by_date_light','get_race_exhibition_trend','get_race_history_summary','get_race_return_rate','get_race_st_predictability','get_race_technique_profile','get_today_races','trg_external_predictions_updated_at','update_prediction_results','update_updated_at_column','update_venue_stats') ORDER BY 1;
--   期待: 19行、proconfig はすべて NULL。md5 は次（2026-10-27 の本番、claude_ro）:
--     compute_nige_second_by_course d8d74b1e19d920adf8a2705b0b06a6be、compute_racer_course_technique_stats 1326878b43067b711178bde03ed807e0、
--     compute_st_course_baseline f07759fe5e0ba144595ae8dfe3aeea44、compute_venue_course_entry_baseline fee75f84be79c53c3c3184b58640e4b6、
--     compute_venue_course_technique_baseline 9bef6bfcf979b8ffaa452da0d3e30530、get_accuracy_summary de9d52ef4ab5b0e3dc712972c0bf27cc、
--     get_latest_racer_grades e318be8451c83ebb092d01ebd6730455、get_predictions_by_date 012ecc95edba6dee8757a763c65d7d04、
--     get_predictions_by_date_light 2cd99677b99cb450b85e92ecd6cf0351、get_race_exhibition_trend e21c5839fac95747fa2c7eb952c6db02、
--     get_race_history_summary a880d284e288cd195d2d57e6d984e14e、get_race_return_rate 8db0976512c51e307ec55573c01c6e19、
--     get_race_st_predictability 674d732232a408252f52fb35ba170723、get_race_technique_profile cf461cf468a21da7d005c3b07cdad2c5、
--     get_today_races bada0caa7995ba4a457362e1af70b942、trg_external_predictions_updated_at da5ac28a58c8b4bb30209bf0d3d7082c、
--     update_prediction_results bc7b4201ae68d737d570ef84948461e3、update_updated_at_column da5ac28a58c8b4bb30209bf0d3d7082c、
--     update_venue_stats 5abb53d52a6e147f07b752b3d71a36dd
--   SELECT conname, confdeltype FROM pg_constraint WHERE conrelid = 'public.analogy_feedback'::regclass AND contype = 'f';
--   期待: analogy_feedback_race_id_fkey | a
--   SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.analogy_feedback_guard()'::regprocedure;
--   期待: 166443b5ff8e900368eed5ef0202e7dd（143 の本文）
-- 適用後の確認（読み取り）:
--   SELECT p.oid::regprocedure AS sig, md5(p.prosrc) AS md5, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('compute_nige_second_by_course','compute_racer_course_technique_stats','compute_st_course_baseline','compute_venue_course_entry_baseline','compute_venue_course_technique_baseline','get_accuracy_summary','get_latest_racer_grades','get_predictions_by_date','get_predictions_by_date_light','get_race_exhibition_trend','get_race_history_summary','get_race_return_rate','get_race_st_predictability','get_race_technique_profile','get_today_races','trg_external_predictions_updated_at','update_prediction_results','update_updated_at_column','update_venue_stats') ORDER BY 1;
--   期待: 19行、proconfig はすべて {"search_path=public, pg_temp"}、md5 は適用前と同じ
--   SELECT conname, confdeltype, convalidated FROM pg_constraint WHERE conrelid = 'public.analogy_feedback'::regclass AND contype = 'f';
--   期待: analogy_feedback_race_id_fkey | c | true の1行だけ
--   SELECT md5(prosrc), proconfig FROM pg_proc WHERE oid = 'public.analogy_feedback_guard()'::regprocedure;
--   期待: 4c5a907704a88a2716353bc2dadee912 | {"search_path=public, pg_temp"}（187 の本文）
--   Supabase の advisor（security）で function_search_path_mutable が0件
--
-- 戻し方: 末尾の ROLLBACK-BEGIN〜ROLLBACK-END（search_path を外す・143 のトリガーの本文に戻す・外部キーを NO ACTION に戻す）
--
-- 検証: node scripts/maintenance/verify-function-search-path-migration.js（PGlite、本番には接続しない）

BEGIN;
-- races に ACCESS EXCLUSIVE を取る DROP CONSTRAINT を長く待たない（待つ間、races を読む画面の要求が後ろに並ぶ）
SET LOCAL lock_timeout = '1s';

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

-- L(1): 全体の流量の制限（143 の全体の上限「1時間300行」を「10分30行」に置き換える）
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
  -- 全体の上限（187）。実績は10分の最大2行（2026-10-09〜10-26 の14行）。根拠はファイルの冒頭
  IF (SELECT count(*) FROM public.analogy_feedback
      WHERE created_at > now() - interval '10 minutes') >= 30 THEN
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
-- SET LOCAL lock_timeout = '1s';
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
