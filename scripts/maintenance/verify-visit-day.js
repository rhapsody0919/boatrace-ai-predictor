#!/usr/bin/env node
/**
 * 再訪の計測 visit_day（GS03）を検証する。hq の集計は visit_day の active_days_iso_week（今の ISO 週に来た日数）と
 * active_days_7d（今日を含む直近7日に来た日数）を週ごとに数えて「週に2日以上来た端末」等を出すので、次が崩れると数が化ける。
 *
 * 1. 同じ日（JST）の2回目以降は送らない（送ると同じ端末の日数が重なる）
 * 2. 今日を含む7日より前の日は数えない・保存しない。JST の日付の境目（UTC 15:00）で日が変わる。ISO 週は JST の月曜で切る
 * 3. 壊れた保存は空として扱い、1から数え直す
 * 4. ☆の有無は none・racer・venue・both・unknown の5つだけ（件数・ID は送らない）
 * 5. trackPageView の最初の1回だけが送る。gtag が無い（Cookie に同意していない）ときは保存も送信もしない
 *
 *   node scripts/maintenance/verify-visit-day.js
 */
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.sessionStorage = { getItem: () => "1", setItem: () => {} };
const sent = [];
globalThis.window = { location: { origin: "https://example.test" } };

const { nextVisitDays, favHolder, VISIT_DAYS_KEY } = await import("../../src/pure/visitDays.js");
const { trackPageView, trackVisitDay } = await import("../../src/utils/analytics.js");
const { FAVORITES_KEY } = await import("../../src/pure/favorites.js");

const at = (iso) => new Date(iso);

// 1. 同じ日は送らない
let r = nextVisitDays(null, at("2026-11-22T00:00:00Z"));
assert.deepEqual(r, { send: true, activeDays7d: 1, activeDaysIsoWeek: 1, days: ["2026-11-22"] });
r = nextVisitDays(JSON.stringify(r.days), at("2026-11-22T14:59:59Z"));
assert.equal(r.send, false, "同じ JST の日の2回目で送っている");

// 2. JST の境目と7日の窓
r = nextVisitDays(JSON.stringify(["2026-11-22"]), at("2026-11-22T15:00:00Z"));
// 11/22 は日曜、11/23 は月曜（JST）。週をまたぐと今週の日数は1から
assert.deepEqual(r, { send: true, activeDays7d: 2, activeDaysIsoWeek: 1, days: ["2026-11-22", "2026-11-23"] }, "UTC 15:00 で JST の日・ISO 週が変わっていない");
const week = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"];
r = nextVisitDays(JSON.stringify(["2026-11-15", ...week]), at("2026-11-22T03:00:00Z"));
assert.equal(r.activeDays7d, 7, "今日を含む直近7日で数えていない");
assert.equal(r.activeDaysIsoWeek, 7, "日曜に月〜日の7日を数えていない");
assert.ok(!r.days.includes("2026-11-15"), "7日より前の日を残している");
r = nextVisitDays(JSON.stringify(["2026-11-15", "2026-11-17"]), at("2026-11-18T03:00:00Z"));
assert.equal(r.activeDaysIsoWeek, 2, "前の週の日曜を今週に数えている");
assert.equal(r.activeDays7d, 3, "前の週でも直近7日の日を数えていない");
r = nextVisitDays(JSON.stringify(["2026-11-15"]), at("2026-11-22T03:00:00Z"));
assert.equal(r.activeDays7d, 1, "7日前（今日を含む7日の外）の来訪を数えている");
r = nextVisitDays(JSON.stringify(["2026-11-23"]), at("2026-11-22T03:00:00Z"));
assert.equal(r.activeDays7d, 1, "未来の日付（端末の時計のずれ）を数えている");

// 3. 壊れた保存
for (const raw of ["{", '{"a":1}', '["x", 3, null]', '"2026-11-22"']) {
  r = nextVisitDays(raw, at("2026-11-22T03:00:00Z"));
  assert.deepEqual(r, { send: true, activeDays7d: 1, activeDaysIsoWeek: 1, days: ["2026-11-22"] }, `壊れた保存 ${raw} を空として扱っていない`);
}
r = nextVisitDays(JSON.stringify(["2026-11-21", "2026-11-21"]), at("2026-11-22T03:00:00Z"));
assert.equal(r.activeDays7d, 2, "重なった日を2回数えている");

// 4. ☆の有無
assert.equal(favHolder(null), "none");
assert.equal(favHolder(JSON.stringify({ racers: [4320], venues: [] })), "racer");
assert.equal(favHolder(JSON.stringify({ racers: [], venues: [12] })), "venue");
assert.equal(favHolder(JSON.stringify({ racers: [4320], venues: [12] })), "both");
assert.equal(favHolder("{"), "unknown");

// 5. 送る経路
trackPageView("/");
assert.equal(store.has(VISIT_DAYS_KEY), false, "gtag が無い（同意していない）のに来訪日を保存している");
window.gtag = (...args) => sent.push(args);
store.set(FAVORITES_KEY, JSON.stringify({ racers: [4320], venues: [] }));
trackPageView("/");
trackPageView("/race/2026-11-22-01-01");
const visits = sent.filter((a) => a[1] === "visit_day");
assert.equal(visits.length, 1, "1回の来訪で visit_day を2回以上送っている");
assert.deepEqual(Object.keys(visits[0][2]).sort(), ["active_days_7d", "active_days_iso_week", "fav_holder"], "visit_day に決めた3つ以外の引数がある");
assert.equal(visits[0][2].active_days_7d, 1);
assert.equal(visits[0][2].active_days_iso_week, 1);
assert.equal(visits[0][2].fav_holder, "racer");
trackVisitDay();
assert.equal(sent.filter((a) => a[1] === "visit_day").length, 1, "同じ日の別のタブで送っている");

console.log("verify-visit-day: OK");
