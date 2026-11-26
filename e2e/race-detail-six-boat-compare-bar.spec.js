// 枠別情報タブの6艇のコース別成績に、全国の同じコースとの差の棒（見せ方の型1、意味づけ 2026-11-26 オーナー承認）を出す。
// 緑▲は差が偶然の幅を超えたときだけ、走数が差を出す線未満は点線、当地は色を付けない。
import { test, expect } from "./fixtures.js";
import { stubRacerScopedRuns, runDates } from "./racer-scoped-stub.js";

// 1コース: 3期で120走・1着90（75.0%）・2着12・3着9（p2・p3 は着の回数）。全国 55.2% との差は偶然の幅（1.96）を超える
const strong = [
  [2025, 2, "2024-11-01", "2025-04-30", 40, 30, 4, 3],
  [2026, 1, "2025-05-01", "2025-10-31", 40, 30, 4, 3],
  [2026, 2, "2025-11-01", "2026-04-30", 40, 30, 4, 3],
];
// 1コース: 102走・1着63（61.8%）。全国 55.2% との差は偶然の幅に収まる（既存の race-detail-six-boat-course と同じ値）
const plain = [
  [2025, 2, "2024-11-01", "2025-04-30", 35, 20, 6, 4],
  [2026, 1, "2025-05-01", "2025-10-31", 30, 20, 5, 3],
  [2026, 2, "2025-11-01", "2026-04-30", 37, 23, 6, 4],
];

async function open(page, terms) {
  await page.route("**/rest/v1/racer_period_stats?*", (route) => route.fulfill({
    json: terms.map(([period_year, period_no, calc_from, calc_to, n, p1, p2, p3]) => ({
      period_year, period_no, calc_from, calc_to, starts: 100,
      c1_entries: n, c1_p1: p1, c1_p2: p2, c1_p3: p3,
      // 2コースは3期で15走（10走以上・30走未満）: 率は出すが差は出さない（点線）
      c2_entries: 5, c2_p1: 1,
    })),
  }));
  await page.route("**/rest/v1/rpc/get_course_win_rate_baseline", (route) => route.fulfill({
    json: { terms: terms.map(([, , calc_from, calc_to]) => ({ calc_from, calc_to })),
      national: { 1: { winRate: 55.2 }, 2: { winRate: 13.5 } },
      venue: { from: "2025-12-01", to: "2026-09-26", byCourse: { 1: { winRate: 30.0 } } } },
  }));
  await page.goto("/race/2026-09-27-02-11");
  await page.locator(".race-tabs-btn", { hasText: /^枠別情報$/ }).click();
  const table = page.locator(".six-boat-course");
  await expect(table.locator("tbody tr")).toHaveCount(6);
  return table;
}

for (const width of [375, 1440]) {
  test(`差が偶然の幅を超えた艇だけ緑▲、走数が少ない艇は点線 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const table = await open(page, strong);
    const first = table.locator("tbody tr").nth(0).locator(".compare-bar");
    await expect(first).toHaveClass(/compare-bar--good/);
    await expect(first.locator(".compare-bar__mark")).toHaveText("▲");
    await expect(first).toContainText("平均55.2");
    const second = table.locator("tbody tr").nth(1).locator(".compare-bar");
    await expect(second).toHaveClass(/compare-bar--few/);
    await expect(second.locator(".compare-bar__mark")).toHaveCount(0);
    await expect(table.locator(".six-boat-course-notes")).toContainText("偶然のぶれだけでは説明しにくい差");
    await expect(table.locator(".six-boat-course-notes")).not.toContainText("色は付けません");
    // 棒は1着率の列の中に収まる（横にはみ出さない）
    const cell = await table.locator("tbody tr").nth(0).locator("td").nth(0).boundingBox();
    const bar = await first.locator(".compare-bar__track").boundingBox();
    expect(bar.x).toBeGreaterThanOrEqual(cell.x - 1);
    expect(bar.x + bar.width).toBeLessThanOrEqual(cell.x + cell.width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test("差が偶然の幅に収まる艇は灰で印なし", async ({ page }) => {
  const table = await open(page, plain);
  const first = table.locator("tbody tr").nth(0).locator(".compare-bar");
  await expect(first).toHaveClass(/compare-bar--unclear/);
  await expect(first.locator(".compare-bar__mark")).toHaveCount(0);
});

test("当地は会場平均との差の棒を出すが色を付けない", async ({ page }) => {
  // 1号艇の選手が会場02・1コースで12走・1着11（91.7%）。会場平均 30.0% より大きく上でも色なし
  await stubRacerScopedRuns(page, runDates(12).map((date, i) => ({
    date, venue: 2, course: 1, rank1: i < 11 ? 1 : 2, technique: i < 11 ? "逃げ" : "差し",
  })));
  const table = await open(page, strong);
  await table.getByRole("button", { name: "当地", exact: true }).click();
  const first = table.locator("tbody tr").nth(0).locator(".compare-bar");
  await expect(first).toBeVisible();
  await expect(first).not.toHaveClass(/compare-bar--good|compare-bar--bad/);
});
