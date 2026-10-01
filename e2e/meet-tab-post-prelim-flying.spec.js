import { test, expect } from "./fixtures.js";

/**
 * 今節タブの「予選後F」（BOA-626）。
 *
 * 予選が終わった後のレースで今節Fを切った選手は、順位を残したまま印を添える。
 * 印の意味は表の下の注記で断る（タッチ端末では title が読めないため）。
 *
 * - 桐生 2026-09-25 7R: 6号艇 武田光史が 9/24 8R（準優勝戦＝予選後）でF
 * - 桐生 2026-09-25 9R: 6艇に予選後Fの選手がいない。節の中には居るが、表に印の
 *   無いレースで注記だけ出すと「どこに印があるのか」と迷う（PR #1052 ファン評価1周目）
 */

async function openMeetTab(page, raceId) {
  await page.goto(`/race/${raceId}`);
  await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
  await expect(page.locator(".rmt-compare tbody tr").first()).toBeVisible({
    timeout: 30000,
  });
}

test("予選後にFを切った選手は、順位の下に「予選後F」が出て、注記で意味を断る", async ({
  page,
}) => {
  await openMeetTab(page, "2026-09-25-01-07");
  const row = page.locator(".rmt-compare tbody tr", { hasText: "武田光史" });
  await expect(row.locator(".rmt-rank")).toContainText("5位");
  await expect(row.locator(".rmt-post-flying")).toHaveText("予選後F");
  await expect(page.locator(".rmt-sub").first()).toContainText("予選後F");
});

test("表の6艇に予選後Fの選手がいなければ、注記も出さない", async ({ page }) => {
  await openMeetTab(page, "2026-09-25-01-09");
  await expect(page.locator(".rmt-compare .rmt-post-flying")).toHaveCount(0);
  await expect(page.locator(".rmt-sub").first()).not.toContainText("予選後F");
});
