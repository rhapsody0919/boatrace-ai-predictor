/**
 * verify-growth-gsc-page-daily.js - date × page の取得・書き手と補充の道具（scripts/lib/growth/gscPageDaily.js）を確かめる
 * （SEO データの輪 PR2）。ネットワーク・DB には触れない（偽の client を使う）。
 *
 * 守る物:
 *   - date × page は query を付けずに取る（匿名の語も合計に入る）。行の列の集合が全行で同じ
 *   - 表が無い間は書き手が意味のある文で止まる。他の失敗は別の文で投げる（握りつぶさない）
 *   - 補充の範囲は 2025-12-21 以降で、日ごとに並ぶ。引数の誤りは文で止まる
 *   - 上限に当たった日・0行の日は古い行を消さない。再実行は同じ主キーへの upsert
 */
import assert from "node:assert/strict";
import {
  BACKFILL_START,
  allDaysEmpty,
  assertPageTableExists,
  dateRange,
  fetchPageDay,
  isMissingTable,
  parseBackfillArgs,
  toPageRows,
  writePageDay,
} from "../lib/growth/gscPageDaily.js";

// 取得: query を付けない
let sent;
const sc = {
  searchanalytics: {
    query: async (req) => {
      sent = req.requestBody;
      return { data: { rows: [{ keys: ["2026-11-20", "https://www.boat-ai.jp/"], clicks: 4, impressions: 90, position: 7.5 }] } };
    },
  },
};
const got = await fetchPageDay(sc, "sc-domain:boat-ai.jp", "2026-11-20");
assert.deepEqual(sent.dimensions, ["date", "page"], "query を付けない");
assert.equal(sent.type, "web");
assert.equal(sent.dataState, "all");
assert.equal(got.length, 1);

const rows = toPageRows(
  [
    ...got,
    { keys: ["2026-11-20", "https://www.boat-ai.jp/venue/2"], impressions: 3 },
  ],
  "t",
);
const cols = Object.keys(rows[0]).sort();
assert.deepEqual(cols, ["clicks", "date", "fetched_at", "impressions", "page", "position"]);
for (const r of rows) assert.deepEqual(Object.keys(r).sort(), cols);
assert.equal(rows[1].clicks, 0, "欠けたクリックは 0");
assert.throws(() => toPageRows([{ keys: ["2026-11-20", "q", "p"] }], "t"), /keys/);

// 表が無い
const missing = { code: "PGRST205", message: "Could not find the table 'public.growth_gsc_page_daily' in the schema cache" };
assert.equal(isMissingTable(missing), true);
assert.equal(isMissingTable({ code: "42501" }), false);
const dbWith = (error) => ({
  from: () => ({
    select: () => ({ limit: async () => ({ error }) }),
    upsert: async () => ({ error }),
    delete: () => ({ eq: () => ({ lt: async () => ({ error: null }) }) }),
  }),
});
await assert.rejects(assertPageTableExists(dbWith(missing)), /db-draft\.md.*db-apply/s);
await assert.rejects(writePageDay(dbWith(missing), "2026-11-20", rows, "t"), /growth_gsc_page_daily が無い/);
await assert.rejects(assertPageTableExists(dbWith({ code: "42501", message: "permission denied for table x (Failing row contains (1))" })), (e) => {
  assert.ok(e.message.includes("code=42501") && !e.message.includes("Failing row"), e.message);
  return true;
});
await assertPageTableExists(dbWith(null));

// 書き手: upsert の主キーと、消す条件
const calls = [];
const fakeDb = {
  from: (t) => ({
    upsert: async (part, o) => (calls.push(["upsert", t, part.length, o.onConflict]), { error: null }),
    delete: () => ({ eq: () => ({ lt: async () => (calls.push(["delete"]), { error: null }) }) }),
  }),
};
assert.equal(await writePageDay(fakeDb, "2026-11-20", rows, "t"), true);
assert.deepEqual(calls[0], ["upsert", "growth_gsc_page_daily", 2, "date,page"]);
assert.equal(calls.at(-1)[0], "delete");
calls.length = 0;
assert.equal(await writePageDay(fakeDb, "2026-11-20", [], "t"), false, "0行の日は消さない");
assert.ok(!calls.some((c) => c[0] === "delete"));

// 補充の範囲・引数
assert.equal(BACKFILL_START, "2025-12-21");
assert.deepEqual(dateRange("2026-02-27", "2026-03-02"), ["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
assert.deepEqual(dateRange("2026-03-02", "2026-03-01"), []);
assert.throws(() => dateRange("x", "2026-03-01"), /YYYY-MM-DD/);
const def = parseBackfillArgs([], "2026-11-23");
assert.deepEqual(def, { from: "2025-12-21", to: "2026-11-23", tables: ["query", "page"], dryRun: false });
assert.deepEqual(parseBackfillArgs(["--from", "2026-01-01", "--tables", "page", "--dry-run"], "2026-11-23"), {
  from: "2026-01-01", to: "2026-11-23", tables: ["page"], dryRun: true,
});
assert.throws(() => parseBackfillArgs(["--from", "2025-12-20"], "2026-11-23"), /2025-12-21 以降/);
assert.throws(() => parseBackfillArgs(["--tables", "x"], "2026-11-23"), /query・page/);
assert.throws(() => parseBackfillArgs(["--nope"], "2026-11-23"), /知らない引数/);
assert.throws(() => parseBackfillArgs(["--from"], "2026-11-23"), /値が無い/);

assert.equal(allDaysEmpty([0, 0]), true);
assert.equal(allDaysEmpty([0, 1]), false);
assert.equal(allDaysEmpty([]), false);

console.log("verify-growth-gsc-page-daily: OK（date×page の取得・表が無いときの文・補充の範囲と引数・消す条件）");
