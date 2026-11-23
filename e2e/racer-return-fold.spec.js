import { test, expect } from "./fixtures.js";

/**
 * 選手ページの枠番別回収率の扱いと、公式の期別の値の呼び名（UI/UX 改善 #8・#9、承認 docs/design/racer-wt-uiux-2026-11/mock/approved.md）の固定。
 * - 「枠番別回収率（過去180日）」は畳んで「参考・N走」を付け、30走未満の枠番の回収率は「-」。矢印・色は付けない
 * - 公式の期別成績の2連の率は「2連対率」（出走表・当サイト集計の「2連率」と呼び分ける）
 * 録画の再生で 4320
 */

test("枠番別回収率は畳んで参考・N走、30走未満の枠番は「-」で矢印・色は無い", async ({
  page,
}) => {
  await page.goto("/racer/4320");
  const fold = page.locator("details.racer-return-fold");
  await expect(fold).toHaveCount(1, { timeout: 30000 });
  await expect(fold).not.toHaveAttribute("open", "");
  await expect(fold.locator("summary")).toHaveText(
    /^枠番別回収率（過去180日）参考・\d+走$/,
  );

  await fold.locator("summary").click();
  const rows = fold.locator("tbody tr");
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const cells = rows.nth(i).locator("td");
    const n = Number(await cells.nth(1).innerText());
    const expected = n < 30 ? /^-$/ : /^(\d+%|-)$/;
    await expect(cells.nth(2)).toHaveText(expected);
    await expect(cells.nth(3)).toHaveText(expected);
  }
  await expect(fold.locator("[class*='diff'], [class*='better'], [class*='worse']")).toHaveCount(0);
  await expect(fold).not.toContainText(/[↑↓]/);
});

test("冒頭の要約の公式の期別の値は「2連対率」と呼ぶ", async ({ page }) => {
  await page.goto("/racer/4320");
  const summary = page.getByTestId("racer-summary");
  await expect(summary).toBeVisible({ timeout: 30000 });
  await expect(summary.locator("dt").filter({ hasText: "2連対率" })).toHaveCount(1);
  await expect(summary.locator("dt").filter({ hasText: /^2連率/ })).toHaveCount(0);
});
