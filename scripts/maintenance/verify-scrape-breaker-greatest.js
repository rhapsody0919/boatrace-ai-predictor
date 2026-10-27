/**
 * ブレーカーの開放を DB で「長い方」に書く RPC scrape_breaker_open（マイグレーション184、BOA-1159）の検証。
 * 本番 DB には触れず、PGlite に 075・178・184 を当てて関数の意味を確かめ、store.js の呼び方・184 の前の戻りを偽のクライアントで確かめる。
 *
 *   (a) 長い期限の後に短い期限を書いても縮まない（段階・開いた時刻・理由も長い側のまま）。長い期限は勝つ
 *   (b) 行が無ければ作る。mode は既定の off、fetch_stop は false のまま（書かない）。人が立てた fetch_stop も消さない
 *   (c) p_level が NULL なら段階・開いた時刻を変えない
 *   (d) 戻り値は書いた後の breaker_open_until
 *   (e) anon・authenticated は実行できない。service_role は実行できる
 *   (f) store.breakerStore.open: RPC を呼び、戻り値の期限を {untilMs} で返す
 *   (g) store.breakerStore.open: RPC が無い（184 の前、PGRST202）ときは upsert に戻り、しばらく RPC を試さない。他のエラーは投げる
 *   (h) circuitBreaker: DB が返した長い期限（別の起動の6時間）を自分の期限として採る
 *
 * 実行: node scripts/maintenance/verify-scrape-breaker-greatest.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSupabaseStore } from "../lib/scrapeJobs/store.js";
import { createCircuitBreaker } from "../lib/scrapeJobs/circuitBreaker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mig = (f) =>
  fs.readFileSync(path.join(__dirname, "../../docs/db-migration", f), "utf8");

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? `\n   ${detail}` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);

let PGlite;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
} catch {
  console.error("@electric-sql/pglite が見つかりません（npm ci で入る）");
  process.exit(2);
}

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE races (race_id varchar(20) primary key, race_date date not null, venue_code smallint not null, race_number smallint not null, start_time time, cancellation_status text);
CREATE TABLE race_odds (race_id varchar(20) references races(race_id) on delete cascade, captured_at timestamptz not null, odds_win_1 numeric, primary key (race_id, captured_at));
`);
await db.exec(
  "BEGIN;\n" + mig("075_scrape_slots_and_job_state.sql") + "\nCOMMIT;",
);
await db.exec(mig("178_scrape_job_state_fetch_stop.sql"));
await db.exec(mig("184_scrape_breaker_open_greatest.sql"));
await db.exec(
  "GRANT SELECT, INSERT, UPDATE ON scrape_job_state TO service_role;",
);

const call = async (job, until, reason, level = null, openedAt = null) =>
  (
    await db.query(
      "SELECT * FROM public.scrape_breaker_open($1, $2::timestamptz, $3, $4::smallint, $5::timestamptz)",
      [job, until, reason, level, openedAt],
    )
  ).rows[0].breaker_open_until;
const row = async (job) =>
  (await db.query("SELECT * FROM scrape_job_state WHERE job = $1", [job]))
    .rows[0];
const ms = (v) => (v ? new Date(v).getTime() : null);

const H = "host:boatrace.jp";
// (a)(b)(d)
{
  const longUntil = "2026-10-27T09:00:00Z";
  const shortUntil = "2026-10-27T03:05:00Z";
  const r1 = await call(
    H,
    longUntil,
    "canary HTTP 403",
    4,
    "2026-10-27T03:00:00Z",
  );
  const after1 = await row(H);
  const r2 = await call(H, shortUntil, "HTTP 429", 1, "2026-10-27T03:00:01Z");
  const after2 = await row(H);
  check(
    "(a) 長い期限の後に短い期限を書いても縮まない（段階・開いた時刻・理由も長い側のまま）",
    ms(after2.breaker_open_until) === Date.parse(longUntil) &&
      after2.breaker_level === 4 &&
      ms(after2.breaker_opened_at) === Date.parse("2026-10-27T03:00:00Z") &&
      after2.last_error === "canary HTTP 403",
    show(after2),
  );
  check(
    "(b) 行が無ければ作る（mode は既定の off、fetch_stop は false）",
    after1.mode === "off" && after1.fetch_stop === false,
    show(after1),
  );
  check(
    "(d) 戻り値は書いた後の breaker_open_until（短い方を書いても長い方が返る）",
    ms(r1) === Date.parse(longUntil) && ms(r2) === Date.parse(longUntil),
    show({ r1, r2 }),
  );
  const r3 = await call(
    H,
    "2026-10-27T12:00:00Z",
    "HTTP 429 Retry-After",
    2,
    "2026-10-27T06:00:00Z",
  );
  const after3 = await row(H);
  check(
    "(a) より長い期限は勝ち、段階・開いた時刻・理由もその側になる",
    ms(r3) === Date.parse("2026-10-27T12:00:00Z") &&
      after3.breaker_level === 2 &&
      after3.last_error === "HTTP 429 Retry-After",
    show(after3),
  );
}
// (b) 人が立てた fetch_stop を消さない・(c)
{
  const J = "host:mbrace.or.jp";
  await db.exec(`INSERT INTO scrape_job_state (job, fetch_stop, mode, breaker_level, breaker_opened_at)
    VALUES ('${J}', true, 'live', 3, '2026-10-27T00:00:00Z')`);
  await call(J, "2026-10-27T04:00:00Z", "HTTP 429");
  const r = await row(J);
  check(
    "(b)(c) fetch_stop・mode を書かない。p_level が NULL なら段階・開いた時刻を変えない",
    r.fetch_stop === true &&
      r.mode === "live" &&
      r.breaker_level === 3 &&
      ms(r.breaker_opened_at) === Date.parse("2026-10-27T00:00:00Z") &&
      ms(r.breaker_open_until) === Date.parse("2026-10-27T04:00:00Z"),
    show(r),
  );
}
// (e)
{
  const can = async (role) =>
    (
      await db.query(
        `SELECT has_function_privilege('${role}', 'public.scrape_breaker_open(text,timestamptz,text,smallint,timestamptz)', 'EXECUTE') AS ok`,
      )
    ).rows[0].ok;
  check(
    "(e) anon・authenticated は実行できない、service_role は実行できる",
    (await can("anon")) === false &&
      (await can("authenticated")) === false &&
      (await can("service_role")) === true,
  );
}

// (f)(g)
{
  const mkClient = (rpcResults) => {
    const log = [];
    const client = {
      async rpc(name, args) {
        log.push({ op: "rpc", name, args });
        return rpcResults.shift();
      },
      from() {
        return {
          async upsert(payload) {
            log.push({ op: "upsert", payload });
            return { error: null };
          },
        };
      },
    };
    return { client, log };
  };
  const T = Date.parse("2026-10-27T03:00:00Z");
  {
    const { client, log } = mkClient([
      {
        data: [
          {
            breaker_open_until: "2026-10-27T09:00:00.123456+00:00",
            breaker_level: 4,
            breaker_opened_at: "2026-10-27T03:00:00+00:00",
          },
        ],
        error: null,
      },
    ]);
    const r = await createSupabaseStore(client).breakerStore.open(
      H,
      T + 5 * 60_000,
      "HTTP 429",
      {
        level: 1,
        openedAtMs: T,
      },
    );
    check(
      "(f) open は RPC を呼び、書いた後の DB の期限（文字列のまま）・段階・開いた時刻を返す",
      log.length === 1 &&
        log[0].name === "scrape_breaker_open" &&
        log[0].args.p_level === 1 &&
        log[0].args.p_until === new Date(T + 5 * 60_000).toISOString() &&
        r.untilMs === Date.parse("2026-10-27T09:00:00.123Z") &&
        r.untilRaw === "2026-10-27T09:00:00.123456+00:00" &&
        r.level === 4 &&
        r.openedAtMs === Date.parse("2026-10-27T03:00:00Z"),
      show({ log, r }),
    );
  }
  {
    const missing = {
      data: null,
      error: {
        code: "PGRST202",
        message:
          "Could not find the function public.scrape_breaker_open(p_job, p_level, p_opened_at, p_reason, p_until) in the schema cache",
      },
    };
    const { client, log } = mkClient([missing]);
    const st = createSupabaseStore(client);
    const r1 = await st.breakerStore.open(H, T, "HTTP 429", {
      level: 1,
      openedAtMs: T,
    });
    const r2 = await st.breakerStore.open(H, T, "HTTP 429", {
      level: 1,
      openedAtMs: T,
    });
    check(
      "(g) RPC が無い（184 の前）ときは upsert に戻り、しばらく RPC を試さない",
      show(log.map((x) => x.op)) === show(["rpc", "upsert", "upsert"]) &&
        r1.untilMs === T &&
        r2.untilMs === T,
      show(log.map((x) => x.op)),
    );
  }
  {
    const { client } = mkClient([
      { data: null, error: { code: "57014", message: "statement timeout" } },
    ]);
    let err = null;
    try {
      await createSupabaseStore(client).breakerStore.open(H, T, "HTTP 429");
    } catch (e) {
      err = e;
    }
    check(
      "(g) 関数の不在でないエラーは upsert に戻らず投げる",
      err instanceof Error,
      String(err),
    );
  }
}

// (h)
{
  const T = Date.parse("2026-10-27T03:00:00Z");
  const sixHours = T + 6 * 60 * 60_000;
  const b = createCircuitBreaker({
    store: {
      read: async () => ({ untilMs: 0, fetchStop: false, untilRaw: null }),
      open: async () => ({
        untilMs: sixHours,
        untilRaw: "2026-10-27T09:00:00.000123+00:00",
        level: 3,
        openedAtMs: T - 1000,
      }),
      close: async () => true,
    },
    now: () => T,
  });
  for (let i = 0; i < 3; i++) await b.recordFailure(H, "HTTP 429");
  check(
    "(h) DB が返した長い期限（別の起動の6時間）を、その側の段階・開いた時刻とともに採る（審査 P3-1）",
    b.snapshot(H).openUntil === sixHours &&
      b.snapshot(H).level === 3 &&
      b.snapshot(H).openedAt === T - 1000,
    show(b.snapshot(H)),
  );
}

if (failures > 0) {
  console.error(`\n❌ ${failures}件の失敗`);
  process.exit(1);
}
console.log("\n✅ すべて成功");
