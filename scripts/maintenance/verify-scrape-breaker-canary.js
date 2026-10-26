/**
 * 403 のカナリアとホストの半開・403 の記録の検証（BOA-1145 の P4a ③、docs/design/scraping-load-budget/spec.md §5.1・§5.3、
 * ADR-0101 決定5）。DB・ネットワークに接続しない。
 *
 *   (a) 403 の記録: Server・server-timing・Akamai の参照番号（数値文字参照も読む）・本文の先頭200字。500字に収まる
 *   (b) パスが 403 で開いたら race/index を1件取る。200 ならホストは開かない
 *   (c) カナリアも 403 ならホスト全体を開く（60分、段階1）。記録に canary と応答の要約
 *   (d) 同じプロセスで 403 が重なっても、カナリアは1件だけ
 *   (e) ホストの半開の試行は race/index で行う。200 で閉じてから要求されたページを取る。403 なら段階2（2時間）で開き直し、
 *       要求されたページは取らない
 *   (f) 429 で開いたホストの半開も race/index で試す
 *   (g) カナリアを載せていないホスト（BOATCAST）は、従来どおり要求されたページで半開を試し、403 でもカナリアを取らない
 *
 * 実行: node scripts/maintenance/verify-scrape-breaker-canary.js
 */
import {
  BreakerOpenError,
  createCircuitBreaker,
} from "../lib/scrapeJobs/circuitBreaker.js";
import {
  createPoliteFetch,
  describeBlockedResponse,
  pathKeyOf,
} from "../lib/scrapeJobs/politeFetch.js";

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
const BEFORE = "https://www.boatrace.jp/owpc/pc/race/beforeinfo";
const INDEX = "https://www.boatrace.jp/owpc/pc/race/index";
const ODDS =
  "https://www.boatrace.jp/owpc/pc/race/oddstf?rno=1&jcd=04&hd=20261026";
const AKAMAI_BODY =
  '<HTML><HEAD>\n<TITLE>Access Denied</TITLE>\n</HEAD><BODY>\n<H1>Access Denied</H1>\n \nYou don\'t have permission to access "http&#58;&#47;&#47;www&#46;boatrace&#46;jp&#47;owpc&#47;pc&#47;race&#47;beforeinfo&#63;" on this server.<P>\nReference&#32;&#35;18&#46;5f3e2f17&#46;1761461400&#46;a1b2c3d\n<P>https&#58;&#47;&#47;errors&#46;edgesuite&#46;net&#47;18&#46;5f3e2f17</P>\n</BODY>\n</HTML>\n';
const akamai403 = () =>
  new Response(AKAMAI_BODY, {
    status: 403,
    headers: {
      server: "AkamaiGHost",
      "server-timing":
        'cdn-cache; desc=HIT, edge; dur=1, ak_p; desc="1761461400_388";dur=1',
    },
  });
const mkResponse = (status) =>
  status === 403 ? akamai403() : new Response("ok", { status });
const silence = async (fn) => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = warn;
  }
};
const mkStore = () => {
  const db = { byKey: {}, levels: {}, reasons: {} };
  return {
    db,
    async read(k) {
      return {
        untilMs: db.byKey[k] ?? 0,
        fetchStop: false,
        level: db.levels[k]?.level ?? 0,
        openedAtMs: db.levels[k]?.openedAtMs ?? 0,
      };
    },
    async open(k, until, reason, level) {
      db.byKey[k] = until;
      db.reasons[k] = reason;
      if (level) db.levels[k] = level;
    },
    async close(k) {
      delete db.byKey[k];
    },
  };
};
const setup = (statusOf) => {
  const clock = { t: Date.parse("2026-10-26T06:50:00Z") };
  const store = mkStore();
  const breaker = createCircuitBreaker({ store, now: () => clock.t });
  const fetched = [];
  const f = createPoliteFetch({
    breaker,
    now: () => clock.t,
    sleep: async () => {},
    fetchImpl: async (url) => {
      fetched.push(url);
      return mkResponse(statusOf(url));
    },
  });
  const tryFetch = (url) => silence(() => f(url).catch((e) => e));
  return { clock, store, breaker, fetched, tryFetch };
};

// (a)
{
  const line = await describeBlockedResponse(akamai403());
  check(
    "(a) 403 の記録に Server・server-timing・参照番号・本文の先頭を残し、500字に収まる",
    line.startsWith(
      "HTTP 403 | server: AkamaiGHost | server-timing: cdn-cache",
    ) &&
      line.includes("ref: 18.5f3e2f17.1761461400.a1b2c3d") &&
      /body: Access Denied Access Denied You don't have permission/.test(
        line,
      ) &&
      line.length <= 500,
    line,
  );
  const bare = await describeBlockedResponse(
    new Response(null, { status: 403 }),
  );
  check("(a) 本文・ヘッダが無くても形が崩れない", bare === "HTTP 403", bare);
}

// (b)
{
  const s = setup((url) => (url.startsWith(BEFORE) ? 403 : 200));
  const e = await s.tryFetch(`${BEFORE}?rno=1&jcd=04&hd=20261026`);
  check(
    "(b) パスの 403 の後に race/index を1件取り、200 ならホストは開かない",
    e instanceof BreakerOpenError &&
      show(s.fetched) === show([`${BEFORE}?rno=1&jcd=04&hd=20261026`, INDEX]) &&
      !(HOST in s.store.db.byKey) &&
      s.store.db.byKey[pathKeyOf(BEFORE)] === s.clock.t + 30 * MIN &&
      /server: AkamaiGHost/.test(s.store.db.reasons[pathKeyOf(BEFORE)]),
    show({ fetched: s.fetched, db: s.store.db }),
  );
  const odds = await s.tryFetch(ODDS);
  check(
    "(b) 他のページは取れる",
    odds instanceof Response && odds.status === 200,
  );
}

// (c)
{
  const s = setup(() => 403);
  await s.tryFetch(`${BEFORE}?rno=1`);
  check(
    "(c) カナリアも 403 ならホスト全体を60分・段階1で開き、記録に canary と応答の要約",
    s.store.db.byKey[HOST] === s.clock.t + 60 * MIN &&
      s.store.db.levels[HOST]?.level === 1 &&
      /^canary HTTP 403 \| server: AkamaiGHost/.test(s.store.db.reasons[HOST]),
    show(s.store.db),
  );
  const before = s.fetched.length;
  const odds = await s.tryFetch(ODDS);
  check(
    "(c) ホストが開いたら他のページも取らない",
    odds instanceof BreakerOpenError && s.fetched.length === before,
  );
}

// (d)
{
  const clock = { t: Date.parse("2026-10-26T06:50:00Z") };
  const breaker = createCircuitBreaker({ now: () => clock.t });
  const fetched = [];
  const f = createPoliteFetch({
    breaker,
    now: () => clock.t,
    sleep: async () => {},
    fetchImpl: async (url) => {
      fetched.push(url);
      await new Promise((r) => setTimeout(r, 5));
      return mkResponse(url.startsWith(BEFORE) ? 403 : 200);
    },
  });
  await silence(() =>
    Promise.all([1, 2, 3].map((n) => f(`${BEFORE}?rno=${n}`).catch(() => {}))),
  );
  check(
    "(d) 同時に3件の 403 が届いても、カナリアは1件だけ",
    fetched.filter((u) => u === INDEX).length === 1,
    show(fetched),
  );
}

// (e)
{
  const s = setup((url) => (url === INDEX ? s.indexStatus : 200));
  s.indexStatus = 200;
  await s.breaker.recordBlocked(HOST, "canary HTTP 403"); // 段階1・60分
  s.clock.t += 60 * MIN + 1;
  const r = await s.tryFetch(ODDS);
  check(
    "(e) ホストの半開は race/index で試し、200 で閉じてから要求されたページを取る",
    r instanceof Response &&
      r.status === 200 &&
      show(s.fetched) === show([INDEX, ODDS]) &&
      !(HOST in s.store.db.byKey) &&
      s.breaker.snapshot(HOST).openUntil === 0,
    show({ fetched: s.fetched, db: s.store.db }),
  );

  const s2 = setup((url) => (url === INDEX ? 403 : 200));
  await s2.breaker.recordBlocked(HOST, "canary HTTP 403");
  s2.clock.t += 60 * MIN + 1;
  const r2 = await s2.tryFetch(ODDS);
  check(
    "(e) 半開の race/index が 403 なら段階2（2時間）で開き直し、要求されたページは取らない",
    r2 instanceof BreakerOpenError &&
      show(s2.fetched) === show([INDEX]) &&
      s2.store.db.levels[HOST]?.level === 2 &&
      s2.store.db.byKey[HOST] === s2.clock.t + 120 * MIN,
    show({ fetched: s2.fetched, db: s2.store.db }),
  );
}

// (f)
{
  const s = setup(() => 200);
  for (let i = 0; i < 3; i++) await s.breaker.recordFailure(HOST, "HTTP 429");
  s.clock.t += 60_001;
  const r = await s.tryFetch(ODDS);
  check(
    "(f) 429 で開いたホストの半開も race/index で試す",
    r instanceof Response && show(s.fetched) === show([INDEX, ODDS]),
    show(s.fetched),
  );
}

// (g)
{
  const BC = "https://race.boatcast.jp/txt/04/bc_oriten_20261026_04_01.txt";
  const s = setup(() => 403);
  for (let i = 0; i < 3; i++)
    await s.breaker.recordFailure("host:race.boatcast.jp", "HTTP 429");
  s.clock.t += 60_001;
  const r = await s.tryFetch(BC);
  check(
    "(g) カナリアの無いホスト（BOATCAST）は要求されたページで半開を試し、403 でもカナリアを取らない（未公開の 403 は通常）",
    r instanceof Response && r.status === 403 && show(s.fetched) === show([BC]),
    show(s.fetched),
  );
}

if (failures > 0) {
  console.error(`\n❌ ${failures}件の失敗`);
  process.exit(1);
}
console.log("\n✅ すべて成功");
