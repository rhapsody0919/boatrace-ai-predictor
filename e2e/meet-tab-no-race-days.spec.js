import { test, expect } from "./fixtures.js";

/**
 * 今節タブで、丸一日レースが無かった日（中止・順延）を断る（BOA-636）。
 *
 * 公式は丸一日中止の翌日に同じ日目を振り直すので、初日から日付を数えると
 * 「予選は5日目（9/26）」が1日ずれて見える。推移の横軸からもその日が抜ける。
 * どちらも理由を書く（PR #1044 ファン評価1周目の P3）。
 *
 * - 津 2026-09-28 11R: 9/22 が全レース中止（9/21 は4Rまで成立したので含めない）
 * - 戸田 2026-09-30 12R: 中止の無い節（9/26〜）。注記を出さない
 */

async function openMeetTab(page, raceId) {
  await page.goto(`/race/${raceId}`);
  await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
  await expect(page.locator(".rmt-trend-range")).toBeVisible({
    timeout: 30000,
  });
}

test("丸一日レースが無かった日を、予選終了の一文と推移の横軸で断る", async ({
  page,
}) => {
  await openMeetTab(page, "2026-09-28-09-11");
  await expect(page.locator(".rmt-forecast-settled")).toContainText(
    "予選は5日目（9/26）で終了",
  );
  await expect(page.locator(".rmt-forecast-settled")).toContainText(
    "9/22は中止・順延",
  );
  await expect(page.locator(".rmt-forecast-settled")).not.toContainText(
    "9/21",
  );
  await expect(page.locator(".rmt-trend-range")).toContainText(
    "9/22は中止・順延でレースが無かったため、目盛りにありません",
  );
});

test("中止の無い節では、どちらの注記も出さない", async ({ page }) => {
  await openMeetTab(page, "2026-09-30-02-12");
  await expect(page.locator(".rmt-trend-range")).not.toContainText("中止");
  await expect(page.locator(".race-meet-tab")).not.toContainText(
    "中止・順延",
  );
});
