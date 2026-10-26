/**
 * 取得の非常停止（scrape_job_state.fetch_stop、マイグレーション178）の検証（BOA-1145 の P4a ①、
 * docs/design/scraping-load-budget/spec.md §5.2、ADR-0101 決定6）。DB・ネットワークに接続しない。
 *
 *   (a) circuitBreaker: fetch_stop が立ったキーの check は FetchStoppedError（BreakerOpenError の一種）。下ろせば TTL の後に通る
 *   (b) politeFetch: ホストの fetch_stop で取得そのものをしない（fetchImpl を呼ばない）
 *   (c) store.breakerStore.read: fetch_stop を同じ SELECT で読む。列が無い（178 の前）ときだけ breaker_open_until を読み直す。
 *       他のエラーは投げる（非常停止を黙って無いことにしない）
 *   (d) store.breakerStore.open: upsert に fetch_stop・mode を入れない（人が立てた値を上書きしない。mode の既定 'off' の事故を繰り返さない）
 *   (e) 共通ラッパ: ホストの fetch_stop で、スロットを取らず skipped=fetch_stop（breaker_open と分ける）。連続失敗に数えない
 *   (f) /api/odds/live の本体: fetch_stop で公式へ取りに行かず、ok:false の breaker_open
 *   (g) 旧い形のストア（read が数を返す）も今のまま動く
 *   (h) マイグレーション178 が4列と CHECK を足し、mode には触れない
 *   (i) 会場のジョブの理由コード: FetchStoppedError も breaker_open（名前の比較で子を落とさない。審査 B）
 *   (j) 監視: fetch_stop が立った host の行を知らせる（下ろし忘れの検知。審査 E）
 *   (k) 178 の前と分かった後は、しばらく列を入れずに1往復で読む（審査 F）
 *
 * 実行: node scripts/maintenance/verify-scrape-fetch-stop.js
 */
import fs from "node:fs";
import {
  BreakerOpenError,
  FetchStoppedError,
  createCircuitBreaker,
} from "../lib/scrapeJobs/circuitBreaker.js";
import { createPoliteFetch } from "../lib/scrapeJobs/politeFetch.js";
import { createSupabaseStore } from "../lib/scrapeJobs/store.js";
import { createMemoryStore } from "../lib/scrapeJobs/testing/memoryStore.js";
import { runScrapeJob } from "../lib/scrapeJobs/cronWrapper.js";
import { handleLiveOddsRequest } from "../lib/liveOdds.js";
import { reasonFromError } from "../lib/scrapeJobs/venueJobSupport.js";
import { evaluateJobStates } from "../lib/scrapeJobs/monitor.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? `\n   ${detail}` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);
const HOST = "host:boatrace.jp";

const mkClock = (start = Date.parse("2026-10-26T03:00:00Z")) => {
  const c = { t: start };
  return { c, nowMs: () => c.t, now: () => new Date(c.t) };
};

// (a) circuitBreaker
{
  const clock = mkClock();
  const db = { [HOST]: { untilMs: 0, fetchStop: true } };
  const breaker = createCircuitBreaker({
    store: { read: async (k) => db[k] ?? { untilMs: 0, fetchStop: false } },
    now: clock.nowMs,
  });
  let err = null;
  try {
    await breaker.check(HOST);
  } catch (e) {
    err = e;
  }
  check(
    "(a) fetch_stop が立ったキーの check は FetchStoppedError（BreakerOpenError の一種）",
    err instanceof FetchStoppedError &&
      err instanceof BreakerOpenError &&
      /非常停止/.test(err.message) &&
      Number.isFinite(err.until),
    String(err),
  );
  check(
    "(a) 非常停止は半開の試行を予約しない",
    breaker.snapshot(HOST).probing === false &&
      breaker.snapshot(HOST).fetchStop === true,
    show(breaker.snapshot(HOST)),
  );
  db[HOST] = { untilMs: 0, fetchStop: false };
  let stillStopped = false;
  try {
    await breaker.check(HOST);
  } catch (e) {
    stillStopped = e instanceof FetchStoppedError;
  }
  check(
    "(a) 下ろしても TTL（10秒）の間はプロセス内の値で止まったまま",
    stillStopped,
  );
  clock.c.t += 10_001;
  let passed = true;
  try {
    await breaker.check(HOST);
  } catch {
    passed = false;
  }
  check("(a) TTL の後に読み直し、下ろした値で通る", passed);

  // 読み取りの失敗では直前の値のまま（立っていたら止まったまま）
  const flaky = { fail: false, value: { untilMs: 0, fetchStop: true } };
  const b2 = createCircuitBreaker({
    store: {
      read: async () => {
        if (flaky.fail) throw new Error("db down");
        return flaky.value;
      },
    },
    now: clock.nowMs,
  });
  await b2.check(HOST).catch(() => {});
  flaky.fail = true;
  clock.c.t += 10_001;
  let held = false;
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    await b2.check(HOST);
  } catch (e) {
    held = e instanceof FetchStoppedError;
  } finally {
    console.warn = origWarn;
  }
  check("(a) 読み取りに失敗したら直前の値（止まったまま）", held);
}

// (b) politeFetch
{
  const clock = mkClock();
  const calls = [];
  const breaker = createCircuitBreaker({
    store: {
      read: async (k) => ({ untilMs: 0, fetchStop: k === HOST }),
    },
    now: clock.nowMs,
  });
  const polite = createPoliteFetch({
    breaker,
    fetchImpl: async (url) => {
      calls.push(url);
      return new Response("ok");
    },
    sleep: async () => {},
  });
  let err = null;
  try {
    await polite(
      "https://www.boatrace.jp/owpc/pc/race/oddstf?rno=1&jcd=01&hd=20261026",
    );
  } catch (e) {
    err = e;
  }
  check(
    "(b) politeFetch: ホストの fetch_stop で取得しない（fetchImpl を呼ばない）",
    err instanceof FetchStoppedError && calls.length === 0,
    show({ err: String(err), calls }),
  );
  const other = await polite("https://race.boatcast.jp/txt/01/x.txt");
  check(
    "(b) 別のホストは止めない",
    other.ok && calls.length === 1,
    show(calls),
  );
}

// (c)(d) store.breakerStore
{
  const mkClient = (responses) => {
    responses.push(...Array(5).fill({ data: { breaker_open_until: null }, error: null }));
    const log = [];
    const client = {
      from(table) {
        const q = {
          _sel: null,
          select(cols) {
            q._sel = cols;
            return q;
          },
          eq() {
            return q;
          },
          async maybeSingle() {
            log.push({ op: "select", table, cols: q._sel });
            return responses.shift();
          },
          async upsert(payload, opts) {
            log.push({ op: "upsert", table, payload, opts });
            return { error: null };
          },
        };
        return q;
      },
    };
    return { client, log };
  };
  {
    const { client, log } = mkClient([
      {
        data: { breaker_open_until: "2026-10-26T04:00:00Z", fetch_stop: true },
        error: null,
      },
    ]);
    const r = await createSupabaseStore(client).breakerStore.read(HOST);
    check(
      "(c) read: breaker_open_until と fetch_stop を1つの SELECT で読む",
      r.fetchStop === true &&
        r.untilMs === Date.parse("2026-10-26T04:00:00Z") &&
        log.length === 1 &&
        log[0].cols === "breaker_open_until, fetch_stop",
      show({ r, log }),
    );
  }
  {
    const { client } = mkClient([{ data: null, error: null }]);
    const r = await createSupabaseStore(client).breakerStore.read(HOST);
    check(
      "(c) read: 行が無ければ閉じている・止まっていない",
      r.untilMs === 0 && r.fetchStop === false,
      show(r),
    );
  }
  {
    const { client, log } = mkClient([
      {
        data: null,
        error: {
          code: "42703",
          message: "column scrape_job_state.fetch_stop does not exist",
        },
      },
      { data: { breaker_open_until: null }, error: null },
    ]);
    const st = createSupabaseStore(client);
    const r = await st.breakerStore.read(HOST);
    check(
      "(c) read: 178 の前（fetch_stop の列が無い）は breaker_open_until だけを読み直し、止まっていない扱い",
      r.fetchStop === false &&
        r.untilMs === 0 &&
        log.length === 2 &&
        log[1].cols === "breaker_open_until",
      show({ r, log }),
    );
    const before = log.length;
    await st.breakerStore.read(HOST);
    check(
      "(k) 178 の前と分かった後の読み取りは、列を入れずに1往復",
      log.length === before + 1 && log[before].cols === "breaker_open_until",
      show(log),
    );
  }
  {
    const { client, log } = mkClient([
      { data: null, error: { code: "57014", message: "statement timeout" } },
    ]);
    let err = null;
    try {
      await createSupabaseStore(client).breakerStore.read(HOST);
    } catch (e) {
      err = e;
    }
    check(
      "(c) read: 列の不在でないエラーは読み直さずに投げる（非常停止を黙って無いことにしない）",
      err instanceof Error &&
        /ブレーカーの読み取り/.test(err.message) &&
        log.length === 1,
      show({ err: String(err), log }),
    );
  }
  {
    const { client, log } = mkClient([
      {
        data: null,
        error: {
          code: "42703",
          message: "column scrape_job_state.other_col does not exist",
        },
      },
    ]);
    let err = null;
    try {
      await createSupabaseStore(client).breakerStore.read(HOST);
    } catch (e) {
      err = e;
    }
    check(
      "(c) read: 別の列の不在（42703 でも fetch_stop の名前が無い）は投げる",
      err instanceof Error && log.length === 1,
      show({ err: String(err), log }),
    );
  }
  {
    const { client, log } = mkClient([]);
    await createSupabaseStore(client).breakerStore.open(
      HOST,
      Date.parse("2026-10-26T04:00:00Z"),
      "HTTP 429",
    );
    const payload = log[0]?.payload ?? {};
    check(
      "(d) open: upsert に fetch_stop・mode を入れない（人が立てた非常停止を上書きしない）",
      log[0]?.op === "upsert" &&
        !("fetch_stop" in payload) &&
        !("mode" in payload) &&
        payload.job === HOST,
      show(log),
    );
  }
}

// (e) 共通ラッパ
{
  const clock = mkClock();
  const store = createMemoryStore({
    rows: { odds: { job: "odds", mode: "live", consecutive_failures: 0 } },
    slots: [
      {
        job: "odds",
        race_id: "2026-10-26-01-01",
        offset_min: -60,
        attempts: 1,
        last_attempt_at: clock.now().toISOString(),
      },
    ],
  });
  store.breakerStore.fetchStop[HOST] = true;
  let handled = 0;
  const r = await runScrapeJob({
    job: "odds",
    store,
    handleSlot: async () => {
      handled++;
      return { outcome: "ok" };
    },
    now: clock.now,
    worker: "w-test",
  });
  check(
    "(e) 共通ラッパ: ホストの fetch_stop でスロットを取らず 200・skipped=fetch_stop",
    r.status === 200 &&
      r.body.skipped === "fetch_stop" &&
      handled === 0 &&
      !store.calls.some((c) => c.name === "claimSlots"),
    show(r),
  );
  check(
    "(e) 共通ラッパ: 連続失敗に数えない（recordFailure を呼ばない）",
    !store.calls.some((c) => c.name === "recordFailure"),
    show(store.calls.map((c) => c.name)),
  );
  // ブレーカーが開いているだけなら従来どおり breaker_open
  const store2 = createMemoryStore({
    rows: { odds: { job: "odds", mode: "live" } },
  });
  store2.breakerStore.until = clock.c.t + 60_000;
  const r2 = await runScrapeJob({
    job: "odds",
    store: store2,
    handleSlot: async () => ({ outcome: "ok" }),
    now: clock.now,
    worker: "w-test",
  });
  check(
    "(e) ブレーカーが開いているだけなら従来どおり skipped=breaker_open",
    r2.body.skipped === "breaker_open",
    show(r2),
  );
}

// (f) /api/odds/live の本体
{
  const clock = mkClock();
  const calls = [];
  const breaker = createCircuitBreaker({
    store: { read: async (k) => ({ untilMs: 0, fetchStop: k === HOST }) },
    now: clock.nowMs,
  });
  const polite = createPoliteFetch({
    breaker,
    maxRetries: 0,
    fetchImpl: async (url) => {
      calls.push(url);
      return new Response("<html></html>");
    },
  });
  const r = await handleLiveOddsRequest({
    query: { raceId: "2026-10-26-01-01", page: "tf" },
    politeFetch: polite,
    now: clock.now,
  });
  check(
    "(f) ライブオッズ: fetch_stop で公式へ取りに行かず ok:false の breaker_open",
    r.status === 200 &&
      r.body.ok === false &&
      r.body.reason === "breaker_open" &&
      calls.length === 0,
    show({ r, calls }),
  );
}

// (g) 旧い形のストア
{
  const clock = mkClock();
  const breaker = createCircuitBreaker({
    store: { read: async () => clock.c.t + 60_000 },
    now: clock.nowMs,
  });
  let err = null;
  try {
    await breaker.check(HOST);
  } catch (e) {
    err = e;
  }
  check(
    "(g) read が数（期限）を返す旧い形も、開いているときは BreakerOpenError（非常停止ではない）",
    err instanceof BreakerOpenError && !(err instanceof FetchStoppedError),
    String(err),
  );
}

// (h) マイグレーション178
{
  const sql = fs.readFileSync(
    new URL(
      "../../docs/db-migration/178_scrape_job_state_fetch_stop.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const body = sql.replace(/^\s*--.*$/gm, "");
  check(
    "(h) 178: fetch_stop BOOLEAN NOT NULL DEFAULT false・breaker_level・breaker_opened_at・段階の CHECK を足す",
    /ADD COLUMN IF NOT EXISTS fetch_stop BOOLEAN NOT NULL DEFAULT false/.test(
      body,
    ) &&
      /ADD COLUMN IF NOT EXISTS breaker_level SMALLINT NOT NULL DEFAULT 0/.test(
        body,
      ) &&
      /ADD COLUMN IF NOT EXISTS breaker_opened_at TIMESTAMPTZ/.test(body) &&
      /ADD COLUMN IF NOT EXISTS breaker_closed_at TIMESTAMPTZ/.test(body) &&
      /CHECK \(breaker_level BETWEEN 0 AND 10\)/.test(body),
  );
  check(
    "(h) 178: mode・既存の列・権限に触れない",
    // COMMENT の文字列の中の語は除いて見る
    !/\bmode\b/.test(body.replace(/'[^']*'/g, "''")) &&
      !/\b(GRANT|REVOKE|DROP COLUMN)\b/.test(body),
  );
}

// (i)
check(
  "(i) 会場のジョブの理由コード: FetchStoppedError も breaker_open（その日を処理済みにしない）",
  reasonFromError(new FetchStoppedError(HOST, 0)) === "breaker_open" &&
    reasonFromError(new BreakerOpenError(HOST, 0)) === "breaker_open",
);
{
  const src = fs.readFileSync(
    new URL("../daily/scrape-race-information.js", import.meta.url),
    "utf8",
  );
  check(
    "(i) scrape-race-information.js も名前ではなく instanceof で見る",
    /error instanceof BreakerOpenError/.test(src) &&
      !/name === "BreakerOpenError"/.test(src),
  );
}

// (j)
{
  const now = new Date("2026-10-26T03:00:00Z");
  const alerts = evaluateJobStates(
    [
      { job: HOST, mode: "off", fetch_stop: true, breaker_open_until: null },
      { job: "host:mbrace.or.jp", mode: "off", fetch_stop: false },
    ],
    now,
  );
  check(
    "(j) 監視: fetch_stop が立った host の行だけを知らせる",
    alerts.length === 1 &&
      alerts[0].key === `fetch_stop:${HOST}` &&
      /非常停止/.test(alerts[0].text),
    show(alerts),
  );
}

if (failures > 0) {
  console.error(`\n❌ ${failures}件の失敗`);
  process.exit(1);
}
console.log("\n✅ すべて成功");
