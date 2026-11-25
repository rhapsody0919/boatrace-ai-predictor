-- 209: ご意見ボックスの受け付けた件数を1時間ごとに数える表 site_feedback_hourly を足す（荒らしに気づく道）
--
-- ⚠️ 本番へ未適用。適用はオーナーが db-apply ワークフローで行う。208（site_feedback）の後に当てる。
--
-- 背景:
--   208 の site_feedback は自由記述に名前・連絡先が書かれうるので claude_ro から外した（オーナー 2026-11-23）。
--   そのため hq・Claude は件数も読めず、187（龍神ソナーの声）の「荒らしの行は表に残るので見つけて消せる」が成り立たない。
--   全体の上限（10分30行）で正規の声が止まり続けても、手がかりは GA4 の site_feedback_send_failed（同意した人だけ）しか無い
--   （system-architect の審査 P2-1、2026-11-25）。オーナー決定（2026-11-25）: 件数を読む口を作る。
--   ビューは 076 の決まりで security_invoker=true なので、claude_ro に読ませると元の表の SELECT が要る。
--   そこで、208 の制限のトリガーが受け付けた行ごとに、時間ごとの件数だけの表へ1を足す。本文・識別番号は持たない。
--
-- 列:
--   hour      受け付けた時刻（created_at = now()）を UTC で date_trunc('hour', …, 'UTC') した物（セッションの TimeZone に依らない）
--   received  その1時間に受け付けた行の数。全体の上限に張り付くと 180（10分30行×6）近くになる
--   拒否した送信（P0001・CHECK）は INSERT ごと戻るので数えない。service_role で行を消しても減らさない（受け付けた数の記録）
--
-- 権限:
--   RLS 有効・ポリシーなし。anon・authenticated の権限なし。claude_ro は 166 の既定の権限で SELECT（明示もする）。
--   書くのはトリガーの関数（SECURITY DEFINER、表の持ち主の権限）だけ。
--
-- 関数の差し替え: 208 の site_feedback_guard を CREATE OR REPLACE で、末尾に件数の足し込みを加えた物にする
--   （制限・created_at の上書き・lock の順は 208 と同じ）。トリガーそのものは 208 の物のまま。
--   次にこの関数を差し替えるときは、この 209 の本文を土台にする（208 を土台にすると件数の足し込みが黙って消える）。
--   表の lock（SHARE）を先頭で取り、古い関数で動いている送信が終わるのを待ってから差し替える
--   （advisory lock では、待っている送信が古い本文のまま進み、数えから漏れる。system-architect 2026-11-25）。
--   適用の間（数ミリ秒）ご意見の送信は待たされる。既存のほかの表には触れない。
--   既にある行は、表を作った後に数える。2回目に当てたときは既にある時間を変えない。
--
-- 適用前の確認（読み取り。claude_ro）:
--   SELECT to_regclass('public.site_feedback'), to_regclass('public.site_feedback_hourly');
--   → site_feedback, NULL（208 が当たっていて、この表がまだ無い）
--   SELECT md5(prosrc), prosecdef, proconfig FROM pg_proc WHERE oid = 'public.site_feedback_guard()'::regprocedure;
--   → 19674daabaf4f897a18c6382b62369c3, true, {"search_path=public, pg_temp"}（差し替える相手が 208 の本文。PGlite で計算）
--
-- 適用後の確認（読み取り）:
--   SELECT has_table_privilege('claude_ro', 'public.site_feedback_hourly', 'SELECT'),
--          has_table_privilege('anon', 'public.site_feedback_hourly', 'SELECT'),
--          has_table_privilege('claude_ro', 'public.site_feedback', 'SELECT');
--   → true, false, false
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.site_feedback_hourly'::regclass;
--   → true
--   SELECT hour, received FROM public.site_feedback_hourly ORDER BY hour DESC LIMIT 24;（claude_ro で読める）
--   SELECT prosecdef, proconfig, has_function_privilege('claude_ro', oid, 'EXECUTE')
--     FROM pg_proc WHERE oid = 'public.site_feedback_guard()'::regprocedure;
--   → true, {"search_path=public, pg_temp"}, false
--   行があったときだけ、オーナーが SQL Editor で（claude_ro は site_feedback を読めない）:
--   SELECT (SELECT coalesce(sum(received), 0) FROM public.site_feedback_hourly) = (SELECT count(*) FROM public.site_feedback);
--   → true
--
-- 戻し方: 末尾の ROLLBACK-BEGIN〜ROLLBACK-END（関数を 208 の本文に1字違わず戻し、表を消す）。画面には関係しない。
--
-- 検証: scripts/maintenance の verify-site-feedback-hourly.js（PGlite、本番には接続しない）

BEGIN;
SET LOCAL lock_timeout = '10s';
-- 古い関数で動いている送信が終わるのを待ち、当てている間の送信を止める（lock が外れると新しい関数で動く。数ミリ秒）
LOCK TABLE public.site_feedback IN SHARE MODE;

CREATE TABLE IF NOT EXISTS public.site_feedback_hourly (
  hour      timestamptz PRIMARY KEY,
  received  integer NOT NULL CHECK (received >= 0)
);

ALTER TABLE public.site_feedback_hourly ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_feedback_hourly FROM anon, authenticated;
GRANT SELECT ON public.site_feedback_hourly TO claude_ro;

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
  -- 受け付けた数だけを時間ごとに足す（209。行が後の CHECK で落ちたときは、この足し込みも一緒に戻る）
  INSERT INTO public.site_feedback_hourly AS h (hour, received)
  VALUES (date_trunc('hour', NEW.created_at, 'UTC'), 1)
  ON CONFLICT (hour) DO UPDATE SET received = h.received + 1;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.site_feedback_guard() FROM PUBLIC;

-- 既にある行を数える。2回目は既にある時間を変えない（service_role で行を消した後でも、受け付けた数を下げない）
INSERT INTO public.site_feedback_hourly AS h (hour, received)
SELECT date_trunc('hour', created_at, 'UTC'), count(*)::integer
FROM public.site_feedback
GROUP BY 1
ON CONFLICT (hour) DO NOTHING;

COMMENT ON TABLE public.site_feedback_hourly IS
  'ご意見ボックス（site_feedback）の受け付けた件数を1時間ごとに。本文・識別番号は持たない。claude_ro が読む。docs/db-migration/209_site_feedback_hourly.sql';

COMMIT;

-- 戻し方（オーナーが実行する。件数の記録は消えるが、ご意見の行は消えない）:
-- ROLLBACK-BEGIN
-- BEGIN;
-- SET LOCAL lock_timeout = '10s';
-- LOCK TABLE public.site_feedback IN SHARE MODE;
-- CREATE OR REPLACE FUNCTION public.site_feedback_guard()
-- RETURNS trigger
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public, pg_temp
-- AS $$
-- BEGIN
--   NEW.created_at := now();
--   -- 同時の INSERT が互いの行を見ずに上限を越えないよう、件数を出す前に1本ずつにする（トランザクションの終わりで外れる）
--   PERFORM pg_advisory_xact_lock(hashtext('public.site_feedback_guard'));
--   IF (SELECT count(*) FROM public.site_feedback
--       WHERE client_key = NEW.client_key
--         AND created_at > now() - interval '24 hours') >= 10 THEN
--     RAISE EXCEPTION 'site_feedback: too many from this client' USING ERRCODE = 'P0001';
--   END IF;
--   IF (SELECT count(*) FROM public.site_feedback
--       WHERE created_at > now() - interval '10 minutes') >= 30 THEN
--     RAISE EXCEPTION 'site_feedback: too many overall' USING ERRCODE = 'P0001';
--   END IF;
--   RETURN NEW;
-- END;
-- $$;
-- REVOKE ALL ON FUNCTION public.site_feedback_guard() FROM PUBLIC;
-- DROP TABLE IF EXISTS public.site_feedback_hourly;
-- COMMIT;
-- ROLLBACK-END
