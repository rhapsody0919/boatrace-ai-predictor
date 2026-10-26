-- 178: scrape_job_state に、取得の非常停止（fetch_stop）と、ブレーカーの開いた段階（breaker_level・breaker_opened_at）の列を足す
-- （BOA-1145 の P4a。設計: docs/design/scraping-load-budget/spec.md §5.2・§12、docs/adr/0101-official-site-fetch-budget-and-stop-policy.md 決定5・6）
--
-- fetch_stop: `host:<ホスト>`（例 host:boatrace.jp）の行で true にすると、そのホストへの取得（Vercel の各ジョブ・/api/odds/live）が
--   止まる。読むのは circuitBreaker の check（scripts/lib/scrapeJobs/store.js の breakerStore.read。TTL 10秒）で、politeFetch の
--   取得の前と共通ラッパの起動の前の両方に効く。mode の列は使い回さない（mode の既定は 'off' で、ブレーカーが作る host の行は
--   mode を書かずに upsert されるため、mode で読むと一度開いたホストが永久に止まる。spec §5.2）。
--   ブレーカーの upsert（breakerStore.open）は fetch_stop を書かないので、人が立てた値を上書きしない。
-- breaker_level・breaker_opened_at: 403 でパス・ホストが開いた段階と、最後に開いた時刻。次の PR（P4a ②）で、開く期間を段階から決め
--   （30分→1時間→2時間→4時間→6時間）、24時間 403 が無ければ1段下げ、閉じた後24時間は絞る、をプロセスをまたいで持つために使う。
--   この PR のコードはまだ読まない・書かない。
--
-- 変えるのは列の追加3つと CHECK 1つだけ。関数・RLS・権限は変えない（scrape_job_state は 075 で RLS 有効・ポリシーなし・
--   anon/authenticated の権限を剥奪済み。列の追加はそのまま効く）。NOT NULL DEFAULT 定数の列の追加は、PostgreSQL 11 以降では
--   メタデータの変更だけ（表の書き換えなし）。CHECK の検証は表の走査が要るが、行は数十件。
--
-- コードは 178 の前でも動く: breakerStore.read は fetch_stop の列が無いエラー（42703、列名つき）のときだけ breaker_open_until だけを
--   読み直し、非常停止は無いものとして続ける（scripts/maintenance/verify-scrape-fetch-stop.js (c)）。
-- db-apply で当てる（classifyMigration は NOT NULL DEFAULT の列・CHECK の追加で heavy と判定する。オーナーの承認つきの経路）。
--   マージした日のうちに当ててよい。発走中でも当ててよい（scrape_job_state のロックは一瞬。lock_timeout 10秒）。
--
-- 非常停止の操作（オーナー。行が無くても効く。mode・ブレーカーの列は触らない）:
--   INSERT INTO public.scrape_job_state (job, fetch_stop) VALUES ('host:boatrace.jp', true)
--   ON CONFLICT (job) DO UPDATE SET fetch_stop = true, updated_at = now();
--   解除: UPDATE public.scrape_job_state SET fetch_stop = false, updated_at = now() WHERE job = 'host:boatrace.jp';
--   効くまで最大10秒（breakerStore.read の TTL）。ホストのキーは www・www1 を外した名前（politeFetch.js の hostKeyOf）。
--
-- 適用前の確認（読み取り）:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'scrape_job_state'
--     AND column_name IN ('fetch_stop', 'breaker_level', 'breaker_opened_at');
--   期待: 0行
--
-- 適用後の確認（読み取り）:
--   上の SELECT が3行。
--   SELECT count(*) FILTER (WHERE fetch_stop) AS stopped, count(*) FILTER (WHERE breaker_level <> 0) AS leveled,
--          count(*) AS total FROM public.scrape_job_state;
--   期待: stopped=0・leveled=0（既定値で埋まる）
--
-- 戻し方（列を消すだけ。コードは列が無くても動く。立てた fetch_stop の値は失われる）:
--   ALTER TABLE public.scrape_job_state
--     DROP COLUMN IF EXISTS fetch_stop, DROP COLUMN IF EXISTS breaker_level, DROP COLUMN IF EXISTS breaker_opened_at;
BEGIN;

SET LOCAL lock_timeout = '10s';

ALTER TABLE public.scrape_job_state
  ADD COLUMN IF NOT EXISTS fetch_stop BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS breaker_level SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS breaker_opened_at TIMESTAMPTZ;

-- 段階は 0（閉じている・下がりきった）〜 10。開く期間の上限（6時間）は段階4で届くので、10 は暴走の歯止め
ALTER TABLE public.scrape_job_state
  DROP CONSTRAINT IF EXISTS scrape_job_state_breaker_level_range;
ALTER TABLE public.scrape_job_state
  ADD CONSTRAINT scrape_job_state_breaker_level_range CHECK (breaker_level BETWEEN 0 AND 10);

COMMENT ON COLUMN public.scrape_job_state.fetch_stop IS
  '取得の非常停止。host:<ホスト> の行で true にすると、そのホストへの取得（Vercel の各ジョブ・/api/odds/live）が止まる。人が立てて人が下ろす。ブレーカーの upsert は書かない。mode を使い回さない（ADR-0101 決定6、178）';
COMMENT ON COLUMN public.scrape_job_state.breaker_level IS
  'ブレーカー（host:… の行）の開いた段階。0=閉じている・下がりきった。開く期間を段階から決め、24時間 403 が無ければ1段下げる（ADR-0101 決定5、178）';
COMMENT ON COLUMN public.scrape_job_state.breaker_opened_at IS
  'ブレーカー（host:… の行）が最後に開いた時刻。段階の下げと、閉じた後24時間の絞りの起点（ADR-0101 決定5、178）';

COMMIT;
