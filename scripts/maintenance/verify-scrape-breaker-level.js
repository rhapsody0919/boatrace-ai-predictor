/**
 * 403 のブレーカーの段階（breaker_level・breaker_opened_at、マイグレーション178）の検証（BOA-1145 の P4a ②、
 * docs/design/scraping-load-budget/spec.md §5.1・§5.2、ADR-0101 決定5）。DB・ネットワークに接続しない。
 *
 *   (a) 開く期間: 30分→1時間→2時間→4時間→6時間（上限）
 *   (b) 段階の下げ: 最後に開いてから24時間ごとに1段下げる（成功1回で0にしない）
 *   (c) 段階は DB に残り、別の起動（別プロセス）も同じ段階から上げる（以前は起動ごとに30分へ戻っていた）
 *   (d) 24時間 403 が無かった後の 403 は、下げた段階＋1
 *   (e) 閉じた後24時間の絞り: isThrottled は、開いている間は false、閉じうる時刻から24時間 true、その後 false
 *   (f) 共通ラッパ: 絞りの間は claimLimit を半分（切り上げ）で claim し、応答に throttled を出す。絞りでなければ上書きしない
 *   (g) store: 403 の open は段階と時刻も書く・178 の前（PGRST204）は段階を外して書き直す・429 の open は段階を書かない・
 *       read は段階を返す
 *   (h) 半開の試行が成功して閉じても、段階は消えない（下げるのは時間だけ）
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
  }
  check(
    "(a) 既定の recordBlocked も同じ順（上限6時間）",
    show(opened) === show([30, 60, 120, 240, 360, 360]),
    show(opened),
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
  c.t = T0 + 30 * MIN + 24 * HOUR - 1;
  const lastMoment = b.isThrottled(KEY);
  c.t = T0 + 30 * MIN + 24 * HOUR;
  const ended = b.isThrottled(KEY);
  const fresh = createCircuitBreaker({ now: () => c.t });
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
  const mkRun = async (levels) => {
    const store = createMemoryStore({
      rows: { exhibition: { job: "exhibition", mode: "live" } },
    });
    Object.assign(store.breakerStore.levels, levels);
    const r = await runScrapeJob({
      job: "exhibition",
      store,
      handleSlot: async () => ({ outcome: "ok" }),
      now: () => new Date(c.t),
      worker: "w-test",
    });
    return { r, claim: store.calls.find((x) => x.name === "claimSlots") };
  };
  const t1 = await mkRun({ [KEY]: { level: 1, openedAtMs: T0 } });
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
          "breaker_open_until, fetch_stop, breaker_level, breaker_opened_at",
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

if (failures > 0) {
  console.error(`\n❌ ${failures}件の失敗`);
  process.exit(1);
}
console.log("\n✅ すべて成功");
