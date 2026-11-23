import { test, expect } from "./fixtures.js";

/**
 * 選手ページ「レース条件別の成績」の矢印の線（UI/UX 改善 #8、承認 docs/design/racer-wt-uiux-2026-11/mock/approved.md）。
 * - 30走未満の行は率も矢印も出さず「N走中1着M回」だけ（3列にまたがる）
 * - 矢印（全体との差 pt）は、30走以上で、その条件の走対それ以外の走の差が偶然の幅を超えた率だけ
 * 判定そのものは scripts/maintenance/verify-racer-condition-stats.js で固定の入力で検証する。
 * ここでは出走履歴を差し替えて入力を固定する（録画の選手の履歴に頼らない）。120走:
 *   晴60走(1着10回)・曇り40走(同24回)・雨20走(同8回)。風5m以上と未満は各60走で1着21回ずつ（差なし）
 */

const N = 120;
const raceIds = Array.from({ length: N }, (_, i) => {
  const d = new Date(Date.UTC(2026, 0, 5 + i)).toISOString().slice(0, 10);
  return `${d}-02-01`;
});
// 天候のブロック（先頭から 晴60・曇り40・雨20）。風は偶数番が 6m、奇数番が 2m
const weatherOf = (i) => (i < 60 ? "晴" : i < 100 ? "曇り" : "雨");
const blockWins = { 晴: 5, 曇り: 12, 雨: 4 }; // 各ブロックの偶数番・奇数番それぞれの1着回数
function runsOf() {
  const seen = { 晴: [0, 0], 曇り: [0, 0], 雨: [0, 0] };
  return raceIds.map((raceId, i) => {
    const weather = weatherOf(i);
    const parity = i % 2;
    seen[weather][parity] += 1;
    return {
      raceId,
      weather,
      wind: parity === 0 ? 6 : 2,
      win: seen[weather][parity] <= blockWins[weather],
    };
  });
}

async function stubHistory(page, runs) {
  const byId = new Map(runs.map((r) => [r.raceId, r]));
  const idsIn = (route) =>
    (decodeURIComponent(route.request().url()).match(/\d{4}-\d{2}-\d{2}-\d{2}-\d{2}/g) ?? []).filter(
      (id) => byId.has(id),
    );
  await page.route("**/rest/v1/race_entries?*", (route) => {
    const url = new URL(route.request().url());
    const select = (url.searchParams.get("select") ?? "").replace(/\s/g, "");
    if (select !== "race_id,boat_number" || !url.searchParams.get("racer_id"))
      return route.fallback();
    return route.fulfill({
      json: runs.map((r) => ({ race_id: r.raceId, boat_number: 1 })),
    });
  });
  const answer = (table, build) =>
    page.route(`**/rest/v1/${table}?*`, (route) => {
      const ids = idsIn(route);
      if (ids.length === 0) return route.fallback();
      return route.fulfill({
        json: ids.map((id) => build(byId.get(id))).filter(Boolean),
      });
    });
  await answer("races", (r) => ({ race_id: r.raceId, venue_code: 2, race_grade: "一般" }));
  await answer("race_results", (r) => {
    const order = r.win ? [1, 2, 3, 4, 5, 6] : [2, 3, 4, 1, 5, 6];
    return {
      race_id: r.raceId,
      ...Object.fromEntries(order.map((b, k) => [`rank${k + 1}`, b])),
      race_status: null,
      winning_technique: "逃げ",
      payout_win: 200,
    };
  });
  await answer("race_conditions", (r) => ({
    race_id: r.raceId,
    race_stage: null,
    race_title: null,
    weather: r.weather,
    wind_speed: r.wind,
    wave_height: null,
  }));
  for (const table of ["exhibition_data", "race_start_timings"])
    await answer(table, () => null);
}

test("条件別の成績: 30走未満の行は件数だけ、矢印は差が大きい30走以上の率だけ", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await stubHistory(page, runsOf());
  await page.goto("/racer/4320");
  const sec = page.locator(".racer-cond-stats");
  await expect(sec).toBeVisible({ timeout: 30000 });
  const row = (label) =>
    sec.locator("tbody tr", { has: page.locator("td:first-child", { hasText: new RegExp(`^${label}$`) }) });

  await expect(row("全体").locator("td").nth(1)).toHaveText("120");
  // 30走未満: 件数だけ（3列にまたがり、矢印なし）
  await expect(row("雨・雪・台風").locator("td")).toHaveCount(3);
  await expect(row("雨・雪・台風").locator("td").nth(2)).toHaveText("20走中1着8回");
  await expect(row("雨・雪・台風").locator(".racer-cond-diff")).toHaveCount(0);
  // 大きい差: 晴は全体（35.0%）より低い、曇りは高い。1着率に矢印
  await expect(row("晴").locator("td").nth(2).locator(".racer-cond-diff")).toHaveText(/^↓−\d+\.\d$/);
  await expect(row("曇り").locator("td").nth(2).locator(".racer-cond-diff")).toHaveText(/^↑\+\d+\.\d$/);
  // 風5m以上と未満は 35.0% で同じ（差なし）: 率は出るが矢印も色も無い
  for (const label of ["風5m以上", "風5m未満"]) {
    await expect(row(label).locator("td")).toHaveCount(5);
    await expect(row(label).locator("td").nth(2)).toHaveText("35.0%");
    await expect(row(label).locator(".racer-cond-diff")).toHaveCount(0);
  }
  // 表が375pxで枠に収まる
  const m = await sec.locator(".table-wrapper").evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(m.sw).toBeLessThanOrEqual(m.cw);
});
