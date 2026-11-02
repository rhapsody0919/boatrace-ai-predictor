import { test, expect } from "./fixtures.js";

/**
 * 選手ページの「今節のモーター状況」（BOA-1182）。
 * 直近の出走の節が終わっていたら「前節」と書く。終わったかは race_series.end_date が
 * JST の今日より前かで決める（中止で順延した節があるので壁時計の推定はしない）。
 * 節の日程の取得（select=start_date,end_date）だけを差し替える。
 */
const mockSeries = (page, rows) =>
  page.route(
    (url) =>
      url.pathname.endsWith("/rest/v1/race_series") &&
      url.searchParams.get("select") === "start_date,end_date",
    (route) => route.fulfill({ json: rows }),
  );

const card = (page) => page.locator(".racer-motor-status-card");

test("直近の節が終わっていたら「前節のモーター状況」と書き、推移の見出しも前節にする", async ({
  page,
}) => {
  await mockSeries(page, [
    { start_date: "2000-01-01", end_date: "2000-01-06" },
  ]);
  await page.goto("/racer/4586");
  await expect(card(page).locator("h2")).toBeVisible({ timeout: 30000 });
  await expect(card(page).locator("h2")).toContainText("前節のモーター状況");
  await expect(card(page)).not.toContainText("今節");
  // 推移が描ける選手は「前節（会場 日程）」、出走数が少ない選手は「前節は…」
  await expect(
    card(page).locator(
      ".racer-motor-status-chart-caption, .racer-motor-status-empty",
    ),
  ).toHaveText(/^前節(（\S+ \d\d-\d\d〜\d\d-\d\d）|は)/);
});

test("節の最終日が今日以降なら「今節のモーター状況」のまま", async ({
  page,
}) => {
  await mockSeries(page, [
    { start_date: "2999-01-01", end_date: "2999-01-06" },
  ]);
  await page.goto("/racer/4586");
  await expect(card(page).locator("h2")).toBeVisible({ timeout: 30000 });
  await expect(card(page).locator("h2")).toContainText("今節のモーター状況");
  await expect(card(page)).not.toContainText("前節");
});

test("節の行が引けないときは終わったと決めつけず、「今節」のまま", async ({
  page,
}) => {
  await mockSeries(page, []);
  await page.goto("/racer/4586");
  await expect(card(page).locator("h2")).toBeVisible({ timeout: 30000 });
  await expect(card(page).locator("h2")).toContainText("今節のモーター状況");
});
