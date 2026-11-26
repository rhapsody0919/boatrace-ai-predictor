import { test, expect } from "./fixtures.js";

/**
 * 選手ページの細部の直し（UI/UX 改善 #7・#9、承認 docs/design/racer-wt-uiux-2026-11/mock/approved.md）の固定。
 * - 勝率の推移は全国勝率だけ（当地勝率は節ごとに会場が変わる値で、線でつなぐと調子の上下に見える）
 * - 今節のモーターの展示タイムのグラフに「下ほど速い」、機力指数の評価の主語はモーター
 * - ニュースが0件のプロフィールのある選手にはニュースの節を出さない
 * 録画の再生で、4320（ニュースあり）・3941（ニュース無し）・4586（モーターあり）
 */

test("勝率の推移は全国勝率だけの1本の線で、当地勝率は出さない", async ({
  page,
}) => {
  await page.goto("/racer/4320");
  const chart = page.locator(".racer-stat-chart", {
    has: page.locator("h3", { hasText: "勝率の推移" }),
  });
  await expect(chart.locator("h3")).toHaveText("全国勝率の推移", {
    timeout: 30000,
  });
  await expect(chart.locator(".recharts-line")).toHaveCount(1);
  await expect(chart).not.toContainText("当地勝率");
});

// 縦軸は値の幅に合わせる（期別成績の図と同じ winRateAxis）。0 から始めると 0.4 の上下が平らに見えた（G2 2026-11-26）
test("全国勝率の推移の縦軸は0から始めず、値の幅に合わせる", async ({ page }) => {
  await page.goto("/racer/4320");
  const chart = page.locator(".racer-stat-chart", {
    has: page.locator("h3", { hasText: "全国勝率の推移" }),
  });
  const ticks = chart.locator(".recharts-yAxis .recharts-cartesian-axis-tick-value");
  await expect(ticks.first()).toBeVisible({ timeout: 30000 });
  const values = (await ticks.allTextContents()).map(Number);
  expect(values).not.toContain(0);
  expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(8);
});

test("ニュースが0件の選手にはニュースの節が無く、ある選手には出る", async ({
  page,
}) => {
  await page.goto("/racer/3941");
  await expect(page.locator(".racer-profile-header h1")).toHaveText("池田浩二");
  await expect(page.locator(".racer-performance-stats h2")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator(".racer-news-list")).toHaveCount(0);

  await page.goto("/racer/4320");
  await expect(page.locator(".racer-news-item").first()).toBeVisible({
    timeout: 30000,
  });
});

test("今節のモーターの展示タイムのグラフに「下ほど速い」、機力指数の評価の主語はモーター", async ({
  page,
}) => {
  await page.goto("/racer/4586");
  const card = page.locator(".racer-motor-status-card");
  await expect(card.locator("h2")).toBeVisible({ timeout: 30000 });
  // 4586 は録画で推移（2走以上）と機力指数の評価の両方が出る選手。出ない録画になったら落ちて気づく
  await expect(card.locator(".racer-motor-status-note").filter({ hasText: "下ほど速い" })).toHaveCount(1);
  const verdict = card.locator(".racer-motor-status-index");
  await expect(verdict).toHaveCount(1);
  await expect(verdict).not.toContainText(/ — 選手の実力/);
  await expect(verdict).toContainText(
    / — (モーターは乗る選手の実力|走数が少ない)/,
  );
});
