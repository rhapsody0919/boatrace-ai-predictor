import { test, expect } from "./fixtures.js";
import { stubRacerScopedRuns, runDates } from "./racer-scoped-stub.js";

const terms = [
  [2025, 2, "2024-11-01", "2025-04-30", 35, 20, 6, 4],
  [2026, 1, "2025-05-01", "2025-10-31", 30, 20, 5, 3],
  [2026, 2, "2025-11-01", "2026-04-30", 37, 23, 6, 4],
];
async function open(page, { error = false, loading = false, gap = false } = {}) {
  await page.route("**/rest/v1/racer_period_stats?*", (route) => route.fulfill({
    json: terms.map(([period_year, period_no, calc_from, calc_to, n, p1, p2, p3]) => ({
      period_year, period_no, calc_from, calc_to, starts: gap && period_no === 1 ? 0 : 100,
      c1_entries: n, c1_p1: p1, c1_p2: p2, c1_p3: p3,
      c2_entries: 5, c2_p1: 1, c3_entries: 1, c3_p1: 1,
    })),
  }));
  await page.route("**/rest/v1/rpc/get_course_win_rate_baseline", (route) => {
    if (loading) return new Promise(() => {});
    return route.fulfill(error ? { status: 500, json: { message: "test failure" } } : {
      json: { terms: terms.map(([, , calc_from, calc_to]) => ({ calc_from, calc_to })),
        national: { 1: { winRate: 55.2 } },
        venue: { from: "2025-12-01", to: "2026-09-26", byCourse: { 1: { winRate: 52.0 } } } },
    });
  });
  await page.goto("/race/2026-09-27-02-11");
  await page.locator(".race-tabs-btn", { hasText: /^枠別情報$/ }).click();
}
for (const width of [375, 1440]) {
  test(`6艇の公式成績と行選択 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    const table = page.locator(".six-boat-course");
    await expect(table.locator("tbody tr")).toHaveCount(6);
    await expect(table).toContainText("2024/11/01〜2026/04/30");
    const first = table.locator("tbody tr").nth(0);
    for (const value of ["61.8", "+6.6pt", "平均55.2", "78.4", "89.2", "102"]) {
      await expect(first).toContainText(value);
    }
    await expect(first.locator("[translate=no]")).toBeVisible();
    const diff = first.locator(".six-boat-course-diff");
    expect(await diff.evaluate((el) => getComputedStyle(el).color)).toBe(
      await first.evaluate((el) => getComputedStyle(el).color));
    await expect(table.locator("tbody tr").nth(1)).toHaveClass(/is-muted/);
    await expect(table.locator("tbody tr").nth(1).locator(".six-boat-course-diff")).toHaveText("—");
    await expect(table.locator("tbody tr").nth(2).locator("td").nth(1)).toContainText("—");
    await expect(table.locator("tbody tr").nth(2)).toContainText("⚠");
    await table.locator("tbody tr").nth(3).click();
    await expect(page.locator(".rwit-boat-chip").nth(3)).toHaveAttribute("aria-pressed", "true");
    await expect(table.locator("tbody tr").nth(3)).toHaveAttribute("aria-selected", "true");
    await table.locator("tbody tr").nth(1).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".rwit-boat-chip").nth(1)).toHaveAttribute("aria-pressed", "true");
    expect(await table.evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThan(
      await page.locator(".rwit-chip-row").first().evaluate((el) => el.getBoundingClientRect().top));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
test("取得失敗では表と0%を出さない", async ({ page }) => {
  await open(page, { error: true });
  await expect(page.locator(".six-boat-course")).toContainText("直近3期のコース別成績を読み込めませんでした。");
  await expect(page.locator(".six-boat-course table")).toHaveCount(0);
});
test("取得中は読み込み表示", async ({ page }) => {
  await open(page, { loading: true });
  await expect(page.locator(".six-boat-course .rwit-loading")).toBeVisible();
  await expect(page.locator(".six-boat-course table")).toHaveCount(0);
});

test("出走のない期を除いた行に印を出す", async ({ page }) => {
  await open(page, { gap: true });
  await expect(page.locator(".six-boat-course tbody tr").first()).toContainText("出走のない期を除く");
  await expect(page.locator(".six-boat-course-notes p")).toHaveCount(3);
});

// 当地: 1号艇の選手（スタブでは6人とも同じ走）が会場02・実進入1コースで12走・1着7（BOA-1294）
const localRuns = runDates(12).map((date, i) => ({
  date, venue: 2, course: 1, rank1: i < 7 ? 1 : 2, technique: i < 7 ? "逃げ" : "差し",
}));

test("当地に切り替えると当社データの当地の値と会場平均との差になり、タブを移っても保つ", async ({ page }) => {
  await stubRacerScopedRuns(page, localRuns);
  await open(page);
  const table = page.locator(".six-boat-course");
  const recent3 = table.getByRole("button", { name: "直近3期", exact: true });
  const local = table.getByRole("button", { name: "当地", exact: true });
  await expect(recent3).toHaveAttribute("aria-pressed", "true");
  await local.click();
  await expect(local).toHaveAttribute("aria-pressed", "true");
  await expect(table).toContainText("2025/12/01〜2026/09/26");
  const first = table.locator("tbody tr").nth(0);
  for (const value of ["58.3", "+6.3pt", "平均52.0", "12"]) {
    await expect(first).toContainText(value);
  }
  await expect(first.locator(".six-boat-course-diff")).toHaveAttribute("title", "この会場の同じコース平均との差");
  await expect(table.locator("thead")).toContainText("この会場の同じコース平均との差");
  // 2号艇は当地の2コースの走が無い → 率を出さない
  await expect(table.locator("tbody tr").nth(1).locator("td").first()).toContainText("—");
  await page.locator(".race-tabs-btn", { hasText: /^基本情報$/ }).click();
  await page.locator(".race-tabs-btn", { hasText: /^枠別情報$/ }).click();
  await expect(table.getByRole("button", { name: "当地", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(table.locator("tbody tr").nth(0)).toContainText("58.3");
});

test("当地で選手の走の取得に失敗した艇は0%にせず失敗の印を出す", async ({ page }) => {
  await stubRacerScopedRuns(page, [], { fail: true });
  await open(page);
  const table = page.locator(".six-boat-course");
  await table.getByRole("button", { name: "当地", exact: true }).click();
  const first = table.locator("tbody tr").nth(0);
  await expect(first).toContainText("当地の成績を読み込めませんでした");
  await expect(first).not.toContainText("0.0");
});

test("1艇ずつの表の先頭に6艇の表と同じ直近3期の行を出す（BOA-1295）", async ({ page }) => {
  await stubRacerScopedRuns(page, localRuns);
  await open(page);
  const head = page.locator(".rwit-today-table tbody tr").first();
  await expect(head.locator("th")).toHaveText("直近3期");
  for (const value of ["61.8", "78.4", "89.2", "102"]) await expect(head).toContainText(value);
  await expect(head).not.toContainText("⚠");
  // 2号艇（2コース15走・1着3）は件数の線（30走）に届かないので ⚠
  await page.locator(".six-boat-course tbody tr").nth(1).click();
  await expect(head).toContainText("20.0");
  await expect(head).toContainText("15");
  await expect(head.locator(".rwit-grid-warn")).toBeVisible();
  // 3号艇（3コース3走）は率を出さない
  await page.locator(".six-boat-course tbody tr").nth(2).click();
  await expect(head.locator(".rwit-today-empty")).toHaveCount(3);
  // 全コース6列の表には足さない
  await expect(page.locator(".rwit-grid tbody th", { hasText: "直近3期" })).toHaveCount(0);
});

for (const width of [375, 1440]) {
  test(`1着率の列見出しに差の意味を出し、選んだ行に印を付ける ${width}px（BOA-1327）`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    const table = page.locator(".six-boat-course");
    await expect(table.locator("thead th").nth(1).locator("small", { hasText: "全選手の同じコース平均との差" })).toBeVisible();
    await table.locator("tbody tr").nth(3).click();
    const shadow = (i) => table.locator("tbody tr").nth(i).evaluate((el) => getComputedStyle(el).boxShadow);
    await expect.poll(() => shadow(3)).not.toBe("none");
    expect(await shadow(0)).toBe("none");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
