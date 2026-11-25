// 出目分布（分析ツール）の号艇ごとの見出しと注記に、出現率の分母（会場の全レース）と1着の回数を数で出す
// （オーナー 2026-11-25。AI予想タブの参考表は1着のレースが分母で、同じ組でも値が違うため）
import { test, expect } from "./fixtures.js";

const toNumber = (text) => Number(String(text).replace(/,/g, ""));

test("出目分布の見出しに「全Nレース中Mレース」、注記に全Nレースを出し、Mは表の出現回数の和", async ({
  page,
}) => {
  await page.goto("/winning-technique?venue_code=8&tab=outcome", {
    waitUntil: "domcontentloaded",
  });
  const container = page.locator(".outcome-distribution-container");
  const summary = container.locator(".summary-info");
  await expect(summary).toContainText("レース", { timeout: 30000 });
  const total = toNumber(
    (await summary.textContent()).match(/([\d,]+)レース/)[1],
  );
  expect(total).toBeGreaterThan(0);

  const firstTab = container.locator(".outcome-tab").first();
  const count = firstTab.locator(".outcome-first-count");
  await expect(count).toBeVisible();
  const [, shownTotal, wins] = (await count.textContent()).match(
    /全([\d,]+)レース中([\d,]+)レース/,
  );
  expect(toNumber(shownTotal)).toBe(total);

  // 1着の回数は、その号艇の段の出現回数の和（2着・3着の組は全部返る）
  const counts = await firstTab.locator("tbody td.count").allTextContents();
  const sum = counts.reduce((a, c) => a + toNumber(c), 0);
  expect(toNumber(wins)).toBe(sum);

  await expect(container.locator(".table-note")).toContainText(
    `全${total.toLocaleString()}レース中`,
  );
});
