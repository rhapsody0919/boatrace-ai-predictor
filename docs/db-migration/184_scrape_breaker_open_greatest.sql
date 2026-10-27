-- 184: ブレーカーの開放を DB で「長い方」に書く RPC scrape_breaker_open（BOA-1159。BOA-1145 P4a ④c の system-architect 審査 P3-1）
-- 設計: docs/design/scraping-load-budget/spec.md §5.2、docs/adr/0101-official-site-fetch-budget-and-stop-policy.md 決定5
--
-- 今（178 の後）: circuitBreaker が書く前に host の行を読み、読んだ期限と新しい期限の長い方を PostgREST の upsert で書く。読んでから
--   upsert するまでの数十 ms に別の起動が長い期限（403 のホストの6時間）を書くと、短い期限（429 の5分）で上書きする。④c で読み直しが
--   DB の値を正とするので、上書きされた側の起動の期限も縮む。
-- この関数: 1つの INSERT … ON CONFLICT DO UPDATE の中で GREATEST を取る（行のロックの中で比べるので、並行の書き込みでも縮まない）。
--   breaker_level・breaker_opened_at・last_error は、期限を決めた側（新しい期限が今の期限以上のとき）の値にする。段階を GREATEST に
--   しないのは、DB の段階は24時間ごとに読む側で下げる（遅延評価）ので、生の段階の大きい方を残すと下げが効かなくなるため。
--   p_level が NULL なら段階・開いた時刻は変えない。fetch_stop・mode・breaker_closed_at は書かない（人が立てた値・既定の off に触れない）。
--   戻り値は書いた後の breaker_open_until（呼び出し側が「DB の値」として覚える）。
--
-- コードは 184 の前でも動く: store.js の breakerStore.open は、この関数が無いエラー（PGRST202・42883、関数名つき）のときだけ今の upsert に
--   戻る（scripts/maintenance/verify-scrape-breaker-greatest.js）。
-- db-apply で当てる（関数と GRANT なので heavy の判定。オーナーの承認つきの経路）。発走中でも当ててよい（表は変えない）。
--
-- 適用前の確認（読み取り）:
--   SELECT count(*) FROM pg_proc WHERE proname = 'scrape_breaker_open';  期待: 0
-- 適用後の確認（読み取り）:
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid), p.prosecdef FROM pg_proc p WHERE p.proname = 'scrape_breaker_open';
--   期待: 1行、引数 (p_job text, p_until timestamp with time zone, p_reason text, p_level smallint, p_opened_at timestamp with time zone)、prosecdef=false
--   SELECT has_function_privilege('anon', 'public.scrape_breaker_open(text,timestamptz,text,smallint,timestamptz)', 'EXECUTE');  期待: false
--
-- 戻し方（コードは関数が無ければ upsert に戻る）:
--   DROP FUNCTION IF EXISTS public.scrape_breaker_open(TEXT, TIMESTAMPTZ, TEXT, SMALLINT, TIMESTAMPTZ);
BEGIN;

CREATE OR REPLACE FUNCTION public.scrape_breaker_open(
  p_job TEXT,
  p_until TIMESTAMPTZ,
  p_reason TEXT,
  p_level SMALLINT DEFAULT NULL,
  p_opened_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TIMESTAMPTZ
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  INSERT INTO public.scrape_job_state AS s (job, breaker_open_until, last_error, updated_at, breaker_level, breaker_opened_at)
  VALUES (p_job, p_until, p_reason, now(), COALESCE(p_level, 0), p_opened_at)
  ON CONFLICT (job) DO UPDATE SET
    breaker_open_until = GREATEST(COALESCE(s.breaker_open_until, '-infinity'::timestamptz), EXCLUDED.breaker_open_until),
    last_error = CASE WHEN EXCLUDED.breaker_open_until >= COALESCE(s.breaker_open_until, '-infinity'::timestamptz)
      THEN EXCLUDED.last_error ELSE s.last_error END,
    breaker_level = CASE WHEN p_level IS NOT NULL
        AND EXCLUDED.breaker_open_until >= COALESCE(s.breaker_open_until, '-infinity'::timestamptz)
      THEN p_level ELSE s.breaker_level END,
    breaker_opened_at = CASE WHEN p_level IS NOT NULL
        AND EXCLUDED.breaker_open_until >= COALESCE(s.breaker_open_until, '-infinity'::timestamptz)
      THEN p_opened_at ELSE s.breaker_opened_at END,
    updated_at = now()
  RETURNING s.breaker_open_until;
$$;

COMMENT ON FUNCTION public.scrape_breaker_open(TEXT, TIMESTAMPTZ, TEXT, SMALLINT, TIMESTAMPTZ) IS
  'ブレーカーの開放を、今の期限と新しい期限の長い方で書く（並行の書き込みで縮めない）。段階・開いた時刻・理由は期限を決めた側の値。fetch_stop・mode は書かない。BOA-1159、184';

REVOKE ALL ON FUNCTION public.scrape_breaker_open(TEXT, TIMESTAMPTZ, TEXT, SMALLINT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scrape_breaker_open(TEXT, TIMESTAMPTZ, TEXT, SMALLINT, TIMESTAMPTZ) TO service_role;

COMMIT;
