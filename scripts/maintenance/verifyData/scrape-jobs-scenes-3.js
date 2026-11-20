/**
 * verify-scrape-jobs.js の後半の場面（3/9）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-jobs.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { createCircuitBreaker, BreakerOpenError } from "../../lib/scrapeJobs/circuitBreaker.js";
import { createPoliteFetch, FetchError, hostKeyOf, pathKeyOf } from "../../lib/scrapeJobs/politeFetch.js";
import { noSleep, mkResponse } from "./scrape-jobs-scenes-2.js";

let check, show;

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene1() {
  const clock = { t: 7_000_000 };
  const breaker = createCircuitBreaker({ now: () => clock.t });
  const BEFORE = "https://www.boatrace.jp/owpc/pc/race/beforeinfo";
  const ODDS = "https://www.boatrace.jp/owpc/pc/race/odds3t";
  const fetched = [];
  let beforeStatus = 403;
  const f = createPoliteFetch({
    breaker,
    sleep: noSleep,
    // カナリア（race/index）は verify-scrape-breaker-canary.js で見る。ここではパス単位の動きだけ
    canaryUrls: {},
    fetchImpl: async (url) => {
      fetched.push(url);
      return mkResponse(url.startsWith(BEFORE) ? beforeStatus : 200);
    },
  });
  const tryFetch = async (url) => {
    try {
      return await f(url);
    } catch (e) {
      return e;
    }
  };
  const first = await tryFetch(`${BEFORE}?rno=1&jcd=04&hd=20261026`);
  check(
    "403（登録したパス beforeinfo）: 再試行せず（1回だけ取得）、そのパスのブレーカーが30分開き、BreakerOpenError（呼び出し側は breaker_open。連続失敗に数えない）",
    first instanceof BreakerOpenError &&
      first.until === clock.t + 30 * 60_000 &&
      fetched.length === 1 &&
      breaker.snapshot(pathKeyOf(BEFORE)).openUntil === clock.t + 30 * 60_000,
    show({ fetched, snap: breaker.snapshot(pathKeyOf(BEFORE)) }),
  );
  const rest = [];
  for (let i = 2; i <= 9; i++) {
    rest.push(await tryFetch(`${BEFORE}?rno=${i}&jcd=04&hd=20261026`));
  }
  check(
    "403 の後は、同じパスの残り（クエリ違いの別レース）を叩かず BreakerOpenError（1回の起動で9件が立て続けに 403 にならない）",
    rest.every((e) => e instanceof BreakerOpenError) && fetched.length === 1,
    show(fetched),
  );
  const odds = await tryFetch(`${ODDS}?rno=1&jcd=04&hd=20261026`);
  check(
    "403 のパスのブレーカーは、同じホストの他のページ（odds 等）を止めない。ホストのブレーカーも開かない",
    odds.status === 200 &&
      breaker.snapshot(hostKeyOf(BEFORE)).openUntil === 0 &&
      pathKeyOf(BEFORE) === "host:boatrace.jp/owpc/pc/race/beforeinfo",
    show(odds),
  );
  // 30分後: 半開で1件だけ。403 なら再び開き（同じプロセスでは期間2倍）、2件目は叩かない
  clock.t += 30 * 60_000 + 1;
  const before = fetched.length;
  const probe = await tryFetch(`${BEFORE}?rno=10&jcd=04&hd=20261026`);
  const afterProbe = await tryFetch(`${BEFORE}?rno=11&jcd=04&hd=20261026`);
  check(
    "半開: 期限後は1件だけ試す。403 なら再び開き（60分）、続く取得は叩かない",
    probe instanceof BreakerOpenError &&
      afterProbe instanceof BreakerOpenError &&
      fetched.length === before + 1 &&
      breaker.snapshot(pathKeyOf(BEFORE)).openUntil === clock.t + 60 * 60_000,
    show({ n: fetched.length - before }),
  );
  // さらに期限後、試行が成功すれば閉じ、以降は通常どおり
  clock.t += 60 * 60_000 + 1;
  beforeStatus = 200;
  const ok = await tryFetch(`${BEFORE}?rno=12&jcd=04&hd=20261026`);
  return { clock, breaker, BEFORE, tryFetch, ok };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene2({ clock, breaker, BEFORE, tryFetch, ok }) {
  const next = await tryFetch(`${BEFORE}?rno=1&jcd=05&hd=20261026`);
  check(
    "半開の試行が成功すると、そのパスのブレーカーは閉じ、以降は通常どおり取得できる",
    ok.status === 200 &&
      next.status === 200 &&
      breaker.snapshot(pathKeyOf(BEFORE)).openUntil === 0,
  );
  // 上限は6時間（30分→1時間→2時間→4時間→6時間。段階は verify-scrape-breaker-level.js）
  // 開いている間の 403 は段階を上げないので、毎回期限の後（半開）に受けたことにする
  const cc = { t: clock.t };
  const capped = createCircuitBreaker({ now: () => cc.t });
  let lastDuration = 0;
  for (let i = 0; i < 6; i++) {
    await capped.recordBlocked("k");
    lastDuration = capped.snapshot("k").openUntil - cc.t;
    cc.t = capped.snapshot("k").openUntil + 1;
  }
  check("403 で開く期間の上限は6時間", lastDuration === 6 * 60 * 60_000);
  // 別プロセス（新しいブレーカー）も、DB の期限で開いている扱い（パスのキーで共有）
  const log = [];
  const shared = { byKey: {} };
  const sharedStore = {
    async read(k) {
      return shared.byKey[k] ?? 0;
    },
    async open(k, until, reason) {
      shared.byKey[k] = until;
      log.push([k, reason]);
    },
    async close(k) {
      delete shared.byKey[k];
    },
  };
  const p1 = createPoliteFetch({
    canaryUrls: {},
    breaker: createCircuitBreaker({ store: sharedStore, now: () => clock.t }),
    sleep: noSleep,
    fetchImpl: async () => mkResponse(403),
  });
  await p1(`${BEFORE}?rno=1`).catch(() => {});
  let otherFetched = 0;
  const p2 = createPoliteFetch({
    canaryUrls: {},
    breaker: createCircuitBreaker({
      store: sharedStore,
      now: () => clock.t,
      readTtlMs: 0,
    }),
    sleep: noSleep,
    fetchImpl: async () => (otherFetched++, mkResponse(200)),
  });
  let err;
  try {
    await p2(`${BEFORE}?rno=2`);
  } catch (e) {
    err = e;
  }
  check(
    "403 で開いたパスのブレーカーは DB（scrape_job_state の host:…/beforeinfo の行）に書かれ、別の起動も叩かない",
    log.length === 1 &&
      log[0][0] === "host:boatrace.jp/owpc/pc/race/beforeinfo" &&
      /^HTTP 403\b/.test(log[0][1]) &&
      err instanceof BreakerOpenError &&
      otherFetched === 0,
    show(log),
  );
}

async function scene3() {
  // タイムアウト（ヘッダーが来ない・本文が止まる）
  {
    const f = createPoliteFetch({
      timeoutMs: 20,
      maxRetries: 1,
      sleep: noSleep,
      fetchImpl: (url, init) =>
        new Promise((_, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    });
    let err;
    try {
      await f("https://www.boatrace.jp/a");
    } catch (e) {
      err = e;
    }
    check(
      "タイムアウト: 再試行して、上限で FetchError（2回試行）",
      err instanceof FetchError && err.attempts === 2,
      String(err?.message),
    );

    const stallingBody = createPoliteFetch({
      timeoutMs: 20,
      maxRetries: 0,
      sleep: noSleep,
      fetchImpl: async (url, init) => ({
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        url,
        arrayBuffer: () =>
          new Promise((_, reject) => {
            init.signal.addEventListener("abort", () =>
              reject(
                Object.assign(new Error("aborted"), { name: "AbortError" }),
              ),
            );
          }),
      }),
    });
    let err2;
    try {
      await stallingBody("https://www.boatrace.jp/a");
    } catch (e) {
      err2 = e;
    }
    check(
      "本文の読み取りが止まってもタイムアウトする",
      err2 instanceof FetchError,
      String(err2?.message),
    );
  }
  // ネットワークエラー → 再試行して成功
  {
    let n = 0;
    const f = createPoliteFetch({
      sleep: noSleep,
      fetchImpl: async () => {
        if (n++ === 0) throw new TypeError("fetch failed");
        return mkResponse(200);
      },
    });
    check(
      "ネットワークエラーは再試行する",
      (await f("https://www.boatrace.jp/a")).status === 200 && n === 2,
    );
  }
}

async function scene4() {
  // 呼び出し側の signal を尊重する
  {
    const controller = new AbortController();
    controller.abort();
    let sawAborted = 0;
    const f = createPoliteFetch({
      maxRetries: 0,
      sleep: noSleep,
      fetchImpl: (url, init) =>
        new Promise((_, reject) => {
          if (init.signal.aborted) sawAborted++;
          init.signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
          if (init.signal.aborted) {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          }
        }),
    });
    let err;
    try {
      await f("https://www.boatrace.jp/a", { signal: controller.signal });
    } catch (e) {
      err = e;
    }
    check(
      "呼び出し側の init.signal が中断済みなら、取得を中断する（signal を上書きして無視しない）",
      err instanceof FetchError && sawAborted === 1,
      String(err?.message),
    );
  }
  // ブレーカー連携: 連続3件の429で開き、以降は取得しない
  {
    const clock = { t: 5_000_000 };
    const breaker = createCircuitBreaker({ now: () => clock.t });
    let fetched = 0;
    let fetchOk = false;
    const f = createPoliteFetch({
      breaker,
      sleep: noSleep,
      fetchImpl: async () => (fetched++, mkResponse(fetchOk ? 200 : 429)),
    });
    const res = await f("https://www.boatrace.jp/a"); // 3回試行して429、3件目でブレーカーが開く
    check(
      "429が3件続くとブレーカーが開く",
      res.status === 429 &&
        fetched === 3 &&
        breaker.snapshot(hostKeyOf("https://www.boatrace.jp/")).openUntil >
          clock.t,
    );
    let err;
    try {
      await f("https://www.boatrace.jp/b");
    } catch (e) {
      err = e;
    }
    check(
      "ブレーカーが開いている間は、取得せず BreakerOpenError",
      err instanceof BreakerOpenError && fetched === 3,
      String(err),
    );
    // 60秒後（半開）に、取得が成功すればブレーカーが閉じる
    clock.t += 5 * 60_000 + 1;
    fetchOk = true;
    const probe = await f("https://www.boatrace.jp/c");
    check(
      "半開の取得が成功するとブレーカーが閉じ、以降は通常どおり取得できる",
      probe.status === 200 &&
        breaker.snapshot(hostKeyOf("https://www.boatrace.jp/")).openUntil ===
          0 &&
        (await f("https://www.boatrace.jp/d")).status === 200,
    );
    check(
      "www・www1 等は同じホストのキー",
      hostKeyOf("https://www.boatrace.jp/x") === "host:boatrace.jp" &&
        hostKeyOf("https://www1.mbrace.or.jp/od2/K/") === "host:mbrace.or.jp",
    );
  }
  {
    const s1 = await scene1();
    await scene2(s1);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show） */
export async function runScrapeJobsScenes3(env) {
  ({ check, show } = env);
  await scene3();
  await scene4();
}
