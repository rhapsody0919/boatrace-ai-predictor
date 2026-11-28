import { test, expect } from "./fixtures.js";

// 選手ページの「STの推移」の点を押すと、吹き出しにその走の6艇の中の ST の順位を出す（オーナー 2026-11-27、
// 比べる相手を見せる。#3686 を分けた2つ目）。ほかの推移の図（展示）には出さない
const chartOf = (page, title) =>
  page.locator(".racer-stat-chart").filter({ has: page.locator("h3", { hasText: title }) });

test.use({ viewport: { width: 1440, height: 900 } });

test("STの推移の吹き出しに6艇中の順位が出て、展示の推移には出ない", async ({ page }) => {
  await page.goto("/racer/4069");
  const st = chartOf(page, "STの推移");
  await expect(st.locator(".trc-svg")).toBeVisible({ timeout: 30000 });
  await st.scrollIntoViewIfNeeded();
  const box = await st.locator(".trc-hit").boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  await expect(st.locator(".trc-tip")).toContainText(/6艇中\d番目/);

  const ex = chartOf(page, "展示タイムの推移");
  await ex.scrollIntoViewIfNeeded();
  const eb = await ex.locator(".trc-hit").boundingBox();
  await page.mouse.click(eb.x + eb.width * 0.5, eb.y + eb.height / 2);
  await expect(ex.locator(".trc-tip")).toBeVisible();
  await expect(ex.locator(".trc-tip")).not.toContainText("6艇中");
});
