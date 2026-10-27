/**
 * 取得の数を数える仕組み（fetch_counts・add_fetch_counts・fetch_counts_daily、マイグレーション185。scripts/lib/scrapeJobs/fetchCounter.js）
 * の検証（BOA-1145 P3 = spec §7.1 の M2）。本番 DB には触れない（PGlite と偽のクライアント）。
 *
 *   (a) 応答の種類: 2xx・3xx=ok、404=not_found、403=blocked、429・503=overload、他の5xx=server_error、他の4xx=client_error、例外=network
 *   (b) ホストは www を外し、パスの数字の並びは {n} にまとめる（BOATCAST のファイル名で行が増え続けない）
 *   (c) JST の日・時（UTC 15:30 は JST の翌日 0時）
 *   (d) politeFetch: 1回の fetch ごとに数える（再試行・カナリア・接続の失敗も1件）
 *   (e) flush: 何も無ければ書かない。1回の RPC でまとめて足す。RPC が無い（185 の前）なら数えるのをやめる。他の失敗は持ち越して次に足す。どれも投げない
 *   (f) maybeFlush: 20件か60秒で書く（/api/odds/live）
 *   (g) PGlite で 185: 同じキーは加算・count 0 は無視・日の合計・RLS 有効・anon は実行できない
 *   (h) Cron の共通の口（createScrapeCronHandler）: 取得した起動の終わりに1回足す。取得0の起動は書かない
 *   (i) オッズの口（createOddsCronHandlerWithPredictionOdds）も数える（185 の審査 P1-1）
 *   (j) 呼び出し側の中断は数えず、自前の打ち切りは timeout（審査 P2-3）
 *   (k) 20件で裏で書く（審査 P2-2）
 *   (l) 裏で書いている最中の maybeFlush は、その完了を待つ（Codex の P1）
 *
 * 実行: node scripts/maintenance/verify-fetch-counter.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createFetchCounter,
  fetchKindOf,
  fetchTargetOf,
  jstDayHour,
} from "../lib/scrapeJobs/fetchCounter.js";
import { createPoliteFetch } from "../lib/scrapeJobs/politeFetch.js";
import { createCircuitBreaker } from "../lib/scrapeJobs/circuitBreaker.js";
import { createScrapeCronHandler } from "../lib/scrapeJobs/cronWrapper.js";
import { createMemoryStore } from "../lib/scrapeJobs/testing/memoryStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? `\n   ${detail}` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);
const silent = { warn() {} };
const T = new Date("2026-10-27T06:00:00Z"); // JST 15:00

// (a)
{
  const got = [200, 302, 404, 403, 429, 503, 500, 502, 400].map((status) =>
    fetchKindOf({ status }),
  );
  check(
    "(a) 応答の種類の分け方",
    show(got) ===
      show([
        "ok",
        "ok",
        "not_found",
        "blocked",
        "overload",
        "overload",
        "server_error",
        "server_error",
        "client_error",
      ]) && fetchKindOf({ error: new Error("x") }) === "network",
    show(got),
  );
}
// (b)
{
  const a = fetchTargetOf(
    "https://www.boatrace.jp/owpc/pc/race/oddstf?rno=1&jcd=04&hd=20261027",
  );
  const b = fetchTargetOf(
    "https://race.boatcast.jp/txt/04/bc_oriten_20261027_04_01.txt",
  );
  check(
    "(b) ホストは www を外し、パスの数字の並びは {n}（クエリは含めない）",
    a.host === "boatrace.jp" &&
      a.path === "/owpc/pc/race/oddstf" &&
      b.host === "race.boatcast.jp" &&
      b.path === "/txt/{n}/bc_oriten_{n}_{n}_{n}.txt",
    show({ a, b }),
  );
}
// (c)
{
  const x = jstDayHour(new Date("2026-10-27T15:30:00Z"));
  const y = jstDayHour(T);
  check(
    "(c) JST の日・時",
    x.day === "2026-10-28" &&
      x.hour === 0 &&
      y.day === "2026-10-27" &&
      y.hour === 15,
    show({ x, y }),
  );
}
// (d)
{
  const counter = createFetchCounter({
    client: null,
    source: "vercel",
    now: () => T,
  });
  const responses = [429, 429, 200];
  const f = createPoliteFetch({
    breaker: createCircuitBreaker({ now: () => T.getTime() }),
    counter,
    sleep: async () => {},
    canaryUrls: {},
    fetchImpl: async () =>
      new Response("x", { status: responses.shift() ?? 200 }),
  });
  await f("https://www.boatrace.jp/owpc/pc/race/oddstf?rno=1");
  const g = createPoliteFetch({
    counter,
    sleep: async () => {},
    maxRetries: 1,
    fetchImpl: async () => {
      throw new Error("ECONNRESET");
    },
  });
  await g("https://www.boatrace.jp/owpc/pc/race/odds3t?rno=1").catch(() => {});
  const rows = counter.snapshot().rows;
  const get = (p, kind) =>
    rows.find((r) => r.path === p && r.kind === kind)?.count ?? 0;
  check(
    "(d) politeFetch は1回の fetch ごとに数える（429 の再試行2件・成功1件・接続の失敗の再試行込み2件）",
    get("/owpc/pc/race/oddstf", "overload") === 2 &&
      get("/owpc/pc/race/oddstf", "ok") === 1 &&
      get("/owpc/pc/race/odds3t", "network") === 2 &&
      rows.every(
        (r) => r.source === "vercel" && r.day === "2026-10-27" && r.hour === 15,
      ),
    show(rows),
  );
  // カナリアも数える
  const c2 = createFetchCounter({
    client: null,
    source: "vercel",
    now: () => T,
  });
  const h = createPoliteFetch({
    breaker: createCircuitBreaker({ now: () => T.getTime() }),
    counter: c2,
    sleep: async () => {},
    fetchImpl: async (url) =>
      new Response("x", { status: url.includes("beforeinfo") ? 403 : 200 }),
  });
  const warn = console.warn;
  console.warn = () => {};
  await h("https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno=1").catch(
    () => {},
  );
  console.warn = warn;
  const r2 = c2.snapshot().rows;
  check(
    "(d) 403 のカナリア（race/index）も数える",
    r2.some(
      (r) => r.path === "/owpc/pc/race/beforeinfo" && r.kind === "blocked",
    ) && r2.some((r) => r.path === "/owpc/pc/race/index" && r.kind === "ok"),
    show(r2),
  );
}
// (e)
{
  const calls = [];
  const results = [];
  const client = {
    async rpc(name, args) {
      calls.push({
        name,
        rows: args.p_rows.map((r) => ({ ...r })),
        minutes: (args.p_minutes ?? []).map((r) => ({ ...r })),
      });
      return results.shift() ?? { data: 1, error: null };
    },
  };
  const counter = createFetchCounter({
    client,
    source: "vercel",
    now: () => T,
    logger: silent,
  });
  await counter.flush();
  check("(e) 何も数えていなければ書かない", calls.length === 0);
  counter.add({
    url: "https://www.boatrace.jp/owpc/pc/race/oddstf?rno=1",
    status: 200,
  });
  counter.add({
    url: "https://www.boatrace.jp/owpc/pc/race/oddstf?rno=2",
    status: 200,
  });
  counter.add({
    url: "https://www.boatrace.jp/owpc/pc/race/odds3t?rno=2",
    status: 200,
  });
  results.push({
    data: null,
    error: { code: "57014", message: "statement timeout" },
  });
  const failed = await counter.flush();
  check(
    "(e) 書けなかったら投げずに持ち越す",
    failed === 0 &&
      counter.snapshot().pendingFetches === 3 &&
      calls.length === 1,
    show(counter.snapshot()),
  );
  const ok = await counter.flush();
  check(
    "(e) 次の flush で1回の RPC でまとめて足す（同じキーは1行に）",
    ok === 2 &&
      calls.length === 2 &&
      calls[1].name === "add_fetch_counts" &&
      calls[1].rows.find((r) => r.path === "/owpc/pc/race/oddstf")?.count ===
        2 &&
      counter.snapshot().pendingFetches === 0,
    show(calls[1]),
  );
  results.push({
    data: null,
    error: {
      code: "PGRST202",
      message:
        "Could not find the function public.add_fetch_counts(p_rows) in the schema cache",
    },
  });
  counter.add({
    url: "https://www.boatrace.jp/owpc/pc/race/oddstf?rno=3",
    status: 200,
  });
  await counter.flush();
  counter.add({
    url: "https://www.boatrace.jp/owpc/pc/race/oddstf?rno=4",
    status: 200,
  });
  const after = await counter.flush();
  check(
    "(e) RPC が無い（185 の前）なら、そのプロセスでは数えるのをやめる",
    counter.snapshot().disabled === true && after === 0 && calls.length === 3,
    show(counter.snapshot()),
  );
}
// (f)
{
  const c = { t: T.getTime() };
  let written = 0;
  const counter = createFetchCounter({
    client: { rpc: async () => (written++, { data: 1, error: null }) },
    source: "live",
    now: () => new Date(c.t),
  });
  for (let i = 0; i < 19; i++)
    counter.add({
      url: "https://www.boatrace.jp/owpc/pc/race/oddstf",
      status: 200,
    });
  await counter.maybeFlush();
  const before = written;
  counter.add({
    url: "https://www.boatrace.jp/owpc/pc/race/oddstf",
    status: 200,
  });
  await counter.maybeFlush();
  const at20 = written;
  counter.add({
    url: "https://www.boatrace.jp/owpc/pc/race/oddstf",
    status: 200,
  });
  c.t += 59_000;
  await counter.maybeFlush();
  const at59s = written;
  c.t += 1_000;
  await counter.maybeFlush();
  check(
    "(f) maybeFlush は20件か60秒で書く",
    before === 0 && at20 === 1 && at59s === 1 && written === 2,
    show({ before, at20, at59s, written }),
  );
}
// (g)
{
  let PGlite;
  try {
    ({ PGlite } = await import("@electric-sql/pglite"));
  } catch {
    console.error("@electric-sql/pglite が見つかりません（npm ci で入る）");
    process.exit(2);
  }
  const db = new PGlite();
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;",
  );
  await db.exec(
    fs.readFileSync(
      path.join(__dirname, "../../docs/db-migration/185_fetch_counts.sql"),
      "utf8",
    ),
  );
  const add = async (rows, minutes = []) =>
    (
      await db.query(
        "SELECT public.add_fetch_counts($1::jsonb, $2::jsonb) AS n",
        [JSON.stringify(rows), JSON.stringify(minutes)],
      )
    ).rows[0].n;
  const base = {
    day: "2026-10-27",
    hour: 15,
    host: "boatrace.jp",
    path: "/owpc/pc/race/oddstf",
    kind: "ok",
    source: "vercel",
  };
  const n1 = await add([
    { ...base, count: 5 },
    { ...base, kind: "overload", count: 2 },
    { ...base, kind: "blocked", count: 0 },
  ]);
  const mBase = { day: "2026-10-27", minute: 905, host: "boatrace.jp", source: "vercel" };
  const n2 = await add(
    [
      { ...base, count: 3 },
      { ...base, hour: 16, count: 4 },
    ],
    [
      { ...mBase, count: 3 },
      { ...mBase, count: 2 },
      { ...mBase, minute: 906, count: 0 },
    ],
  );
  await add([{ ...base, kind: "timeout", count: 1 }], [{ ...mBase, count: 1 }]);
  const minutes = (
    await db.query("SELECT minute, count FROM public.fetch_counts_minute ORDER BY minute")
  ).rows;
  const daily = (
    await db.query(
      "SELECT * FROM public.fetch_counts_daily('2026-10-27'::date)",
    )
  ).rows;
  const ok = daily.find((r) => r.kind === "ok");
  const rls = (
    await db.query(
      "SELECT bool_and(relrowsecurity) AS ok FROM pg_class WHERE oid IN ('public.fetch_counts'::regclass, 'public.fetch_counts_minute'::regclass)",
    )
  ).rows[0].ok;
  const can = async (role, fn) =>
    (
      await db.query(
        `SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE') AS ok`,
      )
    ).rows[0].ok;
  check(
    "(g) 185: 同じキーは加算、count 0 は無視、日の合計は時をまたいで SUM",
    n1 === 2 && n2 === 2 && Number(ok?.total) === 12 && daily.length === 3,
    show({ n1, n2, daily }),
  );
  check(
    "(g) 185: 分の表にも同じ RPC で足す（同じ分は加算、count 0 は無視）。kind に timeout を受ける",
    show(minutes) === show([{ minute: 905, count: 6 }]) && daily.some((r) => r.kind === "timeout"),
    show({ minutes, daily }),
  );
  check(
    "(g) 185: RLS 有効。anon・authenticated は実行できず、service_role は実行できる",
    rls === true &&
      (await can("anon", "public.add_fetch_counts(jsonb,jsonb)")) === false &&
      (await can("authenticated", "public.fetch_counts_daily(date)")) ===
        false &&
      (await can("service_role", "public.add_fetch_counts(jsonb,jsonb)")) === true,
  );
}
// (h)
{
  process.env.CRON_SECRET = "test-secret";
  const mkRes = () => {
    const res = { code: null, body: null };
    res.status = (c) => ((res.code = c), res);
    res.json = (b) => ((res.body = b), res);
    return res;
  };
  const rpcCalls = [];
  const client = {
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return { data: 1, error: null };
    },
  };
  const mkStore = () =>
    createMemoryStore({
      rows: {
        race_status: {
          job: "race_status",
          mode: "live",
          consecutive_failures: 0,
        },
      },
    });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html></html>", { status: 200 });
  try {
    const fetching = createScrapeCronHandler({
      job: "race_status",
      run: async (ctx) => {
        await ctx.politeFetch(
          "https://www.boatrace.jp/owpc/pc/race/pitreport?rno=1&jcd=04&hd=20261027",
        );
        return { rowsWritten: 1, rowsExpected: 1, rowsParsed: 1 };
      },
      createStore: mkStore,
      getClient: async () => client,
    });
    await fetching(
      { headers: { authorization: "Bearer test-secret" }, query: {} },
      mkRes(),
    );
    const afterFetch = rpcCalls.filter(
      (c) => c.name === "add_fetch_counts",
    ).length;
    const idle = createScrapeCronHandler({
      job: "race_status",
      run: async () => ({ rowsWritten: 0, rowsExpected: 0, rowsParsed: 0 }),
      createStore: mkStore,
      getClient: async () => client,
    });
    await idle(
      { headers: { authorization: "Bearer test-secret" }, query: {} },
      mkRes(),
    );
    const afterIdle = rpcCalls.filter(
      (c) => c.name === "add_fetch_counts",
    ).length;
    check(
      "(h) Cron の共通の口: 取得した起動の終わりに1回足し（source=vercel）、取得0の起動は書かない",
      afterFetch === 1 &&
        afterIdle === 1 &&
        rpcCalls.find((c) => c.name === "add_fetch_counts")?.args.p_rows[0]
          ?.source === "vercel",
      show(rpcCalls),
    );
  } finally {
    globalThis.fetch = realFetch;
  }
}

// (i) オッズの口（createOddsCronHandlerWithPredictionOdds）も数える（185 の審査 P1-1）
{
  const { createOddsCronHandlerWithPredictionOdds } = await import(
    "../lib/scrapeJobs/predictionOddsHandlers.js"
  );
  process.env.CRON_SECRET = "test-secret";
  const rpcCalls = [];
  const client = {
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return { data: 1, error: null };
    },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html></html>", { status: 200 });
  try {
    const handler = createOddsCronHandlerWithPredictionOdds({
      getClient: async () => client,
      createStore: () =>
        createMemoryStore({
          rows: { odds: { job: "odds", mode: "live", consecutive_failures: 0 } },
          slots: [
            { job: "odds", race_id: "2026-10-27-04-01", offset_min: -30, attempts: 1, last_attempt_at: new Date().toISOString() },
          ],
        }),
      createSlotHandler: () => async (_slot, ctx) => {
        await ctx.politeFetch("https://www.boatrace.jp/owpc/pc/race/oddstf?rno=1&jcd=04&hd=20261027");
        return { outcome: "ok", rowsWritten: 0 };
      },
    });
    const res = { status: (c) => ((res.code = c), res), json: (b) => ((res.body = b), res) };
    await handler({ headers: { authorization: "Bearer test-secret" }, query: {} }, res);
    const adds = rpcCalls.filter((c) => c.name === "add_fetch_counts");
    check(
      "(i) オッズの口も、取得した起動の終わりに add_fetch_counts を呼ぶ",
      adds.length === 1 && adds[0].args.p_rows[0]?.path === "/owpc/pc/race/oddstf",
      show({ rpcCalls, body: res.body }),
    );
  } finally {
    globalThis.fetch = realFetch;
  }
}

// (j) 呼び出し側の中断は数えない。自前の打ち切りは timeout（185 の審査 P2-3）
{
  const counter = createFetchCounter({ client: null, source: "vercel", now: () => T });
  const hang = (url, init) =>
    new Promise((_, reject) =>
      init.signal.addEventListener("abort", () =>
        reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
      ),
    );
  const ctrl = new AbortController();
  const f = createPoliteFetch({ counter, maxRetries: 0, timeoutMs: 50, fetchImpl: hang });
  const p1 = f("https://www.boatrace.jp/owpc/pc/race/oddstf?rno=1", { signal: ctrl.signal }).catch(() => {});
  ctrl.abort();
  await p1;
  await f("https://www.boatrace.jp/owpc/pc/race/odds3t?rno=1").catch(() => {});
  const rows = counter.snapshot().rows;
  check(
    "(j) 呼び出し側の中断は数えず、自前の打ち切り（timeoutMs）は timeout として数える",
    !rows.some((r) => r.path === "/owpc/pc/race/oddstf") &&
      rows.some((r) => r.path === "/owpc/pc/race/odds3t" && r.kind === "timeout"),
    show(rows),
  );
}

// (k) 20件で裏で書く（関数の打ち切りで溜まった分を全部失わない。185 の審査 P2-2）
{
  let written = 0;
  const counter = createFetchCounter({
    client: { rpc: async () => ((written++), { data: 1, error: null }) },
    source: "vercel",
    now: () => T,
  });
  for (let i = 0; i < 20; i++) counter.add({ url: "https://www.boatrace.jp/owpc/pc/race/oddstf", status: 200 });
  await new Promise((r) => setTimeout(r, 0));
  check("(k) 20件で、flush を待たずに裏で書く", written === 1 && counter.snapshot().pendingFetches === 0, show({ written }));
}

// (l) add の自動 flush が実行中なら、maybeFlush はその RPC の完了まで待つ（waitUntil が待てる。Codex の P1）
{
  let release;
  const gate = new Promise((r) => (release = r));
  let done = false;
  const counter = createFetchCounter({
    client: {
      rpc: async () => {
        await gate;
        done = true;
        return { data: 1, error: null };
      },
    },
    source: "live",
    now: () => T,
  });
  for (let i = 0; i < 20; i++)
    counter.add({ url: "https://www.boatrace.jp/owpc/pc/race/oddstf", status: 200 });
  let settled = false;
  const waited = counter.maybeFlush().then(() => (settled = true));
  await new Promise((r) => setTimeout(r, 0));
  const beforeRelease = settled;
  release();
  await waited;
  check(
    "(l) 自動 flush の RPC が終わるまで maybeFlush は解決しない（終わった後に解決する）",
    beforeRelease === false && settled === true && done === true,
    show({ beforeRelease, settled, done }),
  );
}

if (failures > 0) {
  console.error(`\n❌ ${failures}件の失敗`);
  process.exit(1);
}
console.log("\n✅ すべて成功");
