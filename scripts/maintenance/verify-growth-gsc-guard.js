/**
 * verify-growth-gsc-guard.js - Search Console の日別の取り込みの見張り（scripts/lib/growth/gscDaily.js）を確かめる。
 * ネットワーク・DB には触れない（外との口は偽物に差し替える）。
 *
 * 守る物:
 *   - 取った窓の全日が0行なら失敗の文を返す（collect が exit 1 にする）。1日でも行があれば失敗にしない
 *   - 変わらない行は書かない。値が変わった行と新しい行だけ書く（position は REAL の丸めで毎回変更扱いにならない）
 *   - 全部を取り切れた日だけ、今回の取得に無い既存の行を主キーで消す対象にする。fetched_at では決めない
 *   - 1日が落ちても他の日は取り、最後に失敗の文へまとめる。ログに数字の値を出さない
 */
import assert from "node:assert/strict";
import {
  API_ROW_CAP,
  collectWindow,
  planDay,
  windowFailure,
  zeroWindowMessage,
} from "../lib/growth/gscDaily.js";

const dates = ["2026-11-15", "2026-11-16", "2026-11-17"];

// 1. 全日が0行 → 失敗の文。1日でも行があれば null
const zero = zeroWindowMessage(dates, [0, 0, 0]);
assert.match(zero, /全日で0行/);
assert.match(zero, /2026-11-15〜2026-11-17/);
assert.match(zero, /SEARCH_CONSOLE_SITE_URL/, "原因の手がかりを文に入れる");
assert.equal(zeroWindowMessage(dates, [0, 3, 0]), null);
assert.equal(zeroWindowMessage(dates, []), null, "1日も取れていないときは落ちた日の文で扱う");
assert.match(windowFailure(dates, { counts: [0, 0, 0], failed: [] }), /全日で0行/);
assert.equal(windowFailure(dates, { counts: [5, 0, 0], failed: [] }), null);
const both = windowFailure(dates, { counts: [0, 0], failed: ["2026-11-17"] });
assert.match(both, /1日が落ちた（2026-11-17）/);
assert.match(both, /全日で0行/);

// 2. 変わらない行は書かない
const row = (query, clicks, impressions, position, date = "2026-11-16") => ({
  date,
  query,
  page: "https://www.boat-ai.jp/",
  clicks,
  impressions,
  position,
  fetched_at: "2026-11-16T01:00:00.000Z",
});
const existing = [row("a", 1, 10, 8.123457), row("b", 2, 20, 5), row("gone", 1, 1, 3)];
const incoming = [
  { ...row("a", 1, 10, 8.123456789), fetched_at: "2026-11-17T01:00:00.000Z" }, // float4 の丸めだけの差
  { ...row("b", 2, 21, 5), fetched_at: "2026-11-17T01:00:00.000Z" }, // 表示が変わった
  { ...row("new", 1, 1, 9), fetched_at: "2026-11-17T01:00:00.000Z" }, // 新しい
];
const plan = planDay(existing, incoming);
assert.deepEqual(plan.toWrite.map((r) => r.query).sort(), ["b", "new"]);
assert.equal(plan.unchanged, 1);
const cols = Object.keys(plan.toWrite[0]).sort();
for (const r of plan.toWrite) assert.deepEqual(Object.keys(r).sort(), cols, "書く行の列の集合は同じ");

// 3. 消す行は主キーで決める（fetched_at が古いだけの変わらない行は消さない）
assert.deepEqual(plan.stale, [{ date: "2026-11-16", query: "gone", page: "https://www.boat-ai.jp/" }]);
assert.deepEqual(planDay(existing, []).stale, [], "0行の日は消さない");
const capped = Array.from({ length: API_ROW_CAP }, (_, i) => row(`q${i}`, 1, 1, 1));
assert.deepEqual(planDay([row("gone", 1, 1, 3)], capped).stale, [], "上限に当たった日は消さない");

// 4. collectWindow: 落ちた日があっても他の日は取る。ログに数字の値が出ない
const calls = { upsert: [], del: [] };
const logs = [];
const errs = [];
const result = await collectWindow({
  dates,
  fetchedAt: "2026-11-18T01:00:00.000Z",
  fetchRows: async (d) => {
    if (d === "2026-11-16") throw new Error("Search Console の取得の失敗: code=500 x");
    return d === "2026-11-15"
      ? [{ keys: [d, "zzz", "https://www.boat-ai.jp/"], clicks: 777, impressions: 888, position: 6.5 }]
      : [];
  },
  readExisting: async () => [],
  upsert: async (d, rows) => calls.upsert.push([d, rows.length]),
  deleteRows: async (d, keys) => calls.del.push([d, keys.length]),
  log: (l) => logs.push(l),
  logError: (l) => errs.push(l),
});
assert.deepEqual(result.failed, ["2026-11-16"]);
assert.deepEqual(result.counts, [1, 0]);
assert.deepEqual(calls.upsert.map((c) => c[0]), ["2026-11-15", "2026-11-17"]);
for (const l of [...logs, ...errs]) assert.ok(!/777|888|6\.5|zzz/.test(l), `ログに値を出さない: ${l}`);
assert.match(windowFailure(dates, result), /1日が落ちた/);

// 5. 全日0行の窓は collectWindow → windowFailure で失敗になる（exit 1 の根拠）
const empty = await collectWindow({
  dates,
  fetchedAt: "t",
  fetchRows: async () => [],
  readExisting: async () => [],
  upsert: async () => {},
  deleteRows: async () => {},
  log: () => {},
  logError: () => {},
});
assert.match(windowFailure(dates, empty), /全日で0行/);

console.log("verify-growth-gsc-guard: OK（全日0行は失敗・変わらない行は書かない・主キーで消す・ログに値なし）");
