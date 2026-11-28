import { test, expect } from "./fixtures.js";
import { gotoAnalysisTabOnFixedDate } from "./smoke/helpers.js";

/**
 * 全国勝率の変化ランキングの差の棒（G4 T-21、FormRankingDiffBars）。
 *   - 差は ↑↓ でなく符号つきの数字（上がった10人は「+」、下がった10人は「−」）
 *   - 375px でも差の数字と「約90日前 → 現在」が横スクロール無しで画面の中に入る（表だった頃は差の列が外に隠れた）
 *   - 棒は差の大きさに比例し、並びの1行目が一番長い
 * 固定日（ANALYSIS_FIXED_DATE）の録画で開く（analysis-2.spec.js と同じ技法）。
 */
test.use({ viewport: { width: 375, height: 812 } });

test("変化ランキング: 差を符号つきの数字と棒で出し、375px で差が画面に入る", async ({
  page,
}) => {
  await gotoAnalysisTabOnFixedDate(page, "formranking", { withRace: false });
  const up = page.locator(".frd--up .frd-row");
  const down = page.locator(".frd--down .frd-row");
  await expect(up.first()).toBeVisible({ timeout: 15000 });
  await expect(down.first()).toBeVisible();

  const upDiffs = await page.locator(".frd--up .frd-diff").allTextContents();
  const downDiffs = await page
    .locator(".frd--down .frd-diff")
    .allTextContents();
  expect(upDiffs.length).toBeGreaterThan(0);
  for (const d of upDiffs) expect(d).toMatch(/^\+\d+\.\d{2}$/);
  for (const d of downDiffs) expect(d).toMatch(/^−\d+\.\d{2}$/);
  await expect(page.locator(".motor-condition-container")).not.toContainText(
    /[↑↓]/,
  );

  // 差の数字と右の値が 375px の画面の中にある
  for (const sel of [".frd--up .frd-diff", ".frd--up .frd-values"]) {
    const box = await page.locator(sel).first().boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(375);
  }
  await expect(up.first().locator(".frd-values")).toContainText("→");

  // 1行目（差が最大）の棒が一番長い
  const widths = await page
    .locator(".frd--up .frd-bar")
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  expect(Math.max(...widths)).toBe(widths[0]);
});
