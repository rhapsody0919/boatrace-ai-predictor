import { test, expect } from "./fixtures.js";

// 選手の成績比較の「今の値｜推移」（オーナー 2026-11-24 承認のモック改訂3）。
// 開いた最初は今の値。推移に切り替えると題が変わり、期間の絞り込み（推移に効かない）は隠れ、棒は出ない。
// 線の点そのものは verify-racer-trend-series（純関数）が見る
const RACE = "/race/2026-09-21-02-05";

test("推移に切り替えると題が変わり、期間の絞り込みと棒が隠れる", async ({ page }) => {
  await page.goto(RACE);
  await page.locator(".race-tabs-btn", { hasText: "基本情報" }).first().click();
  const head = page.locator(".race-basic-info-tab .trc-head");
  await expect(head.locator(".trc-title")).toHaveText("勝率の今の値", { timeout: 30000 });
  await expect(head.locator(".trc-tab", { hasText: "今の値" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".rbit-period-details")).toHaveCount(1);
  await expect(page.locator(".rbit-bar-row").first()).toBeVisible();

  await page.locator(".rbit-chip", { hasText: "3連対率" }).first().click();
  await head.locator(".trc-tab", { hasText: "推移" }).click();
  await expect(head.locator(".trc-title")).toHaveText("3連対率の推移（直近30走ごと）");
  await expect(page.locator(".rbit-period-details")).toHaveCount(0);
  await expect(page.locator(".rbit-bar-row")).toHaveCount(0);

  await page.locator(".rbit-chip", { hasText: "勝率" }).first().click();
  await expect(page.locator(".trc-note")).toContainText("準備中");

  await head.locator(".trc-tab", { hasText: "今の値" }).click();
  await expect(page.locator(".rbit-bar-row").first()).toBeVisible();
});
