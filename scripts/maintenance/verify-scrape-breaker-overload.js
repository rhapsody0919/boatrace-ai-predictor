/**
 * 429/503 のブレーカーの段階化と Retry-After の検証（BOA-1145 P4a ④b、docs/design/scraping-load-budget/spec.md §5.1）。
 * DB・ネットワークに接続しない。
 *
 *   (a) 連続の 429 で開く期間は段階で 5分→10分→20分→60分（上限）。段階は DB に残り、別の起動も同じ段階から上げる
 *   (b) Retry-After が10秒を超える 429 は再試行せず、ホストをその時間開いて応答を返す。次の取得は叩かない
 *   (c) Retry-After の上限は60分
 *   (d) Retry-After が10秒以下なら従来どおり待って再試行する
 *   (e) 403 で上がったホストの段階（4）を、429 で下げない
 *
 * 実行: node scripts/maintenance/verify-scrape-breaker-overload.js
 */
import {
  BreakerOpenError,
  createCircuitBreaker,
} from "../lib/scrapeJobs/circuitBreaker.js";
import { createPoliteFetch } from "../lib/scrapeJobs/politeFetch.js";
import { createMemoryStore } from "../lib/scrapeJobs/testing/memoryStore.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? `\n   ${detail}` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);
const MIN = 60_000;
const HOST = "host:boatrace.jp";
const T0 = Date.parse("2026-10-27T03:00:00Z");
const ODDS =
  "https://www.boatrace.jp/owpc/pc/race/oddstf?rno=1&jcd=04&hd=20261027";

// (a)
{
  const c = { t: T0 };
  const store = createMemoryStore();
  const mk = () =>
    createCircuitBreaker({ store: store.breakerStore, now: () => c.t });
  const opened = [];
  let b = mk();
  for (let i = 0; i < 3; i++) await b.recordFailure(HOST, "HTTP 429");
  opened.push((store.breakerStore.byKey[HOST] - c.t) / MIN);
  for (let i = 0; i < 4; i++) {
    c.t = store.breakerStore.byKey[HOST] + 1;
    b = mk(); // 起動ごとに別のプロセス
    await b.check(HOST); // 半開の試行を予約
    await b.recordFailure(HOST, "HTTP 429"); // 試行も 429
    opened.push((store.breakerStore.byKey[HOST] - c.t) / MIN);
  }
  check(
    "(a) 429 で開く期間は段階で 5分→10分→20分→60分→60分。段階は DB に残り、起動をまたいで上がる",
    show(opened) === show([5, 10, 20, 60, 60]) &&
      store.breakerStore.levels[HOST]?.level === 4,
    show({ opened, levels: store.breakerStore.levels }),
  );
}

const setup = (responses) => {
  const c = { t: T0 };
  const store = createMemoryStore();
  const breaker = createCircuitBreaker({
    store: store.breakerStore,
    now: () => c.t,
  });
  const fetched = [];
  const sleeps = [];
  const f = createPoliteFetch({
    breaker,
    now: () => c.t,
    random: () => 0,
    sleep: async (ms) => void sleeps.push(ms),
    canaryUrls: {},
    fetchImpl: async (url) => {
      fetched.push(url);
      const r = responses.shift() ?? { status: 200 };
      return new Response("x", { status: r.status, headers: r.headers ?? {} });
    },
  });
  return { c, store, breaker, fetched, sleeps, f };
};

// (b)
{
  const s = setup([{ status: 429, headers: { "retry-after": "300" } }]);
  const r = await s.f(ODDS);
  let next;
  try {
    await s.f(ODDS);
  } catch (e) {
    next = e;
  }
  check(
    "(b) Retry-After 300秒の 429: 再試行せず応答を返し、ホストを300秒・段階1で開く。次の取得は叩かない",
    r.status === 429 &&
      s.sleeps.length === 0 &&
      s.fetched.length === 1 &&
      s.store.breakerStore.byKey[HOST] === T0 + 300_000 &&
      s.store.breakerStore.levels[HOST]?.level === 1 &&
      next instanceof BreakerOpenError,
    show({
      status: r.status,
      sleeps: s.sleeps,
      fetched: s.fetched.length,
      db: s.store.breakerStore,
    }),
  );
}

// (c)
{
  const s = setup([{ status: 503, headers: { "retry-after": "7200" } }]);
  await s.f(ODDS);
  check(
    "(c) Retry-After の上限は60分",
    s.store.breakerStore.byKey[HOST] === T0 + 60 * MIN,
    show(s.store.breakerStore),
  );
}

// (d)
{
  const s = setup([
    { status: 429, headers: { "retry-after": "4" } },
    { status: 200 },
  ]);
  const r = await s.f(ODDS);
  check(
    "(d) Retry-After 4秒は従来どおり待って再試行し、ホストは開かない",
    r.status === 200 &&
      show(s.sleeps) === show([4000]) &&
      !(HOST in s.store.breakerStore.byKey),
    show({ sleeps: s.sleeps, db: s.store.breakerStore }),
  );
}

// (e)
{
  const c = { t: T0 };
  const store = createMemoryStore();
  store.breakerStore.levels[HOST] = { level: 4, openedAtMs: T0 - HOUR() };
  const b = createCircuitBreaker({ store: store.breakerStore, now: () => c.t });
  await b.recordRetryAfter(HOST, 120_000, "HTTP 429 Retry-After 120s");
  check(
    "(e) 403 で上がったホストの段階（4）を、429 で下げない",
    store.breakerStore.levels[HOST]?.level === 4 &&
      store.breakerStore.byKey[HOST] === T0 + 120_000,
    show(store.breakerStore),
  );
}
function HOUR() {
  return 60 * MIN;
}

if (failures > 0) {
  console.error(`\n❌ ${failures}件の失敗`);
  process.exit(1);
}
console.log("\n✅ すべて成功");
