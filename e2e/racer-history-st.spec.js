import { test, expect } from "./fixtures.js";

/**
 * 選手ページの履歴は本番ST（race_start_timings）と公式の着欄の記号を出す（BOA-576）。
 * 以前は ST を展示ST（exhibition_data.start_timing）から出し、落・転・妨などの走を「着外(順位不明)」としていた。
 * 選手5250の本番データ（2026-09-30 確認）:
 * - 9/24 桐生10R: 本番ST 0.02（展示ST 0.06）、3着
 * - 9/21 桐生11R: 本番ST 0.11（展示ST 0.09）、着欄「落」
 */
test("選手ページの履歴: 本番STと公式の記号を出す", async ({ page }) => {
  await page.goto("/racer/5250");
  const rowOf = (date, raceNo) =>
    page
      .locator("tr")
      .filter({ hasText: date })
      .filter({
        has: page.locator("td", { hasText: new RegExp(`^${raceNo}R$`) }),
      });
  // 9/24 は2走（5R・10R）ある。10R の行を取る
  const r0924 = rowOf("2026-09-24", 10);
  await expect(r0924).toBeVisible({ timeout: 30000 });
  await expect(r0924).toContainText("0.02");
  await expect(r0924).not.toContainText("0.06");
  const r0921 = rowOf("2026-09-21", 11);
  await expect(r0921).toContainText("落");
  await expect(r0921).not.toContainText("着外");
});
