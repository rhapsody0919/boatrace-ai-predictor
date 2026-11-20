/**
 * verify-scrape-jobs.js の後半の場面（2/9）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-jobs.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { BreakerOpenError, createCircuitBreaker } from "../../lib/scrapeJobs/circuitBreaker.js";
import { DEFAULT_USER_AGENT, createPoliteFetch, parseRetryAfterMs } from "../../lib/scrapeJobs/politeFetch.js";
import { fetchHtml as fetchPcexpectHtml } from "../../daily/scrape-pcexpect.js";

let check, same, show;

export const mkResponse = (status, body = "<html></html>", headers = {}) =>
  new Response(status === 204 ? null : body, { status, headers });

export const noSleep = () => Promise.resolve();

/** 元の verify の1つの塊 { } を割った 1/3 */
async function scene1() {
  const HOST = "host:boatrace.jp";
  const clock = { t: 1_000_000 };
  const storeLog = [];
  const store = {
    until: 0,
    async read() {
      return store.until;
    },
    async open(host, until, reason) {
      store.until = until;
      storeLog.push(["open", host, until, reason]);
    },
    async close(host) {
      store.until = 0;
      storeLog.push(["close", host]);
    },
  };
  const mk = (over = {}) =>
    createCircuitBreaker({ store, now: () => clock.t, ...over });
  const openError = async (breaker) => {
    try {
      await breaker.check(HOST);
      return null;
    } catch (e) {
      return e;
    }
  };
  let b = mk();
  await b.check(HOST);
  check("初期状態は閉じている（storeへの書き込みなし）", storeLog.length === 0);
  // 連続3件で開く
  await b.recordFailure(HOST, "HTTP 429");
  await b.recordFailure(HOST, "HTTP 503");
  check("連続2件ではまだ開かない", (await openError(b)) === null);
  await b.recordFailure(HOST, "HTTP 429");
  const e1 = await openError(b);
  check(
    "連続3件の 429/503 で開く（5分。段階1）",
    e1 instanceof BreakerOpenError && e1.until === clock.t + 5 * 60_000,
    String(e1?.until),
  );
  check(
    "開いたことがDBに記録される",
    storeLog.length === 1 &&
      storeLog[0][0] === "open" &&
      storeLog[0][1] === HOST,
  );
  // 別プロセス（新しいbreaker）にも、DBの状態で共有される
  const other = mk({ readTtlMs: 0 });
  check(
    "別プロセスのブレーカーも、DBの状態で開いている扱い",
    (await openError(other)) instanceof BreakerOpenError,
  );
  // 半開: 期限後、1件だけ試行できる
  clock.t += 5 * 60_000 + 1;
  await b.check(HOST);
   // 試行を予約
  const e2 = await openError(b);
  check(
    "半開中の2件目は、まだ開いている扱い（試行は1件だけ）",
    e2 instanceof BreakerOpenError,
  );
  return { HOST, clock, storeLog, store, mk, openError, b };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
async function scene2({ HOST, clock, storeLog, store, mk, openError, b }) {
  // 試行が成功 → 閉じる
  await b.recordSuccess(HOST);
  check(
    "半開の試行が成功すると閉じる（DBも解除）",
    (await openError(b)) === null && storeLog.at(-1)[0] === "close",
  );
  // 半開の試行が失敗 → 期間が2倍
  b = mk();
  store.until = 0;
  for (let i = 0; i < 3; i++) await b.recordFailure(HOST);
  clock.t += 5 * 60_000 + 1;
  await b.check(HOST);
  await b.recordFailure(HOST);
  const e3 = await openError(b);
  check(
    "半開の試行が失敗すると段階が上がり10分開く",
    e3 instanceof BreakerOpenError && e3.until === clock.t + 10 * 60_000,
    String(e3?.until - clock.t),
  );
  // 直近2分に5件（連続ではない）で開く
  b = mk();
  store.until = 0;
  for (let i = 0; i < 4; i++) {
    await b.recordFailure(HOST);
    if (i < 2) await b.recordSuccess(HOST); // 連続を切る
  }
  // 上のループで連続は最大2。5件目
  const beforeOpen = await openError(b);
  await b.recordFailure(HOST);
  await b.recordSuccess(HOST);
  await b.recordFailure(HOST);
  // 直近2分に 4+1+... 件。閾値5に達している
  check(
    "連続でなくても、直近2分に5件の 429/503 で開く",
    beforeOpen === null && (await openError(b)) instanceof BreakerOpenError,
  );
  // 2分より古い失敗は数えない
  b = mk();
  store.until = 0;
  for (let i = 0; i < 2; i++) {
    await b.recordFailure(HOST);
    await b.recordSuccess(HOST);
  }
  clock.t += 121_000;
  for (let i = 0; i < 2; i++) {
    await b.recordFailure(HOST);
    await b.recordSuccess(HOST);
  }
  check("2分より古い失敗は数えない", (await openError(b)) === null);
  // 試行が終わらなかった（ネットワークエラー）場合、印を外して再試行できる
  b = mk();
  store.until = 0;
  for (let i = 0; i < 3; i++) await b.recordFailure(HOST);
  clock.t += 5 * 60_000 + 1;
  await b.check(HOST);
  return { HOST, clock, openError, b };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
async function scene3({ HOST, clock, openError, b }) {
  b.abortProbe(HOST);
  check(
    "試行がネットワークエラーで終わったら、次の呼び出しが再び試行できる",
    (await openError(b)) === null,
  );
  // storeが壊れていても、プロセス内の状態で縮退して動く
  const broken = createCircuitBreaker({
    now: () => clock.t,
    store: {
      async read() {
        throw new Error("db down");
      },
      async open() {
        throw new Error("db down");
      },
      async close() {
        throw new Error("db down");
      },
    },
    readTtlMs: 0,
  });
  await broken.check(HOST);
  for (let i = 0; i < 3; i++) await broken.recordFailure(HOST);
  check(
    "storeのエラーでは例外を投げず、プロセス内の状態で開く",
    (await openError(broken)) instanceof BreakerOpenError,
  );
}

async function scene4() {
  {
    const s1 = await scene1();
    const s2 = await scene2(s1);
    await scene3(s2);
  }
  // ---------------------------------------------------------------------------
  // (g) politeFetch
  // ---------------------------------------------------------------------------
  {
    const originalFetch = globalThis.fetch;
    const calls = [];
    try {
      globalThis.fetch = async (url, init) => {
        calls.push({ url, headers: new Headers(init.headers) });
        return new Response("pcexpect-body");
      };
      const url = "https://www.boatrace.jp/owpc/pc/race/pcexpect?hd=20261026&jcd=01&rno=1";
      const html = await fetchPcexpectHtml(url);
      check(
        "pcexpect の送信 User-Agent は politeFetch の DEFAULT_USER_AGENT と一致する",
        calls.length === 1 &&
          calls[0].url === url &&
          calls[0].headers.get("user-agent") === DEFAULT_USER_AGENT &&
          html === "pcexpect-body",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
  // 正常
  {
    const calls = [];
    const f = createPoliteFetch({
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return mkResponse(200, "ok-body");
      },
      sleep: noSleep,
    });
    const res = await f(
      "https://www.boatrace.jp/owpc/pc/race/raceresult?rno=1",
    );
    check(
      "正常: 本文を読み込み済みの Response を返し、UAを付ける",
      res.status === 200 &&
        (await res.text()) === "ok-body" &&
        calls[0].init.headers.get("user-agent") === DEFAULT_USER_AGENT &&
        calls[0].init.signal instanceof AbortSignal,
    );
    const custom = createPoliteFetch({
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return mkResponse(200);
      },
    });
    await custom("https://www.boatrace.jp/", {
      headers: { "User-Agent": "X/1" },
    });
    check(
      "UAを指定した場合はそれを使う",
      calls.at(-1).init.headers.get("user-agent") === "X/1",
    );
  }
  // 429 → 200
  {
    const sleeps = [];
    let n = 0;
    const f = createPoliteFetch({
      fetchImpl: async () => (n++ < 1 ? mkResponse(429) : mkResponse(200)),
      sleep: async (ms) => void sleeps.push(ms),
      random: () => 0,
    });
    const res = await f("https://www.boatrace.jp/a");
    check(
      "429 を1回受けてから成功: 1秒待って再試行",
      res.status === 200 && n === 2 && same(sleeps, [1000]),
      show({ n, sleeps }),
    );
  }
}

async function scene5() {
  // 503が続く → 2回まで再試行して503を返す（指数）
  {
    const sleeps = [];
    let n = 0;
    const f = createPoliteFetch({
      fetchImpl: async () => (n++, mkResponse(503)),
      sleep: async (ms) => void sleeps.push(ms),
      random: () => 0,
    });
    const res = await f("https://www.boatrace.jp/a");
    check(
      "503 が続く: 最大2回再試行（1秒→2秒）し、503のまま返す",
      res.status === 503 && n === 3 && same(sleeps, [1000, 2000]),
      show({ n, sleeps }),
    );
  }
  // Retry-After
  {
    const sleeps = [];
    let n = 0;
    const f = createPoliteFetch({
      fetchImpl: async () =>
        n++ === 0
          ? mkResponse(429, "x", { "retry-after": "4" })
          : n === 2
            ? mkResponse(429, "x", { "retry-after": "120" })
            : mkResponse(200),
      sleep: async (ms) => void sleeps.push(ms),
      random: () => 0,
    });
    const res = await f("https://www.boatrace.jp/a");
    check(
      "Retry-After を尊重する（4秒）。10秒を超える値（120秒）は再試行せず、その応答を返す（BOA-1145 P4a ④b）",
      same(sleeps, [4000]) && n === 2 && res.status === 429,
      show({ sleeps, n }),
    );
    check(
      "Retry-After の解釈（秒・HTTP日付・不正値）",
      parseRetryAfterMs("3") === 3000 &&
        parseRetryAfterMs(
          "Sun, 20 Sep 2026 00:00:10 GMT",
          Date.parse("2026-09-20T00:00:00Z"),
        ) === 10000 &&
        parseRetryAfterMs("abc") === null &&
        parseRetryAfterMs(null) === null,
    );
  }
  // 404など: 再試行せずそのまま返す
  {
    let n = 0;
    const f = createPoliteFetch({
      fetchImpl: async () => (n++, mkResponse(404, "nf")),
      sleep: noSleep,
    });
    const res = await f("https://www.boatrace.jp/a");
    check("404 は再試行せずそのまま返す", res.status === 404 && n === 1);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・same・show） */
export async function runScrapeJobsScenes2(env) {
  ({ check, same, show } = env);
  await scene4();
  await scene5();
}
