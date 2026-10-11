import { test, expect } from "./fixtures.js";

/**
 * 優勝戦・準優勝戦の判定 v2（BOA-271 T1-1）。「優勝戦」を含まない名前の優勝戦・準優勝戦にも
 * 見出しのチップの絵文字が付き、今節の得点から除かれる（v2 で変わる本体の6レースのうち2つ）。
 * 旧判定では「決勝戦」「準決勝戦」は分類できず、公式表記のままのチップで、得点率に算入されていた。
 */

// 2026-01-25 江戸川12R「決勝戦」（G1）
const FINAL_RACE = "2026-01-25-13-12";
// 2026-01-24 江戸川12R「準決勝戦」（G1）
const SEMIFINAL_RACE = "2026-01-24-13-12";

test("「決勝戦」の見出しのチップは優勝戦（🏆）で、公式名をツールチップに出す", async ({
  page,
}) => {
  test.slow();
  await page.goto(`/race/${FINAL_RACE}`, { waitUntil: "domcontentloaded" });
  const chip = page.locator(".race-detail-stage");
  await expect(chip).toHaveClass(/race-detail-stage--final/, {
    timeout: 60000,
  });
  await expect(chip).toContainText("🏆");
  await expect(chip).toContainText("優勝戦");
  await expect(chip).toHaveAttribute("title", /決勝戦/);
});

test("「準決勝戦」の今節タブは、得点率が動かないレースとして扱う", async ({
  page,
}) => {
  test.slow();
  await page.goto(`/race/${SEMIFINAL_RACE}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".race-detail-stage")).toHaveClass(
    /race-detail-stage--semifinal/,
    { timeout: 60000 },
  );
  await page.locator(".race-tabs-btn", { hasText: /^今節$/ }).click();
  const chip = page.locator(".rmt-select-chip").first();
  await chip.waitFor({ timeout: 60000 });
  await chip.click();
  const note = page.locator(".rmt-forecast-settled").first();
  await expect(note).toContainText("準決勝戦", { timeout: 60000 });
});
