import { test, expect } from "./fixtures.js";

// 基本情報の「平均STの推移（直近30走ごと）」に、選んだ艇の公式の平均ST（今の公式の期の値）を破線で添える
// （R-19、racer-form-window.md の「期の公式値を横線で添える」、2026-11-27）。ほかの指標の推移には出さない
// 若松9R 2026-10-09（公式の平均ST が録画にある。basic-info-official-period.spec.js と同じレース）
const RACE = "/race/2026-10-09-20-09";

async function openTrend(page, chip) {
  await page.goto(RACE);
  await page.locator(".race-tabs-btn", { hasText: "基本情報" }).first().click();
  const head = page.locator(".race-basic-info-tab .trc-head");
  await expect(head.locator(".trc-title")).toHaveText("勝率の今の値", { timeout: 30000 });
  await page.locator(".rbit-chip", { hasText: chip }).first().click();
  await head.locator(".trc-tab", { hasText: "推移" }).click();
  return page.locator(".race-basic-info-tab .trc-wrap");
}

test("平均STの推移に、選んだ艇の公式の平均STの破線と期の札が出る", async ({ page }) => {
  const wrap = await openTrend(page, "平均ST");
  await expect(wrap.locator(".trc-official-line")).toHaveCount(1, { timeout: 30000 });
  await expect(wrap.locator(".trc-official-label")).toHaveText(
    /^公式 \.\d{2}（\d{2}\/\d{2}〜\d{2}\/\d{2}）$/,
  );
});

test("3連対率の推移には公式の平均STの破線を出さない", async ({ page }) => {
  const wrap = await openTrend(page, "3連対率");
  await expect(wrap.locator(".trc-svg")).toBeVisible({ timeout: 30000 });
  await expect(wrap.locator(".trc-official-line")).toHaveCount(0);
});
