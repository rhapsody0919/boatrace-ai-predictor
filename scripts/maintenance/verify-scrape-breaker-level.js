/**
 * 403 のブレーカーの段階（breaker_level・breaker_opened_at、マイグレーション178）の検証（BOA-1145 の P4a ②、
 * docs/design/scraping-load-budget/spec.md §5.1・§5.2、ADR-0101 決定5）。DB・ネットワークに接続しない。
 *
 *   (a) 開く期間: 30分→1時間→2時間→4時間→6時間（上限）
 *   (b) 段階の下げ: 最後に開いてから24時間ごとに1段下げる（成功1回で0にしない）
 *   (c) 段階は DB に残り、別の起動（別プロセス）も同じ段階から上げる（以前は起動ごとに30分へ戻っていた）
 *   (d) 24時間 403 が無かった後の 403 は、下げた段階＋1
 *   (e) 閉じた後24時間の絞り: isThrottled は、開いている間は false、閉じた時刻から24時間 true、その後 false（遅れて閉じても同じ。審査 P2-3）
 *   (f) 共通ラッパ: 絞りの間は claimLimit を半分（切り上げ）で claim し、応答に throttled を出す。絞りでなければ上書きしない
 *   (g) store: 403 の open は段階と時刻も書く・178 の前（PGRST204）は段階を外して書き直す・429 の open は段階を書かない・
 *       read は段階を返す
 *   (h) 半開の試行が成功して閉じても、段階は消えない（下げるのは時間だけ）
 *   (i) 別の起動の 429 の開放が、403 で開いたホストの長い期限を短く上書きしない（審査 P2-1）
 *   (j) close は閉じた時刻（breaker_closed_at）も書く。178 の前は外して書き直す
 *
 * 実行: node scripts/maintenance/verify-scrape-breaker-level.js
 */
import {
  blockDurationMs,
  createCircuitBreaker,
  effectiveBlockLevel,
} from "../lib/scrapeJobs/circuitBreaker.js";
import { createSupabaseStore } from "../lib/scrapeJobs/store.js";
import { createMemoryStore } from "../lib/scrapeJobs/testing/memoryStore.js";
import {
  runScrapeJob,
  throttledClaimLimit,
} from "../lib/scrapeJobs/cronWrapper.js";

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
const HOUR = 60 * MIN;
const KEY = "host:boatrace.jp/owpc/pc/race/beforeinfo";
const T0 = Date.parse("2026-10-26T06:50:00Z");

// (a)
{
  const seq = [1, 2, 3, 4, 5, 6].map((l) =>
    blockDurationMs(l, 30 * MIN, 6 * HOUR),
  );
  check(
    "(a) 開く期間は 30分→1時間→2時間→4時間→6時間（上限）",
    show(seq) ===
      show([30 * MIN, HOUR, 2 * HOUR, 4 * HOUR, 6 * HOUR, 6 * HOUR]),
    show(seq),
  );
  const c = { t: T0 };
  const b = createCircuitBreaker({ now: () => c.t });
  const opened = [];
  for (let i = 0; i < 6; i++) {
    await b.recordBlocked(KEY);
    opened.push((b.snapshot(KEY).openUntil - c.t) / MIN);
    c.t = b.snapshot(KEY).openUntil + 1; // 期限の後（半開）に次の 403
  }
  check(
    "(a) 既定の recordBlocked も同じ順（上限6時間）。段階は期間が上限に届く5で止める（下げに余計な日数をかけない）",
    show(opened) === show([30, 60, 120, 240, 360, 360]) &&
      b.snapshot(KEY).level === 5,
    show({ opened, level: b.snapshot(KEY).level }),
  );
  const h = createCircuitBreaker({ now: () => c.t });
  const hostOpened = [];
  for (let i = 0; i < 5; i++) {
    await h.recordBlocked("host:boatrace.jp");
    hostOpened.push((h.snapshot("host:boatrace.jp").openUntil - c.t) / MIN);
    c.t = h.snapshot("host:boatrace.jp").openUntil + 1;
  }
  check(
    "(a) ホスト全体のキーは 60分→2時間→4時間→6時間、段階は4で止める",
    show(hostOpened) === show([60, 120, 240, 360, 360]) &&
      h.snapshot("host:boatrace.jp").level === 4,
    show({ hostOpened, level: h.snapshot("host:boatrace.jp").level }),
  );
}

// (b)
{
  const D = 24 * HOUR;
  const r = [
    effectiveBlockLevel(3, T0, T0 + 23 * HOUR, D),
    effectiveBlockLevel(3, T0, T0 + D, D),
    effectiveBlockLevel(3, T0, T0 + 3 * D, D),
    effectiveBlockLevel(3, T0, T0 + 10 * D, D),
    effectiveBlockLevel(0, T0, T0, D),
    effectiveBlockLevel(2, 0, T0, D),
  ];
  check(
    "(b) 24時間ごとに1段下げる（23時間は3のまま・24時間で2・72時間で0・下限0）。開いた時刻が無ければ段階のまま",
    show(r) === show([3, 2, 0, 0, 0, 2]),
    show(r),
  );
}

// (c)(d)(h) 別の起動と DB の段階
{
  const c = { t: T0 };
  const store = createMemoryStore();
  const mk = () =>
    createCircuitBreaker({ store: store.breakerStore, now: () => c.t });
  const a = mk();
  await a.check(KEY);
  await a.recordBlocked(KEY);
  check(
    "(c) 1回目の 403: 段階1・30分。DB に段階と時刻が残る",
    store.breakerStore.levels[KEY]?.level === 1 &&
      store.breakerStore.levels[KEY]?.openedAtMs === T0 &&
      store.breakerStore.byKey[KEY] === T0 + 30 * MIN,
    show(store.breakerStore),
  );
  // 次の起動（別プロセス）: 30分後の半開の試行が 403
  c.t = T0 + 30 * MIN + 1;
  const b = mk();
  await b.check(KEY); // 半開の試行を予約
  await b.recordBlocked(KEY);
  check(
    "(c) 別の起動の半開の試行が 403: DB の段階1から上げて段階2・1時間（起動ごとに30分へ戻らない）",
    store.breakerStore.levels[KEY]?.level === 2 &&
      store.breakerStore.byKey[KEY] === c.t + HOUR,
    show(store.breakerStore),
  );
  // 1時間後: 次の起動の半開の試行が成功して閉じる
  c.t += HOUR + 1;
  const d = mk();
  await d.check(KEY);
  await d.recordSuccess(KEY);
  check(
    "(h) 半開の試行が成功して閉じても、段階は消えない",
    !(KEY in store.breakerStore.byKey) &&
      store.breakerStore.levels[KEY]?.level === 2 &&
      d.snapshot(KEY).level === 2,
    show({ store: store.breakerStore, snap: d.snapshot(KEY) }),
  );
  // 最後に開いてから24時間と少し後に 403: 下げた段階1＋1＝2（1時間）
  const lastOpened = store.breakerStore.levels[KEY].openedAtMs;
  c.t = lastOpened + 24 * HOUR + MIN;
  const e = mk();
  await e.check(KEY);
  await e.recordBlocked(KEY);
  check(
    "(d) 24時間 403 が無かった後の 403: 1段下げた段階（1）＋1＝段階2・1時間",
    store.breakerStore.levels[KEY]?.level === 2 &&
      store.breakerStore.byKey[KEY] === c.t + HOUR,
    show(store.breakerStore),
  );
  // 48時間あまり 403 が無ければ0まで下がり、次の 403 は30分から
  c.t += 49 * HOUR;
  const f = mk();
  await f.check(KEY);
  await f.recordBlocked(KEY);
  check(
    "(d) 48時間以上 403 が無ければ段階0まで下がり、次の 403 は段階1・30分",
    store.breakerStore.levels[KEY]?.level === 1 &&
      store.breakerStore.byKey[KEY] === c.t + 30 * MIN,
    show(store.breakerStore),
  );
}

// (e) 絞り
{
  const c = { t: T0 };
  const store = createMemoryStore();
  const b = createCircuitBreaker({
    store: store.breakerStore,
    now: () => c.t,
  });
  await b.recordBlocked(KEY); // 段階1: 30分
  const during = b.isThrottled(KEY);
  c.t = T0 + 31 * MIN;
  await b.check(KEY).catch(() => {});
  await b.recordSuccess(KEY); // 半開の試行が成功して閉じた
  const after = b.isThrottled(KEY);
  c.t = T0 + 31 * MIN + 24 * HOUR - 1;
  const lastMoment = b.isThrottled(KEY);
  c.t = T0 + 31 * MIN + 24 * HOUR;
  const ended = b.isThrottled(KEY);
  const fresh = createCircuitBreaker({ now: () => c.t });
  // 審査 P2-3: 段階4で開いた後、30時間あけて人が再開した（期限を今にした）ときも、閉じた時刻から24時間絞る
  const c2 = { t: T0 };
  const store2 = createMemoryStore();
  store2.breakerStore.levels[KEY] = { level: 4, openedAtMs: T0 };
  store2.breakerStore.byKey[KEY] = T0 + 30 * HOUR; // 人が期限を今にする時刻
  c2.t = T0 + 30 * HOUR;
  const other = createCircuitBreaker({
    store: store2.breakerStore,
    now: () => c2.t,
  });
  await other.check(KEY); // 半開の試行を予約
  await other.recordSuccess(KEY);
  c2.t += 23 * HOUR;
  const another = createCircuitBreaker({
    store: store2.breakerStore,
    now: () => c2.t,
  });
  await another.check(KEY);
  const lateClose = another.isThrottled(KEY);
  check(
    "(e) 遅れて閉じても、閉じた時刻（breaker_closed_at、別の起動も読む）から24時間は絞る",
    lateClose === true && store2.breakerStore.closedAt[KEY] === T0 + 30 * HOUR,
    show(store2.breakerStore),
  );
  check(
    "(e) 絞り: 開いている間は false、閉じた後24時間は true、その後 false、403 を受けていないキーは false",
    during === false &&
      after === true &&
      lastMoment === true &&
      ended === false &&
      fresh.isThrottled(KEY) === false,
    show({ during, after, lastMoment, ended }),
  );
}

// (f) 共通ラッパ
{
  const c = { t: T0 + 2 * HOUR };
  const mkRun = async (levels, closedAt = {}) => {
    const store = createMemoryStore({
      rows: { exhibition: { job: "exhibition", mode: "live" } },
    });
    Object.assign(store.breakerStore.levels, levels);
    Object.assign(store.breakerStore.closedAt, closedAt);
    const r = await runScrapeJob({
      job: "exhibition",
      store,
      handleSlot: async () => ({ outcome: "ok" }),
      now: () => new Date(c.t),
      worker: "w-test",
    });
    return { r, claim: store.calls.find((x) => x.name === "claimSlots") };
  };
  const t1 = await mkRun(
    { [KEY]: { level: 1, openedAtMs: T0 } },
    { [KEY]: T0 + 31 * MIN },
  );
  check(
    "(f) 絞りの間は claimLimit を半分（exhibition 8→4）で claim し、応答に throttled を出す",
    t1.claim?.limit === 4 &&
      t1.r.body.claimLimit === 4 &&
      show(t1.r.body.throttled) === show([KEY]),
    show(t1),
  );
  const t2 = await mkRun({});
  check(
    "(f) 絞りでなければ claimLimit を上書きしない",
    t2.claim && !("limit" in t2.claim) && !("throttled" in t2.r.body),
    show(t2),
  );
  check(
    "(f) 半分は切り上げ・1未満にしない",
    throttledClaimLimit(1) === 1 &&
      throttledClaimLimit(7) === 4 &&
      throttledClaimLimit(32) === 16,
  );
}

// (g) store
{
  const mkClient = (responses) => {
    const log = [];
    const client = {
      // 184 の前（scrape_breaker_open が無い）の形で、upsert に戻る経路を確かめる
      rpc: async () => ({
        data: null,
        error: {
          code: "PGRST202",
          message: "Could not find the function public.scrape_breaker_open(p_job, p_level, p_opened_at, p_reason, p_until) in the schema cache",
        },
      }),
      from() {
        const q = {
          select(cols) {
            q.cols = cols;
            return q;
          },
          eq() {
            return q;
          },
          async maybeSingle() {
            log.push({ op: "select", cols: q.cols });
            return responses.shift();
          },
          async upsert(payload) {
            log.push({ op: "upsert", payload });
            return responses.shift() ?? { error: null };
          },
        };
        return q;
      },
    };
    return { client, log };
  };
  {
    const { client, log } = mkClient([{ error: null }]);
    await createSupabaseStore(client).breakerStore.open(KEY, T0, "HTTP 403", {
      level: 2,
      openedAtMs: T0,
    });
    const p = log[0].payload;
    check(
      "(g) 403 の open は段階と時刻も書く（fetch_stop・mode は書かない）",
      p.breaker_level === 2 &&
        p.breaker_opened_at === new Date(T0).toISOString() &&
        !("fetch_stop" in p) &&
        !("mode" in p),
      show(log),
    );
  }
  {
    const { client, log } = mkClient([
      {
        error: {
          code: "PGRST204",
          message:
            "Could not find the 'breaker_level' column of 'scrape_job_state' in the schema cache",
        },
      },
      { error: null },
    ]);
    await createSupabaseStore(client).breakerStore.open(KEY, T0, "HTTP 403", {
      level: 1,
      openedAtMs: T0,
    });
    check(
      "(g) 178 の前（段階の列が無い）は段階を外して書き直す（期限は残る）",
      log.length === 2 &&
        !("breaker_level" in log[1].payload) &&
        log[1].payload.breaker_open_until === new Date(T0).toISOString(),
      show(log),
    );
  }
  {
    const { client, log } = mkClient([
      { error: { code: "23514", message: "violates check constraint" } },
    ]);
    let err = null;
    try {
      await createSupabaseStore(client).breakerStore.open(KEY, T0, "HTTP 403", {
        level: 1,
        openedAtMs: T0,
      });
    } catch (e) {
      err = e;
    }
    check(
      "(g) 列の不在でないエラーは書き直さずに投げる",
      err instanceof Error && log.length === 1,
      show(log),
    );
  }
  {
    const { client, log } = mkClient([{ error: null }]);
    await createSupabaseStore(client).breakerStore.open(
      "host:boatrace.jp",
      T0,
      "HTTP 429",
    );
    check(
      "(g) 429/503 の open（段階なし）は段階の列を書かない",
      !("breaker_level" in log[0].payload) &&
        !("breaker_opened_at" in log[0].payload),
      show(log),
    );
  }
  {
    const { client, log } = mkClient([
      {
        data: {
          breaker_open_until: null,
          fetch_stop: false,
          breaker_level: 3,
          breaker_opened_at: new Date(T0).toISOString(),
        },
        error: null,
      },
    ]);
    const r = await createSupabaseStore(client).breakerStore.read(KEY);
    check(
      "(g) read は段階と開いた時刻を返す",
      r.level === 3 &&
        r.openedAtMs === T0 &&
        r.untilMs === 0 &&
        log[0].cols ===
          "breaker_open_until, fetch_stop, breaker_level, breaker_opened_at, breaker_closed_at",
      show({ r, log }),
    );
  }
  {
    const { client, log } = mkClient([
      {
        data: null,
        error: {
          code: "42703",
          message: "column scrape_job_state.breaker_level does not exist",
        },
      },
      { data: { breaker_open_until: null }, error: null },
    ]);
    const r = await createSupabaseStore(client).breakerStore.read(KEY);
    check(
      "(g) read: 178 の前は breaker_open_until だけを読み直し、段階0",
      r.level === 0 && r.openedAtMs === 0 && log.length === 2,
      show({ r, log }),
    );
  }
}

// (i) 審査 P2-1: 別の起動の 429 の開放が、403 で開いたホストの長い期限を短く上書きしない
{
  const c = { t: T0 };
  const store = createMemoryStore();
  const HOST = "host:boatrace.jp";
  const a = createCircuitBreaker({ store: store.breakerStore, now: () => c.t });
  await a.check(HOST); // A は「閉じている」を読んで TTL の間持つ
  const b = createCircuitBreaker({ store: store.breakerStore, now: () => c.t });
  await b.recordBlocked(HOST, "canary HTTP 403"); // B がホストを60分開く
  c.t += 2000;
  for (let i = 0; i < 3; i++) await a.recordFailure(HOST, "HTTP 429");
  check(
    "(i) 別の起動の 429 の開放は、DB の長い期限（403 の60分）を短く上書きしない",
    store.breakerStore.byKey[HOST] === T0 + 60 * MIN &&
      a.snapshot(HOST).openUntil === T0 + 60 * MIN,
    show({ db: store.breakerStore.byKey, a: a.snapshot(HOST) }),
  );
}
// (j) close が閉じた時刻を書く・178 の前は外して書き直す
{
  const log = [];
  const responses = [
    {
      error: {
        code: "PGRST204",
        message:
          "Could not find the 'breaker_closed_at' column of 'scrape_job_state' in the schema cache",
      },
    },
    { error: null },
  ];
  const client = {
    from() {
      return {
        update(p) {
          log.push(p);
          return { eq: async () => responses.shift() };
        },
      };
    },
  };
  await createSupabaseStore(client).breakerStore.close(KEY, { closedAtMs: T0 });
  check(
    "(j) close は breaker_closed_at も書き、178 の前は外して書き直す",
    log.length === 2 &&
      log[0].breaker_closed_at === new Date(T0).toISOString() &&
      log[0].breaker_open_until === null &&
      !("breaker_closed_at" in log[1]),
    show(log),
  );
}

if (failures > 0) {
  console.error(`\n❌ ${failures}件の失敗`);
  process.exit(1);
}
console.log("\n✅ すべて成功");
