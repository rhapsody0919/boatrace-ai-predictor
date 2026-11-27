// 出走表（基本情報）の想定コース1着率の下に、全国の同じコースとの差を出す（見せ方の型1を狭いセル向けに文字で、意味づけ 2026-11-26 オーナー承認）。
// ▲緑は差が偶然の幅を超えたときだけ。走数が差を出す線未満・偶然の幅に収まる差は灰で印なし（枠別情報の6艇の表と同じ判定）。
import { test, expect } from "./fixtures.js";

// 1コース: 3期で120走・1着90（75.0%）。全国 55.2% との差は偶然の幅を超える
const strong = [
  [2025, 2, "2024-11-01", "2025-04-30", 40, 30],
  [2026, 1, "2025-05-01", "2025-10-31", 40, 30],
  [2026, 2, "2025-11-01", "2026-04-30", 40, 30],
];
// 1コース: 102走・1着63（61.8%）。全国 55.2% との差は偶然の幅に収まる
const plain = [
  [2025, 2, "2024-11-01", "2025-04-30", 35, 20],
  [2026, 1, "2025-05-01", "2025-10-31", 30, 20],
  [2026, 2, "2025-11-01", "2026-04-30", 37, 23],
];

async function open(page, terms) {
  await page.route("**/rest/v1/racer_period_stats?*", (route) => route.fulfill({
    json: terms.map(([period_year, period_no, calc_from, calc_to, n, p1]) => ({
      period_year, period_no, calc_from, calc_to, starts: 100,
      c1_entries: n, c1_p1: p1,
      // 2コースは3期で15走（10走以上・30走未満）: 率は出すが色は付けない
      c2_entries: 5, c2_p1: 1,
    })),
  }));
  await page.route("**/rest/v1/rpc/get_course_win_rate_baseline", (route) => route.fulfill({
    json: { terms: terms.map(([, , calc_from, calc_to]) => ({ calc_from, calc_to })),
      national: { 1: { winRate: 55.2 }, 2: { winRate: 13.5 } },
      venue: { from: "2025-12-01", to: "2026-09-26", byCourse: { 1: { winRate: 30.0 } } } },
  }));
  await page.goto("/race/2026-09-27-02-11");
  await page.locator(".race-tabs-btn", { hasText: "基本情報" }).first().click();
  const row = page
    .locator(".drt-table tbody tr")
    .filter({ has: page.locator(".drt-label-full", { hasText: /^想定コース1着率$/ }) })
    .first();
  await expect(row.locator(".drt-course-diff").first()).toBeVisible({ timeout: 30000 });
  return row;
}

for (const width of [375, 1440]) {
  test(`想定コース1着率の下に全国との差、偶然の幅を超えた艇だけ緑▲ ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const row = await open(page, strong);
    const cells = row.locator("td.drt-cell");
    // 1号艇（1コース）: 75% − 55% = +20pt、緑▲
    const first = cells.nth(0).locator(".drt-course-diff");
    await expect(first).toHaveText("▲+20pt");
    await expect(first).toHaveClass(/drt-course-diff--good/);
    // 2号艇（2コース、15走）: 差は出すが灰で印なし
    const second = cells.nth(1).locator(".drt-course-diff");
    await expect(second).toHaveClass(/drt-course-diff--plain/);
    await expect(second).not.toContainText(/[▲▼]/);
    const colors = await Promise.all([first, second].map((l) => l.evaluate((el) => getComputedStyle(el).color)));
    expect(colors[0]).not.toBe(colors[1]);
    await expect(row).toContainText("全国の同じコースの1着率との差");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test("差が偶然の幅に収まる艇は灰で印なし", async ({ page }) => {
  const row = await open(page, plain);
  const first = row.locator("td.drt-cell").nth(0).locator(".drt-course-diff");
  await expect(first).toHaveText("+7pt");
  await expect(first).toHaveClass(/drt-course-diff--plain/);
});
