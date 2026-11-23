import { test, expect } from "./fixtures.js";

/**
 * 選手ページ「レース条件別の成績」の矢印の線（UI/UX 改善 #8、承認 docs/design/racer-wt-uiux-2026-11/mock/approved.md）。
 * - 30走未満の行は率も矢印も出さず「N走中1着M回」だけ（3列にまたがる）
 * - 矢印（全体との差 pt）は30走以上の行だけ。通る・通らないの判定そのものは
 *   scripts/maintenance/verify-racer-condition-stats.js で固定の入力で検証する
 * 録画の再生で 4320。表の行は録画の履歴から決まるので、行ごとの走数で線を確かめる
 */

test("条件別の成績: 30走未満の行は件数だけ、矢印は30走以上の行だけ", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/racer/4320");
  const sec = page.locator(".racer-cond-stats");
  await expect(sec).toBeVisible({ timeout: 30000 });

  const rows = sec.locator(
    "tbody tr:not(.racer-cond-group):not(.racer-cond-overall)",
  );
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  let few = 0;
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const n = Number(await row.locator("td:nth-child(2)").innerText());
    if (n < 30) {
      few += 1;
      await expect(row.locator("td")).toHaveCount(3);
      await expect(row.locator("td").nth(2)).toHaveText(
        new RegExp(`^${n}走中1着\\d+回$`),
      );
      await expect(row.locator(".racer-cond-diff")).toHaveCount(0);
    } else {
      await expect(row.locator("td")).toHaveCount(5);
    }
  }
  // 録画の4320に30走未満の条件が無いと、この試験は線を見ない（無いなら録画を見直す）
  expect(few).toBeGreaterThan(0);

  // 矢印・色が付くのは、率の隣の差だけ。付いた差は向きの記号つき
  for (const diff of await sec.locator(".racer-cond-diff").all()) {
    await expect(diff).toHaveText(/^(↑\+|↓−|±)\d+\.\d$/);
  }
  // 表が375pxで枠に収まる
  const m = await sec
    .locator(".table-wrapper")
    .evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(m.sw).toBeLessThanOrEqual(m.cw);
});
