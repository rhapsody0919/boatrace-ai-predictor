/**
 * 半開の試行を、起動（プロセス）をまたいで全体で1件にする予約の検証（BOA-1145 P4a ④c、spec §5.2）。DB・ネットワークに接続しない。
 * 予約は scrape_job_state の条件つき UPDATE（breaker_open_until が読んだ値のままの行だけを、今＋2分に進める）。
 *
 *   (a) 期限の後に2つの起動が同時に試そうとしても、DB で予約できた1つだけが試す。もう1つは開いている扱い
 *   (b) DB の期限がマイクロ秒つき（人が now() で入れた）でも、読んだ文字列のままで条件にするので予約できる
 *   (c) 予約した試行が成功して閉じたら、別の起動も（TTL の後に）取れる
 *   (d) 予約した試行が接続の失敗で終わったら、予約の期限（2分）の後に、別の起動がもう一度予約できる
 *   (e) 予約の口が失敗（DB の障害）したら、従来どおりプロセスの中の1件で試す
 *   (f) 開いているかだけを見る check（reserve:false）は予約しない（共通ラッパの起動の前の確認）
 *   (g) store.breakerStore.reserveProbe: job と breaker_open_until（読んだ文字列）の両方を条件にした UPDATE。1行で true・0行で false・エラーは投げる
 *   (h) politeFetch: パスが開いているときは、ホストの半開の試行を予約しない（全体の試行を止めない）
 *   (i) 開放の書き込みが失敗しても、読み直しで自分の開放を DB の古い値で消さない（審査 P2-1）
 *   (j) 予約した試行が閉じるとき、その間に別の起動が開き直していれば閉じない（条件つきの close。審査 P2-2）
 *   (k) store.breakerStore.close: expectedRaw があれば breaker_open_until を条件にし、0行なら false
 *
 * 実行: node scripts/maintenance/verify-scrape-probe-reserve.js
 */
import {
  BreakerOpenError,
  createCircuitBreaker,
} from "../lib/scrapeJobs/circuitBreaker.js";
import { createPoliteFetch, pathKeyOf } from "../lib/scrapeJobs/politeFetch.js";
import { createSupabaseStore } from "../lib/scrapeJobs/store.js";

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

/** DB の行を文字列で持つ偽のストア（PostgREST が返す形。条件つき UPDATE は文字列の一致で判定する） */
const mkDb = () => {
  const rows = {};
  const log = [];
  const store = {
    rows,
    log,
    failReserve: false,
    async read(k) {
      const raw = rows[k] ?? null;
      return {
        untilMs: raw ? Date.parse(raw) : 0,
        fetchStop: false,
        untilRaw: raw,
      };
    },
    async open(k, untilMs) {
      rows[k] = new Date(untilMs).toISOString();
    },
    async close(k, closed) {
      // 本物と同じく、expectedRaw があれば期限がその値（同じ時刻）のときだけ閉じる
      if (closed?.expectedRaw && Date.parse(rows[k] ?? "") !== Date.parse(closed.expectedRaw)) return false;
      rows[k] = null;
      return true;
    },
    async reserveProbe(k, expectedRaw, newUntilMs) {
      log.push(["reserve", k, expectedRaw]);
      if (store.failReserve) throw new Error("db down");
      if (rows[k] !== expectedRaw) return false;
      rows[k] = new Date(newUntilMs).toISOString();
      return true;
    },
  };
  return store;
};
const tryCheck = (b, key, opts) =>
  b.check(key, opts).then(
    (r) => r ?? "closed",
    (e) => e,
  );

// (a)
{
  const c = { t: T0 };
  const db = mkDb();
  db.rows[HOST] = new Date(T0 - 1000).toISOString(); // 期限は過ぎている
  const a = createCircuitBreaker({ store: db, now: () => c.t });
  const b = createCircuitBreaker({ store: db, now: () => c.t });
  const [ra, rb] = await Promise.all([tryCheck(a, HOST), tryCheck(b, HOST)]);
  const probes = [ra, rb].filter((r) => r?.probe === true).length;
  const opens = [ra, rb].filter((r) => r instanceof BreakerOpenError).length;
  check(
    "(a) 2つの起動が同時に半開を試しても、DB で予約できた1つだけが試し、もう1つは開いている扱い（DB の期限は今＋2分）",
    probes === 1 &&
      opens === 1 &&
      db.rows[HOST] === new Date(T0 + 2 * MIN).toISOString(),
    show({ ra, rb, row: db.rows[HOST] }),
  );
}

// (b)
{
  const c = { t: T0 };
  const db = mkDb();
  db.rows[HOST] = "2026-10-27T02:59:59.123456+00:00";
  const a = createCircuitBreaker({ store: db, now: () => c.t });
  const r = await tryCheck(a, HOST);
  check(
    "(b) DB の期限がマイクロ秒つきでも、読んだ文字列のままで条件にして予約できる",
    r?.probe === true && db.log[0]?.[2] === "2026-10-27T02:59:59.123456+00:00",
    show({ r, log: db.log }),
  );
}

// (c)
{
  const c = { t: T0 };
  const db = mkDb();
  db.rows[HOST] = new Date(T0 - 1000).toISOString();
  const a = createCircuitBreaker({ store: db, now: () => c.t });
  const b = createCircuitBreaker({ store: db, now: () => c.t });
  await tryCheck(a, HOST);
  const blocked = await tryCheck(b, HOST);
  await a.recordSuccess(HOST);
  c.t += 10_001; // b の TTL の後
  const after = await tryCheck(b, HOST);
  check(
    "(c) 予約した試行が成功して閉じたら、別の起動も TTL の後に取れる",
    blocked instanceof BreakerOpenError &&
      after === "closed" &&
      db.rows[HOST] === null,
    show({ blocked: String(blocked), after, row: db.rows[HOST] }),
  );
}

// (d)
{
  const c = { t: T0 };
  const db = mkDb();
  db.rows[HOST] = new Date(T0 - 1000).toISOString();
  const a = createCircuitBreaker({ store: db, now: () => c.t });
  await tryCheck(a, HOST);
  a.abortProbe(HOST); // 接続の失敗
  const b = createCircuitBreaker({ store: db, now: () => c.t });
  const early = await tryCheck(b, HOST);
  c.t += 2 * MIN + 1;
  const b2 = createCircuitBreaker({ store: db, now: () => c.t });
  const later = await tryCheck(b2, HOST);
  check(
    "(d) 予約した試行が終わらなかったら、予約の期限（2分）の間は他は待ち、その後に別の起動が予約できる",
    early instanceof BreakerOpenError && later?.probe === true,
    show({ early: String(early), later }),
  );
}

// (e)
{
  const c = { t: T0 };
  const db = mkDb();
  db.rows[HOST] = new Date(T0 - 1000).toISOString();
  db.failReserve = true;
  const a = createCircuitBreaker({ store: db, now: () => c.t });
  const warn = console.warn;
  console.warn = () => {};
  const r1 = await tryCheck(a, HOST);
  const r2 = await tryCheck(a, HOST);
  console.warn = warn;
  check(
    "(e) 予約の口が失敗したら、プロセスの中の1件で試す（2件目は開いている扱い）",
    r1?.probe === true && r2 instanceof BreakerOpenError,
    show({ r1, r2: String(r2) }),
  );
}

// (f)
{
  const c = { t: T0 };
  const db = mkDb();
  db.rows[HOST] = new Date(T0 - 1000).toISOString();
  const a = createCircuitBreaker({ store: db, now: () => c.t });
  const r = await tryCheck(a, HOST, { reserve: false });
  check(
    "(f) reserve:false の check は予約しない（DB を触らない）",
    r === "closed" && db.log.length === 0 && a.snapshot(HOST).probing === false,
    show({ r, log: db.log }),
  );
}

// (g)
{
  const mkClient = (result) => {
    const calls = [];
    const client = {
      from(table) {
        const q = {
          update(patch) {
            calls.push({ table, patch, eq: [] });
            return q;
          },
          eq(col, val) {
            calls.at(-1).eq.push([col, val]);
            return q;
          },
          async select(cols) {
            calls.at(-1).select = cols;
            return result;
          },
        };
        return q;
      },
    };
    return { client, calls };
  };
  const raw = "2026-10-27T02:59:59.123456+00:00";
  const one = mkClient({ data: [{ job: HOST }], error: null });
  const ok = await createSupabaseStore(one.client).breakerStore.reserveProbe(
    HOST,
    raw,
    T0 + 2 * MIN,
  );
  const zero = mkClient({ data: [], error: null });
  const ng = await createSupabaseStore(zero.client).breakerStore.reserveProbe(
    HOST,
    raw,
    T0,
  );
  const bad = mkClient({
    data: null,
    error: { code: "57014", message: "timeout" },
  });
  let err = null;
  try {
    await createSupabaseStore(bad.client).breakerStore.reserveProbe(
      HOST,
      raw,
      T0,
    );
  } catch (e) {
    err = e;
  }
  const call = one.calls[0];
  check(
    "(g) reserveProbe: job と読んだ文字列の breaker_open_until を条件にした UPDATE。1行で true・0行で false・エラーは投げる",
    ok === true &&
      ng === false &&
      err instanceof Error &&
      call.table === "scrape_job_state" &&
      call.patch.breaker_open_until === new Date(T0 + 2 * MIN).toISOString() &&
      show(call.eq) ===
        show([
          ["job", HOST],
          ["breaker_open_until", raw],
        ]) &&
      !("fetch_stop" in call.patch) &&
      !("mode" in call.patch),
    show(one.calls),
  );
}

// (h)
{
  const c = { t: T0 };
  const db = mkDb();
  const BEFORE = "https://www.boatrace.jp/owpc/pc/race/beforeinfo";
  db.rows[HOST] = new Date(T0 - 1000).toISOString(); // ホストは半開
  db.rows[pathKeyOf(BEFORE)] = new Date(T0 + 30 * MIN).toISOString(); // パスは開いている
  const breaker = createCircuitBreaker({ store: db, now: () => c.t });
  let fetched = 0;
  const f = createPoliteFetch({
    breaker,
    now: () => c.t,
    sleep: async () => {},
    fetchImpl: async () => (fetched++, new Response("ok")),
  });
  const e = await f(`${BEFORE}?rno=1`).catch((x) => x);
  check(
    "(h) パスが開いているときは、ホストの半開の試行を予約しない（ホストの期限は動かない・取得もしない）",
    e instanceof BreakerOpenError &&
      fetched === 0 &&
      db.log.length === 0 &&
      db.rows[HOST] === new Date(T0 - 1000).toISOString(),
    show({ e: String(e), log: db.log, row: db.rows[HOST] }),
  );
}

// (i)
{
  const c = { t: T0 };
  const KEY = "host:boatrace.jp/owpc/pc/race/beforeinfo";
  const warn = console.warn;
  console.warn = () => {};
  const b = createCircuitBreaker({
    store: {
      read: async () => ({ untilMs: 0, fetchStop: false, untilRaw: null }),
      open: async () => {
        throw new Error("db down");
      },
      close: async () => true,
    },
    now: () => c.t,
  });
  await b.check(KEY);
  await b.recordBlocked(KEY);
  c.t += 11_000;
  const r = await tryCheck(b, KEY);
  console.warn = warn;
  check(
    "(i) 開放の書き込みが失敗しても、11秒後の読み直しで自分の開放を消さない",
    r instanceof BreakerOpenError,
    String(r),
  );
}

// (j)
{
  const c = { t: T0 };
  const db = mkDb();
  db.rows[HOST] = new Date(T0 - 1000).toISOString();
  const a = createCircuitBreaker({ store: db, now: () => c.t });
  const cc = createCircuitBreaker({ store: db, now: () => c.t });
  await tryCheck(a, HOST); // A が予約してカナリアを取る
  await cc.recordBlocked(HOST, "canary HTTP 403"); // その間に C がホストを60分開く
  await a.recordSuccess(HOST); // A のカナリアは 200
  c.t += 11_000;
  const r = await tryCheck(cc, HOST);
  const ra = await tryCheck(a, HOST);
  check(
    "(j) 予約した試行が閉じるとき、その間に別の起動が開き直していれば閉じない（C も A も開いている扱い）",
    r instanceof BreakerOpenError &&
      ra instanceof BreakerOpenError &&
      db.rows[HOST] === new Date(T0 + 60 * MIN).toISOString(),
    show({ r: String(r), ra: String(ra), row: db.rows[HOST] }),
  );
}

// (k)
{
  const calls = [];
  const mkClient = (result) => ({
    from() {
      const q = {
        update(patch) {
          calls.push({ patch, eq: [] });
          return q;
        },
        eq(col, val) {
          calls.at(-1).eq.push([col, val]);
          return q;
        },
        async select() {
          return result;
        },
      };
      return q;
    },
  });
  const raw = "2026-10-27T03:02:00.000Z";
  const ok = await createSupabaseStore(mkClient({ data: [{ job: HOST }], error: null })).breakerStore.close(HOST, {
    closedAtMs: T0,
    expectedRaw: raw,
  });
  const ng = await createSupabaseStore(mkClient({ data: [], error: null })).breakerStore.close(HOST, {
    closedAtMs: T0,
    expectedRaw: raw,
  });
  check(
    "(k) close は expectedRaw があれば breaker_open_until を条件にし、1行で true・0行で false",
    ok === true &&
      ng === false &&
      show(calls[0].eq) === show([["job", HOST], ["breaker_open_until", raw]]) &&
      calls[0].patch.breaker_open_until === null,
    show(calls),
  );
}

if (failures > 0) {
  console.error(`\n❌ ${failures}件の失敗`);
  process.exit(1);
}
console.log("\n✅ すべて成功");
