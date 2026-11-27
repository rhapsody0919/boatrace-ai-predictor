// 枠別情報の6艇のコース別成績の注記が、画面の色の意味（灰色の棒＝差がはっきりしない、点線の枠＝走数が少ない、走数が少ない行は数字が灰）を書き分けていることを守る。
// 2026-11-27 の記事の審査で、注記の「走数が少ない艇は灰色」を、灰色の棒（偶然のぶれと区別できない差）と取り違えた
import { test, expect } from "./fixtures.js";

// 1コース: 102走・1着63（61.8%）。全国 55.2% との差は偶然の幅に収まる＝灰色の棒（race-detail-six-boat-compare-bar と同じ値）
const plain = [
  [2025, 2, "2024-11-01", "2025-04-30", 35, 20, 6, 4],
  [2026, 1, "2025-05-01", "2025-10-31", 30, 20, 5, 3],
  [2026, 2, "2025-11-01", "2026-04-30", 37, 23, 6, 4],
];

test("灰色の棒・点線の枠・灰色の行の数字を、注記が実際の画面どおりに書き分ける", async ({ page }) => {
  await page.route("**/rest/v1/racer_period_stats?*", (route) => route.fulfill({
    json: plain.map(([period_year, period_no, calc_from, calc_to, n, p1, p2, p3]) => ({
      period_year, period_no, calc_from, calc_to, starts: 100,
      c1_entries: n, c1_p1: p1, c1_p2: p2, c1_p3: p3,
      // 2コースは3期で15走（10走以上・30走未満）: 率は出すが差は出さない（点線の枠・行の数字は灰）
      c2_entries: 5, c2_p1: 1,
    })),
  }));
  await page.route("**/rest/v1/rpc/get_course_win_rate_baseline", (route) => route.fulfill({
    json: { terms: plain.map(([, , calc_from, calc_to]) => ({ calc_from, calc_to })),
      national: { 1: { winRate: 55.2 }, 2: { winRate: 13.5 } },
      venue: { from: "2025-12-01", to: "2026-09-26", byCourse: { 1: { winRate: 30.0 } } } },
  }));
  await page.goto("/race/2026-09-27-02-11");
  await page.locator(".race-tabs-btn", { hasText: /^枠別情報$/ }).click();
  const table = page.locator(".six-boat-course");
  await expect(table.locator("tbody tr")).toHaveCount(6);

  // 画面: 1号艇は灰色の棒、2号艇は点線の枠で、行は is-muted（数字が灰）
  const first = table.locator("tbody tr").nth(0);
  await expect(first.locator(".compare-bar")).toHaveClass(/compare-bar--unclear/);
  const second = table.locator("tbody tr").nth(1);
  await expect(second.locator(".compare-bar")).toHaveClass(/compare-bar--few/);
  await expect(second).toHaveClass(/is-muted/);
  const style = await second.locator(".compare-bar__bar").evaluate((el) => getComputedStyle(el).borderTopStyle);
  expect(style).toBe("dashed");

  // 注記: 3つの見た目の意味を、取り違えない言い方で書く
  const notes = table.locator(".six-boat-course-notes");
  await expect(notes).toContainText("灰色の棒は、偶然のぶれと区別できない差");
  await expect(notes).toContainText("点線の枠は、進入数が少なく差を出さない艇");
  await expect(notes).toContainText("行の数字を灰色にして差を出しません");
});
