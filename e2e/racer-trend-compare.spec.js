import { test, expect } from "./fixtures.js";

// 選手ページの推移の比べる線（オーナー 2026-11-27、ファン4人の議論の推奨）。
// ST: 期間の平均（点線）と、今の級×同じ進入コースの全国平均（破線、st_course_baseline）。吹き出しに6艇の中の ST の順位。
// 展示: 同じレースの他の5艇の平均（破線）と、それより速い走の薄い塗り
const chartOf = (page, title) =>
  page.locator(".racer-stat-chart").filter({ has: page.locator("h3", { hasText: title }) });

test.use({ viewport: { width: 1440, height: 900 } });

test("STの推移に、期間の平均と今の級×同じコースの全国平均の線と札が出て、吹き出しに6艇中の順位が出る", async ({ page }) => {
  await page.goto("/racer/4069");
  const st = chartOf(page, "STの推移");
  await expect(st.locator(".trc-svg")).toBeVisible({ timeout: 30000 });
  await expect(st.locator(".racer-run-line-avg")).toHaveCount(1);
  await expect(st.locator(".racer-run-line-base")).toHaveCount(1);
  await expect(st.locator(".racer-run-label-base")).toContainText("同コース");
  await expect(st.locator(".racer-run-label-avg")).toContainText(/全\d+走/);
  await st.scrollIntoViewIfNeeded();
  const box = await st.locator(".trc-hit").boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  await expect(st.locator(".trc-tip")).toContainText(/6艇中\d番目/);
});

test("展示タイムの推移に、同じレースの他の5艇の平均の破線と、それより速い走の塗りが出る", async ({ page }) => {
  await page.goto("/racer/4069");
  const ex = chartOf(page, "展示タイムの推移");
  await expect(ex.locator(".trc-svg")).toBeVisible({ timeout: 30000 });
  await expect(ex.locator(".racer-run-line-ref")).toHaveCount(1);
  expect(await ex.locator(".racer-run-gain").count()).toBeGreaterThan(0);
  await expect(ex.locator(".racer-run-label-ref")).toContainText("他5艇平均");
  // 展示の図には期間の平均の横線を出さない（線と破線と塗りに絞る）
  await expect(ex.locator(".racer-run-line-avg")).toHaveCount(0);
});
