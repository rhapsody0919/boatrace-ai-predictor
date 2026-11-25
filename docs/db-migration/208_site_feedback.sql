-- 208: サイト全体のご意見ボックスの表 site_feedback を新設する
--
-- ⚠️ 本番へ未適用。適用はオーナーが db-apply ワークフローで行う（heavy の判定、承認つき）。
--
-- 背景:
--   次に何を作るかを決める材料として、ファンの声（欲しい機能・使いにくいところ・データの誤り）を
--   ログインなし・匿名で集める（オーナー 2026-11-23）。右下のボタンとフッターの入口から入力パネルを開き、
--   1件を1行で INSERT する。公開しない。設計: docs/design/site-feedback-box/spec.md
--   手本は龍神ソナーの声（143_analogy_feedback.sql）と、その全体の流量の制限（187）。
--
-- 列:
--   kind        内容の種類（任意）。feature（欲しい機能）| usability（使いにくいところ）| data（データの誤り）| other。選ばなければ NULL
--   comment     自由記述。空白（改行・タブ・全角の空白を含む）でない字を1つ以上含み、500文字まで。原文のまま保存し、期限は置かない（オーナー 2026-11-23）
--   rating      満足度（任意）。1〜5。選ばなければ NULL
--   page_type   どの種類の画面から送ったか（URL・レースや選手の番号は持たない）
--   lang        表示言語（ja・en・zh-TW・ko）
--   client_key  ブラウザごとの乱数（localStorage）。個人と結びつけない。連投の制限だけに使う
--   列挙と上限は画面の src/pure/siteFeedback.js と1対1。画面を全画面につなぐ PR の verify-site-feedback-gate.js が突き合わせる。
--   列挙を足すときは、CHECK を広げるマイグレーションを先に当ててから画面を出す（逆にすると、新しい値の送信が全部落ちる）。
--   列挙を消すときは画面から先に消し、CHECK には残す（開いたままのタブは古い画面で送る）。
--
-- 権限:
--   RLS 有効。anon・authenticated は INSERT のポリシーと INSERT 権限だけ（SELECT・UPDATE・DELETE なし）。
--   読むのは service_role だけ。claude_ro（166 の既定の権限で新しい public の表を読める）からは外す
--   （オーナー 2026-11-23。自由記述に名前・連絡先が書かれうるため。sns_oauth_tokens と同じ扱い）。
-- 連投の制限（トリガー、SECURITY DEFINER で件数を出す）:
--   同じ client_key で直近24時間に10行、全体で直近10分に30行を超えたら拒否する（P0001。画面は「送れませんでした」）。
--   全体の値は 187 で龍神ソナーの声に入れた値と同じ。client_key を毎回変える荒らしが入れるのは1時間180行まで。
--   荒らしが続く間は正規の声も止まり続け、荒らしが止まってから最大10分で戻る（187 と同じ割り切り）。
--   件数を出す前に pg_advisory_xact_lock で INSERT を1本ずつにする。鍵は hashtext('public.site_feedback_guard')=1016746258 で、
--   187 の hashtext('public.analogy_feedback_guard')=971606541 と衝突しない。
--   created_at はトリガーで now() に上書きする（過去の時刻を送って制限の窓を外すのを防ぐ）。
--
-- 当てる順番: この表を本番に当ててから、画面を全画面につなぐ PR（claude/site-feedback-mount）をマージする。
--   部品だけの PR（つながず画面に出ない）は先に入ってよい。つなぐ PR の verify-site-feedback-gate.js は、
--   台帳（APPLIED.md）でこのファイルが適用済みになるまで赤になる。
--   新しい表を作るだけで、既存の表・関数・読み手には触れない（既存の表のロックを取らない）。
--
-- 適用前の確認（読み取り。claude_ro）:
--   SELECT to_regclass('public.site_feedback'), to_regprocedure('public.site_feedback_guard()'), to_regrole('claude_ro');
--   → NULL, NULL, claude_ro（同じ名前の別物があると CREATE TABLE IF NOT EXISTS が黙って何もしない。REVOKE の相手のロールが在ること）
--
-- 適用後の確認（読み取り）:
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.site_feedback'::regclass;
--   → true
--   SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'site_feedback';
--   → site_feedback_insert | INSERT | {anon,authenticated} の1行だけ
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.site_feedback'::regclass AND NOT tgisinternal;
--   → site_feedback_guard
--   SELECT has_table_privilege('anon', 'public.site_feedback', 'SELECT'),
--          has_table_privilege('anon', 'public.site_feedback', 'INSERT'),
--          has_table_privilege('service_role', 'public.site_feedback', 'SELECT'),
--          has_table_privilege('claude_ro', 'public.site_feedback', 'SELECT');
--   → false, true, true, false
--   SELECT has_table_privilege('authenticated', 'public.site_feedback', 'INSERT'),
--          has_table_privilege('anon', 'public.site_feedback', 'UPDATE'),
--          has_table_privilege('anon', 'public.site_feedback', 'DELETE'),
--          has_function_privilege('claude_ro', 'public.site_feedback_guard()', 'EXECUTE');
--   → true, false, false, false
--   SELECT prosecdef, proconfig FROM pg_proc WHERE oid = 'public.site_feedback_guard()'::regprocedure;
--   → true, {"search_path=public, pg_temp"}
--
-- 戻し方: 末尾の ROLLBACK-BEGIN〜ROLLBACK-END（集めたご意見も消える）。先に画面をつなぐ PR（とフッターの入口の PR）を revert して定時で出してから当てる。
--   行を残したいなら、オーナーが CSV に退避してリポジトリの外に置く（docs/knowledge/db-operations.md）。
--
-- 検証: scripts/maintenance の verify-site-feedback-migration.js（PGlite、本番には接続しない）

BEGIN;

CREATE TABLE IF NOT EXISTS public.site_feedback (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  kind        text,
  comment     text NOT NULL,
  rating      smallint,
  page_type   text NOT NULL,
  lang        text NOT NULL,
  client_key  uuid NOT NULL,
  CONSTRAINT site_feedback_kind CHECK (
    kind IS NULL OR kind IN ('feature', 'usability', 'data', 'other')
  ),
  -- 空白だけの内容は弾く（画面は前後の空白を除いて送るが、anon キーで直に送られうる）。
  -- btrim は半角の空白しか除かないので、改行・タブ・全角の空白を含めて「空白でない字が1つ以上」で見る
  CONSTRAINT site_feedback_comment CHECK (
    comment ~ '[^[:space:]　]' AND char_length(comment) <= 500
  ),
  CONSTRAINT site_feedback_rating CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  CONSTRAINT site_feedback_page_type CHECK (
    page_type IN ('home', 'today', 'race', 'racer', 'venue', 'analysis', 'blog', 'guide', 'other')
  ),
  CONSTRAINT site_feedback_lang CHECK (lang IN ('ja', 'en', 'zh-TW', 'ko'))
);

CREATE INDEX IF NOT EXISTS site_feedback_client_created
  ON public.site_feedback (client_key, created_at);
CREATE INDEX IF NOT EXISTS site_feedback_created
  ON public.site_feedback (created_at);

-- 連投の制限。anon は SELECT できないので、件数は表の持ち主の権限で出す
CREATE OR REPLACE FUNCTION public.site_feedback_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.created_at := now();
  -- 同時の INSERT が互いの行を見ずに上限を越えないよう、件数を出す前に1本ずつにする（トランザクションの終わりで外れる）
  PERFORM pg_advisory_xact_lock(hashtext('public.site_feedback_guard'));
  IF (SELECT count(*) FROM public.site_feedback
      WHERE client_key = NEW.client_key
        AND created_at > now() - interval '24 hours') >= 10 THEN
    RAISE EXCEPTION 'site_feedback: too many from this client' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.site_feedback
      WHERE created_at > now() - interval '10 minutes') >= 30 THEN
    RAISE EXCEPTION 'site_feedback: too many overall' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.site_feedback_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS site_feedback_guard ON public.site_feedback;
CREATE TRIGGER site_feedback_guard
  BEFORE INSERT ON public.site_feedback
  FOR EACH ROW EXECUTE FUNCTION public.site_feedback_guard();

ALTER TABLE public.site_feedback ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.site_feedback FROM anon, authenticated;
-- 自由記述に名前・連絡先が書かれうるので、Claude の読み取り用のロールからは外す（オーナー 2026-11-23）
REVOKE ALL ON public.site_feedback FROM claude_ro;
-- grant-exempt: ご意見は匿名の閲覧者が送るので、anon に INSERT だけを渡す（SELECT・UPDATE・DELETE は渡さない）。
--   悪用は CHECK（列挙値・500文字・空白だけを弾く）とトリガーの連投制限で抑える（2026-11-23 オーナー承認の設計）
GRANT INSERT ON public.site_feedback TO anon, authenticated;

DROP POLICY IF EXISTS site_feedback_insert ON public.site_feedback;
CREATE POLICY site_feedback_insert ON public.site_feedback
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

COMMENT ON TABLE public.site_feedback IS
  'サイト全体のご意見ボックス。匿名・anon は INSERT のみ、claude_ro は読めない。docs/db-migration/208_site_feedback.sql';

COMMIT;

-- 戻し方（オーナーが実行する。集めたご意見も消える）:
-- ROLLBACK-BEGIN
-- BEGIN;
-- DROP TABLE IF EXISTS public.site_feedback;
-- DROP FUNCTION IF EXISTS public.site_feedback_guard();
-- COMMIT;
-- ROLLBACK-END
