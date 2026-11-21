/**
 * verify-fetch-counter.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-fetch-counter.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import fs from "node:fs";
import path from "node:path";
import { createFetchCounter } from "../../lib/scrapeJobs/fetchCounter.js";
import { createPoliteFetch } from "../../lib/scrapeJobs/politeFetch.js";
import { createScrapeCronHandler } from "../../lib/scrapeJobs/cronWrapper.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";

let __dirname, check, show, T;

async function scene1() {
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
}

async function scene2() {
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
}

async function scene3() {
  // (i) オッズの口（createOddsCronHandlerWithPredictionOdds）も数える（185 の審査 P1-1）
  {
    const { createOddsCronHandlerWithPredictionOdds } = await import(
      "../../lib/scrapeJobs/predictionOddsHandlers.js"
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
}

async function scene4() {
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（__dirname・check・show・T） */
export async function runFetchCounterScenes1(env) {
  ({ __dirname, check, show, T } = env);
  await scene1();
  await scene2();
  await scene3();
  await scene4();
}
