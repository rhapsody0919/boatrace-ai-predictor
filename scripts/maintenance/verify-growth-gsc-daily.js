/**
 * verify-growth-gsc-daily.js - Search Console の日別の取り込み（scripts/lib/growth/gscDaily.js）の純関数を確かめる
 * （BOA-1706、hq 閉鎖 R2）。ネットワーク・DB には触れない。
 *
 * 守る物:
 *   - 取り直す窓が PT の今日を除く直近7日で、JST の朝でも PT の日で数える
 *   - 行の列の集合が全行で同じ（PostgREST のバルク upsert で欠けた列が NULL で上書きされない）
 *   - 上限（50,000行）に当たった日・0行の日は古い行を消さない
 *   - ログの行と失敗の文に数字の値（クリック・表示・順位）や DB の行の中身が出ない（公開のリポジトリの Actions）
 */
import assert from "node:assert/strict";
import {
  API_ROW_CAP,
  canPrune,
  chunk,
  logLine,
  ptToday,
  safeError,
  toRows,
  windowDates,
} from "../lib/growth/gscDaily.js";

// JST 2026-11-23 10:23 は PT 2026-11-22 17:23
const now = new Date("2026-11-23T01:23:00Z");
assert.equal(ptToday(now), "2026-11-22");
assert.deepEqual(windowDates(now, 3), ["2026-11-19", "2026-11-20", "2026-11-21"]);
assert.equal(windowDates(now).length, 7);
assert.equal(windowDates(now).at(-1), "2026-11-21");
assert.ok(!windowDates(now).includes("2026-11-22"), "PT の今日は途中の日なので取らない");

const fetchedAt = "2026-11-23T01:23:00.000Z";
const rows = toRows(
  [
    { keys: ["2026-11-21", "ボートレース 予想", "https://www.boat-ai.jp/"], clicks: 3, impressions: 120, position: 8.25 },
    { keys: ["2026-11-21", "戸田 ai", "https://www.boat-ai.jp/venue/2"], impressions: 7, position: 12 },
  ],
  fetchedAt,
);
const cols = Object.keys(rows[0]).sort();
assert.deepEqual(cols, ["clicks", "date", "fetched_at", "impressions", "page", "position", "query"]);
for (const r of rows) assert.deepEqual(Object.keys(r).sort(), cols, "全行で列の集合が同じ");
assert.equal(rows[1].clicks, 0, "欠けたクリックは 0（NULL にしない）");
assert.equal(rows[0].position, 8.25);
assert.throws(() => toRows([{ keys: ["2026-11-21", "q"] }], fetchedAt), /keys/);

assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
assert.deepEqual(chunk([], 2), []);

assert.equal(canPrune(0), false, "0行の日は消さない（取れなかっただけかもしれない）");
assert.equal(canPrune(10), true);
assert.equal(canPrune(API_ROW_CAP - 1), true);
assert.equal(canPrune(API_ROW_CAP), false, "上限に当たった日は取り切れていないので消さない");

assert.equal(logLine("2026-11-21", 10, true), "2026-11-21: 10行・古い行を消した");
assert.equal(logLine("2026-11-21", API_ROW_CAP, false), `2026-11-21: ${API_ROW_CAP}行・上限に当たった`);

const dbErr = {
  code: "23514",
  message: 'new row for relation "growth_gsc_daily" violates check constraint (Failing row contains (2026-11-21, 戸田 ai, https://www.boat-ai.jp/venue/2, -1, 7, 12))',
};
const msg = safeError(dbErr);
assert.ok(msg.startsWith("code=23514 "), msg);
assert.ok(!msg.includes("Failing row"), `行の中身を出さない: ${msg}`);
assert.ok(!msg.includes("戸田"), `行の中身を出さない: ${msg}`);
assert.equal(safeError(new Error("x")).startsWith("code=unknown"), true);

console.log("verify-growth-gsc-daily: OK（窓・列の集合・消してよい日・ログと失敗の文に値を出さない）");
