// 選手ページの進入コース別成績（公式）の1着率の下に、全選手の同じコース（直近3期）との差を出す
// （見せ方の型1を文字で、意味づけ 2026-11-26 オーナー承認）。▲緑・▼赤は偶然のぶれを超えたときだけ。
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
  test(`1着率の下に全選手との差、偶然の幅を超えた差だけ緑▲ ${width}px`, async ({ page }) => {
    const table = await open(page, { width });
    const first = table.locator("tbody tr").nth(0).locator(".racer-official-course-diff");
    await expect(first).toBeVisible({ timeout: 30000 });
    await expect(first).toHaveAttribute("data-tone", "good");
    await expect(first).toHaveText(/^▲\+\d+\.\dpt$/);
    // 差の数字は「1着率 − 全選手」（小数1桁）
    const rate = Number((await table.locator("tbody tr").nth(0).locator("td").nth(1).textContent()).match(/[\d.]+/)[0]);
    const diff = Number((await first.textContent()).replace(/[^\d.+-]/g, ""));
    expect(Math.abs(rate - 10.0 - diff)).toBeLessThanOrEqual(0.15);
    await expect(page.locator(".racer-official-stats")).toContainText("全選手の同じコースの1着率（直近3期）との差");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test("基準の取得に失敗したら差を出さず、取り直しを出す", async ({ page }) => {
  const table = await open(page, { fail: true });
  await expect(page.locator(".racer-official-stats .inline-fetch-error__retry")).toBeVisible({ timeout: 30000 });
  await expect(table.locator(".racer-official-course-diff")).toHaveCount(0);
  await expect(page.locator(".racer-official-stats")).not.toContainText("全選手の同じコースの1着率");
});
