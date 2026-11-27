// 選手ページの進入コース別成績（公式）に、1着率の棒と全選手の同じコース（直近3期）の縦線を出す
// （見せ方の型1・値の尺度、意味づけ 2026-11-26 オーナー承認、形は 2026-11-27 オーナーが選んだ）。▲緑・▼赤は偶然のぶれを超えたときだけ。
// 基準の取得に失敗したら差を出さず、取り直しの表示を出す（0 や「差なし」に化けさせない）。
import { test, expect } from "./fixtures.js";

// 全選手の1着率。1コースを低く（10%）すると A1 の 3941 は大きく上になり、緑▲になる
const NATIONAL = {
  1: { wins: 100, entries: 1000, winRate: 10.0 },
  2: { wins: 135, entries: 1000, winRate: 13.5 },
  3: { wins: 129, entries: 1000, winRate: 12.9 },
  4: { wins: 103, entries: 1000, winRate: 10.3 },
  5: { wins: 61, entries: 1000, winRate: 6.1 },
  6: { wins: 19, entries: 1000, winRate: 1.9 },
};

async function open(page, { fail = false, width = 375 } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.route("**/rest/v1/rpc/get_course_win_rate_baseline", (route) =>
    fail
      ? route.fulfill({ status: 500, json: { message: "e2e" } })
      : route.fulfill({ json: { terms: [], national: NATIONAL, venue: null } }),
  );
  await page.goto("/racer/3941");
  const table = page.locator(".racer-official-stats .racer-official-table").last();
  await expect(table.locator("tbody tr")).toHaveCount(6, { timeout: 30000 });
  return table;
}

for (const width of [375, 1440]) {
  test(`1着率の棒に全選手の縦線、偶然の幅を超えたコースだけ緑▲ ${width}px`, async ({ page }) => {
    await open(page, { width });
    const bars = page.locator(".racer-official-winbars .racer-official-bar-row");
    await expect(bars).toHaveCount(6, { timeout: 30000 });
    const first = bars.nth(0);
    await expect(first).toHaveAttribute("data-tone", "good");
    await expect(first).toContainText("全選手 10.0%");
    await expect(first.locator(".racer-official-winbar-mark")).toHaveText(/▲全選手より高い/);
    // 縦線は全選手の率の位置、棒の長さは選手の率（どちらも 0〜100% の尺度）
    const geo = await first.evaluate((row) => {
      const track = row.querySelector(".racer-official-winbar-track").getBoundingClientRect();
      const fill = row.querySelector(".racer-official-winbar-fill").getBoundingClientRect();
      const base = row.querySelector(".racer-official-winbar-base").getBoundingClientRect();
      return { fill: fill.width / track.width, base: (base.left + base.width / 2 - track.left) / track.width };
    });
    expect(geo.base).toBeCloseTo(0.1, 1);
    const rate = Number((await first.locator(".racer-official-bar-value").textContent()).match(/1着率 ([\d.]+)%/)[1]);
    expect(geo.fill).toBeCloseTo(rate / 100, 1);
    // 色の無いコースは印なし
    for (let i = 1; i < 6; i += 1) {
      const tone = await bars.nth(i).getAttribute("data-tone");
      if (tone === "plain") await expect(bars.nth(i).locator(".racer-official-winbar-mark")).toHaveCount(0);
    }
    await expect(page.locator(".racer-official-stats")).toContainText("全選手の同じコースの1着率（直近3期）と比べています");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test("基準の取得に失敗したら差を出さず、取り直しを出す", async ({ page }) => {
  await open(page, { fail: true });
  await expect(page.locator(".racer-official-stats .inline-fetch-error__retry")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".racer-official-winbars")).toHaveCount(0);
  await expect(page.locator(".racer-official-stats")).not.toContainText("全選手の同じコースの1着率");
});
