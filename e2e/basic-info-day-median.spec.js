// 基本情報タブの勝率（公式・全国）の棒を、今日出走する選手の勝率の最低〜最高で描き、今日の真ん中（中央値）に縦線を引く
// （意味づけ 2026-11-28。オーナー「表には不要、グラフには入れるのはアリ」→ 案を見て「PR にしてよい」）。
// 当地に切り替えたら線も注記も消え、6艇の中の比べの注記に戻る。値はページが既に読むその日の全レースから作る。
import { test, expect } from "./fixtures.js";

const RACE = "/race/2026-10-09-20-09";

for (const width of [375, 1440]) {
  test(`勝率の棒に今日の真ん中の線、線より右は真ん中より高い ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(RACE);
    await page
      .locator(".race-tabs-btn", { hasText: "基本情報" })
      .first()
      .click();
    const note = page.getByTestId("rbit-day-median-note");
    await expect(note).toBeVisible({ timeout: 30000 });
    const [, n, median] = (await note.textContent()).match(
      /選手（(\d+)人）.*勝率 ([\d.]+)/,
    );
    expect(Number(n)).toBeGreaterThanOrEqual(200);
    await expect(page.locator(".rbit-relative-note")).toHaveCount(0);

    const rows = page.locator(".rbit-bar-row");
    await expect(rows).toHaveCount(6);
    await expect(page.locator(".rbit-bar-ref")).toHaveCount(6);
    // 棒の右端が線より右 ⇔ 勝率が真ん中より高い（同じ値は除く）
    const geo = await rows.evaluateAll((els) =>
      els.map((row) => {
        const fill = row
          .querySelector(".rbit-bar-fill")
          ?.getBoundingClientRect();
        const ref = row.querySelector(".rbit-bar-ref").getBoundingClientRect();
        const value = Number(
          row.querySelector(".rbit-value").textContent.match(/\d+\.\d+/)?.[0],
        );
        return {
          right: fill ? fill.right : null,
          ref: ref.left + ref.width / 2,
          value,
        };
      }),
    );
    for (const g of geo) {
      if (g.right === null || g.value === Number(median)) continue;
      expect(g.right > g.ref, JSON.stringify(g)).toBe(g.value > Number(median));
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}

test("当地に切り替えたら線と注記を出さず、6艇の中の比べの注記に戻る", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(RACE);
  await page.locator(".race-tabs-btn", { hasText: "基本情報" }).first().click();
  await expect(page.getByTestId("rbit-day-median-note")).toBeVisible({
    timeout: 30000,
  });
  await page
    .locator(".rbit-chip", { hasText: /^当地$/ })
    .first()
    .click();
  await expect(page.getByTestId("rbit-day-median-note")).toHaveCount(0);
  await expect(page.locator(".rbit-bar-ref")).toHaveCount(0);
  await expect(page.locator(".rbit-relative-note")).toBeVisible();
});
