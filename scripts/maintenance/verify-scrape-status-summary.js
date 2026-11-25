/**
 * verify-scrape-status-summary.js - scrape-monitor の結果の集計の面（api/scrape-status/summary.js、
 * scripts/lib/scrapeJobs/statusSummary.js。BOA-1480）の振る舞いの検証。DBには接続しない。
 *
 * 確認すること:
 *   (a) summarizeStatus: JST の日付・ジョブ順・monitor_last_run（last_error の本文は出さない）
 *   (b) 返す物に鍵・URL・選手・オッズの項目が無い（集計の項目だけ）
 *   (c) readStatusSummary: expired は昨日以降、races は当日で数える。075未適用は available:false。エラーは例外
 *   (d) HTTPハンドラー: GET以外は405、no-store、失敗は内部の文言を返さない
 */
import handlerDefault, {
  createStatusSummaryHandler,
} from "../../api/scrape-status/summary.js";
import {
  readStatusSummary,
  summarizeStatus,
} from "../lib/scrapeJobs/statusSummary.js";

console.error = () => {};
let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.log(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

// 2026-11-22 16:30 UTC = 2026-11-23 01:30 JST（UTC と JST で日付が違う時刻）
const NOW = new Date("2026-11-22T16:30:00Z");

/** 最小の Supabase 差し替え。table ごとの結果と、呼ばれた条件を残す */
function fakeClient({ state, racesCount = 0, expiredCount = 0, stateError }) {
  const calls = [];
  const client = {
    calls,
    from(table) {
      const q = { table, filters: [] };
      const chain = {
        select(cols) {
          q.cols = cols;
          return chain;
        },
        eq(c, v) {
          q.filters.push(["eq", c, v]);
          return chain;
        },
        gte(c, v) {
          q.filters.push(["gte", c, v]);
          return chain;
        },
        then(resolve) {
          calls.push(q);
          if (table === "scrape_job_state") {
            return resolve(
              stateError ? { data: null, error: stateError } : { data: state, error: null },
            );
          }
          const count = table === "races" ? racesCount : expiredCount;
          return resolve({ count, error: null });
        },
      };
      return chain;
    },
  };
  return client;
}

const STATE = [
  {
    job: "result",
    mode: "live",
    last_tick_at: "2026-11-22T16:28:00Z",
    last_error: "https://secret.example/?key=abc",
    last_report: { secret: "x" },
  },
  {
    job: "scrape-monitor",
    mode: "live",
    last_tick_at: "2026-11-22T16:25:00Z",
    last_success_at: "2026-11-22T16:25:01Z",
    consecutive_failures: 2,
    last_error: "boom https://secret.example/?key=abc",
  },
  { job: "odds", mode: "shadow", last_tick_at: null },
];

// (a)(b)
const s = summarizeStatus({
  now: NOW,
  jobStates: STATE,
  racesToday: 72,
  expiredOpen: 3,
});
check("(a) date_jst は JST の日付", s.date_jst === "2026-11-23", s.date_jst);
check(
  "(a) ジョブは名前順で last_tick_at と mode を持つ",
  s.jobs.map((j) => j.job).join() === "odds,result,scrape-monitor" &&
    s.jobs[0].last_tick_at === null &&
    s.jobs[1].mode === "live" &&
    s.jobs[1].last_tick_at === "2026-11-22T16:28:00.000Z",
);
check(
  "(a) monitor_last_run は連続失敗と有無だけ",
  s.monitor_last_run?.consecutive_failures === 2 &&
    s.monitor_last_run.has_error === true &&
    s.monitor_last_run.last_success_at === "2026-11-22T16:25:01.000Z",
);
check("(a) 件数を持つ", s.races_today === 72 && s.expired_open === 3);
const text = JSON.stringify(s);
check(
  "(b) last_error・last_report・URL・鍵が出ない",
  !/secret|boom|https?:|key|last_report/i.test(text.replace(/has_error/g, "")),
  text,
);
check(
  "(b) monitor の行が無ければ monitor_last_run は null",
  summarizeStatus({ now: NOW, jobStates: [], racesToday: 0, expiredOpen: 0 })
    .monitor_last_run === null,
);

// (c)
const client = fakeClient({ state: STATE, racesCount: 72, expiredCount: 3 });
const read = await readStatusSummary(client, NOW);
check("(c) available で件数が入る", read.available && read.races_today === 72 && read.expired_open === 3);
const racesQ = client.calls.find((c) => c.table === "races");
const slotsQ = client.calls.find((c) => c.table === "scrape_slots");
check(
  "(c) races は当日（JST）で数える",
  JSON.stringify(racesQ.filters) === JSON.stringify([["eq", "race_date", "2026-11-23"]]),
);
check(
  "(c) expired は昨日（JST）以降",
  JSON.stringify(slotsQ.filters) ===
    JSON.stringify([
      ["eq", "status", "expired"],
      ["gte", "race_date", "2026-11-22"],
    ]),
  JSON.stringify(slotsQ.filters),
);
check(
  "(c) 状態の読み取りの列に last_error 以外の本文（last_report）を含めない",
  !client.calls[0].cols.includes("last_report"),
);
const missing = await readStatusSummary(
  fakeClient({
    stateError: { code: "42P01", message: 'relation "scrape_job_state" does not exist' },
  }),
  NOW,
);
check("(c) 075未適用は available:false", missing.available === false);
let threw = false;
try {
  await readStatusSummary(
    fakeClient({ stateError: { code: "XX000", message: "db down" } }),
    NOW,
  );
} catch {
  threw = true;
}
check("(c) その他のエラーは例外（空を正常にしない）", threw);

// (d)
function fakeRes() {
  const res = { headers: {}, statusCode: 0, body: null };
  res.setHeader = (k, v) => {
    res.headers[k] = v;
  };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
}
const handler = createStatusSummaryHandler({
  getClient: async () => fakeClient({ state: STATE, racesCount: 1, expiredCount: 0 }),
  now: () => NOW,
});
const ok = fakeRes();
await handler({ method: "GET", headers: {} }, ok);
check(
  "(d) GET は 200・no-store・success",
  ok.statusCode === 200 && ok.headers["Cache-Control"] === "no-store" && ok.body.success === true,
);
const post = fakeRes();
await handler({ method: "POST", headers: {} }, post);
check("(d) POST は 405 で no-store", post.statusCode === 405 && post.headers["Cache-Control"] === "no-store");
const bad = createStatusSummaryHandler({
  getClient: async () =>
    fakeClient({ stateError: { code: "XX000", message: "db down https://x.supabase.co key=abc" } }),
  now: () => NOW,
});
const fail = fakeRes();
await bad({ method: "GET", headers: {} }, fail);
check(
  "(d) 失敗は 500 で内部の文言を返さない",
  fail.statusCode === 500 && !JSON.stringify(fail.body).includes("supabase"),
);
const none = fakeRes();
await createStatusSummaryHandler({ getClient: async () => null })(
  { method: "GET", headers: {} },
  none,
);
check("(d) クライアントが無ければ 500", none.statusCode === 500);
check("(d) 既定のエクスポートは関数", typeof handlerDefault === "function");

if (failures > 0) {
  console.log(`\n❌ ${failures} 件失敗`);
  process.exit(1);
}
console.log("\n✅ verify-scrape-status-summary: すべて通過");
