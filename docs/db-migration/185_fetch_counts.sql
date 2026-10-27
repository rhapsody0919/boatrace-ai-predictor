-- 185: 取得先への取得の数を数える表 fetch_counts と、加算の RPC add_fetch_counts・日の合計の RPC fetch_counts_daily
-- （BOA-1145 P3 = spec の M2。設計: docs/design/scraping-load-budget/spec.md §7.1・§12、docs/adr/0101-official-site-fetch-budget-and-stop-policy.md 決定2・7）
--
-- 数える側: scripts/lib/scrapeJobs/fetchCounter.js（politeFetch が1回の fetch（再試行・カナリアも1件）ごとに、JST の日・時・ホスト・パス・
--   応答の種類・経路で数え、起動の終わりに1回の RPC で足す）。取得0の起動は書かない。/api/odds/live は長く生きるので N 件・一定の時間ごとに書く。
-- PostgREST の upsert では数を足せないので RPC（INSERT … ON CONFLICT DO UPDATE SET count = count + EXCLUDED.count）。
-- パスは2桁以上の数字の並びを {n} にまとめる（odds3t の 3 は残す）（BOATCAST のファイル名に日付・会場が入り、行が増え続けないように）。
-- 日の合計は行が1,000を超えうるので RPC の SUM で読む（PostgREST の1,000行で黙って切れない）。
-- 行の見積り: 1日あたり 時24 × パス約15 × 種類1〜3 × 経路2 で多くて約2,000行、1行約100バイト。古い行の削除は予算の PR（P4d）で
--   scrape-cleanup に足す（それまでは年に約70万行・約70MB が上限の目安）。書き込みは1日に起動の数（取得のあった起動だけ、約2,000回）の
--   小さな upsert。Disk IO への影響は小さい。
--
-- RLS 有効・ポリシーなし。anon・authenticated の権限は剥奪し、RPC は service_role だけが実行できる（書くのも読むのも service_role の Vercel の関数・バッチ）。
-- コードは 185 の前でも動く: fetchCounter は RPC が無い（PGRST202・42883、関数名つき）と分かったら、そのプロセスでは数えるのをやめる。
--   他の失敗も警告だけで、取得は止めない（数えるのは監視のためで、取得の可否の判定には使わない）。
-- db-apply で当てる（表の作成と関数なので heavy。オーナーの承認つきの経路）。早く当てるほど2週間の数が早くそろう（P4b〜d の前提）。
--
-- 適用前の確認（読み取り）:
--   SELECT to_regclass('public.fetch_counts');  期待: NULL
-- 適用後の確認（読み取り）:
--   SELECT to_regclass('public.fetch_counts');  期待: fetch_counts
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.fetch_counts'::regclass;  期待: true
--   SELECT proname FROM pg_proc WHERE proname IN ('add_fetch_counts', 'fetch_counts_daily') ORDER BY 1;  期待: 2行
--   （翌日）SELECT * FROM public.fetch_counts_daily((now() AT TIME ZONE 'Asia/Tokyo')::date);  期待: boatrace.jp の各パスの行
--
-- 戻し方（数えた行は失われる。コードは RPC が無ければ数えない）:
--   DROP FUNCTION IF EXISTS public.fetch_counts_daily(DATE);
--   DROP FUNCTION IF EXISTS public.add_fetch_counts(JSONB);
--   DROP TABLE IF EXISTS public.fetch_counts;
BEGIN;

SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.fetch_counts (
  -- JST の日・時（取得した時刻）
  day DATE NOT NULL,
  hour SMALLINT NOT NULL CHECK (hour BETWEEN 0 AND 23),
  -- ホスト（www・www1 を外した名前。例 boatrace.jp）とパス（数字の並びは {n}）
  host TEXT NOT NULL,
  path TEXT NOT NULL,
  -- 応答の種類: ok=2xx・3xx、not_found=404、blocked=403、overload=429・503、server_error=その他の5xx、client_error=その他の4xx、
  -- network=タイムアウト・接続の失敗
  kind TEXT NOT NULL CHECK (kind IN ('ok', 'not_found', 'blocked', 'overload', 'server_error', 'client_error', 'network')),
  -- 経路: vercel=Cron の各ジョブ、live=/api/odds/live、gha=GitHub Actions（P6 で politeFetch を通したら）
  source TEXT NOT NULL CHECK (source IN ('vercel', 'live', 'gha')),
  count INTEGER NOT NULL CHECK (count > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, hour, host, path, kind, source)
);

COMMENT ON TABLE public.fetch_counts IS
  '取得先への取得の数（JST の日・時×ホスト×パス×応答の種類×経路）。politeFetch が数え、add_fetch_counts で足す。日の合計は fetch_counts_daily。BOA-1145 P3（spec §7.1 の M2）、185';

ALTER TABLE public.fetch_counts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.fetch_counts FROM PUBLIC, anon, authenticated;

-- 足す。p_rows: [{"day":"2026-10-27","hour":15,"host":"boatrace.jp","path":"/owpc/pc/race/oddstf","kind":"ok","source":"vercel","count":5}, ...]
-- 戻り値: 足した行の数
CREATE OR REPLACE FUNCTION public.add_fetch_counts(p_rows JSONB)
RETURNS INTEGER
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  WITH ins AS (
    INSERT INTO public.fetch_counts AS f (day, hour, host, path, kind, source, count)
    SELECT r.day, r.hour, r.host, r.path, r.kind, r.source, r.count
    FROM jsonb_to_recordset(p_rows) AS r(day DATE, hour SMALLINT, host TEXT, path TEXT, kind TEXT, source TEXT, count INTEGER)
    WHERE r.count > 0
    ON CONFLICT (day, hour, host, path, kind, source) DO UPDATE
      SET count = f.count + EXCLUDED.count, updated_at = now()
    RETURNING 1
  )
  SELECT count(*)::INTEGER FROM ins;
$$;

COMMENT ON FUNCTION public.add_fetch_counts(JSONB) IS
  'fetch_counts に件数を足す（同じキーは加算）。service_role のみ。185';

REVOKE ALL ON FUNCTION public.add_fetch_counts(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_fetch_counts(JSONB) TO service_role;

-- 日の合計（ホスト×パス×種類×経路）。行が1,000を超えても SUM で返す
CREATE OR REPLACE FUNCTION public.fetch_counts_daily(p_day DATE)
RETURNS TABLE (host TEXT, path TEXT, kind TEXT, source TEXT, total BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT f.host, f.path, f.kind, f.source, sum(f.count)::BIGINT
  FROM public.fetch_counts f
  WHERE f.day = p_day
  GROUP BY f.host, f.path, f.kind, f.source
  ORDER BY f.host, f.path, f.kind, f.source;
$$;

COMMENT ON FUNCTION public.fetch_counts_daily(DATE) IS
  'fetch_counts の JST の1日の合計（ホスト×パス×種類×経路）。service_role のみ。185';

REVOKE ALL ON FUNCTION public.fetch_counts_daily(DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fetch_counts_daily(DATE) TO service_role;

COMMIT;
