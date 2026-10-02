import { test, expect } from "./fixtures.js";

/**
 * 丸一日レースが無かった日（全レースが中止確定）のレース詳細（BOA-658）。
 *
 * 公式は丸一日中止の翌日に同じ日目を振り直すので、series_day の値をそのまま
 * 出すと「2日目」が2日続く（津 9/22 と 9/23）。中止の日は日目を出さない。
 * 今節タブも、行われないレースに「今日の着順でこう動く」の早見・準優の目安を
 * 出さず、中止の断りを出す。
 *
 * - 津 2026-09-22 6R: 全レース中止の日
 * - 津 2026-09-21 8R: 4Rまで成立した日の、中止になったレース。日は数えるので「初日」
 * - 津 2026-09-23 6R: 中止の翌日。「2日目」で、早見が出る
 */

async function openMeetTab(page, raceId) {
  await page.goto(`/race/${raceId}`);
  await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
  await expect(page.locator(".race-meet-tab")).toBeVisible({ timeout: 30000 });
}

test("丸一日中止の日は、見出しに日目を出さず、今節タブに早見を出さない", async ({
  page,
}) => {
  await openMeetTab(page, "2026-09-22-09-06");
  await expect(page.locator(".race-detail-series-day")).toHaveCount(0);
  await expect(page.locator(".race-meet-tab")).toContainText(
    "このレースは中止のため、得点率は動きません。",
  );
  await expect(page.locator(".rmt-forecast-table")).toHaveCount(0);
  // 走らないレースなので「初戦」と書かない（PR #1102 ファン評価1周目）
  await expect(page.locator(".race-meet-tab")).not.toContainText("初戦");
  await expect(page.locator(".rmt-compare")).toContainText("未出走");
});

test("一部だけ成立した日の中止のレースは、日目を残して中止の断りを出す", async ({
  page,
}) => {
  await openMeetTab(page, "2026-09-21-09-08");
  await expect(page.locator(".race-detail-series-day")).toHaveText("初日");
  await expect(page.locator(".race-meet-tab")).toContainText(
    "このレースは中止のため、得点率は動きません。",
  );
});

test("中止の翌日は日目を出し、早見も出す", async ({ page }) => {
  await openMeetTab(page, "2026-09-23-09-06");
  await expect(page.locator(".race-detail-series-day")).toHaveText("2日目");
  await expect(page.locator(".rmt-forecast-table")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator(".race-meet-tab")).not.toContainText(
    "このレースは中止のため",
  );
});
