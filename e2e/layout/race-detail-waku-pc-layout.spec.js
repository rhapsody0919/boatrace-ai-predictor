// 枠別情報タブの PC の並び（オーナー承認 2026-11-25、src/components/race/RaceWakuInfoTabPc.css）。
// 1200px 以上: 上は6艇表（左）と選んだ選手のコース別成績（右）の2列、下の3枚は3列。
// 1199px 以下: 今の縦並びのまま（右の見出しは出さない）
import { test, expect } from "../fixtures.js";

const PATH = "/race/2026-09-27-02-11?tab=waku";
// 6艇表の直近3期は録画に無いので、e2e/race-detail-six-boat-course.spec.js と同じ形で差し替える
const TERMS = [
  ["2024-11-01", "2025-04-30"],
  ["2025-05-01", "2025-10-31"],
  ["2025-11-01", "2026-04-30"],
];

async function openWaku(page) {
  await page.route("**/rest/v1/racer_period_stats?*", (route) =>
    route.fulfill({
      json: TERMS.map(([calc_from, calc_to], i) => ({
        period_year: 2025 + (i > 0 ? 1 : 0),
        period_no: i === 1 ? 1 : 2,
        calc_from,
        calc_to,
        starts: 100,
        c1_entries: 30,
        c1_p1: 20,
        c1_p2: 5,
        c1_p3: 3,
      })),
    }),
  );
  await page.route("**/rest/v1/rpc/get_course_win_rate_baseline", (route) =>
    route.fulfill({
      json: {
        terms: TERMS.map(([calc_from, calc_to]) => ({ calc_from, calc_to })),
        national: { 1: { winRate: 55.2 } },
        venue: { from: "2025-12-01", to: "2026-09-26", byCourse: {} },
      },
    }),
  );
  await page.goto(PATH, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".six-boat-course tbody tr").first()).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator(".rwit-detail > .rwit-chip-row")).toBeVisible();
}

const boxOf = (page, selector) =>
  page.locator(selector).first().evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, bottom: r.bottom };
  });

test.describe("レイアウト: 枠別情報の PC の並び", () => {
  test("1200px 以上は上が左右2列・下が3列で、横にはみ出さない", async ({
    page,
  }) => {
    test.skip(
      page.viewportSize().width < 1200,
      "1200px 以上だけの並び（1199px 以下は下の試験）",
    );
    await openWaku(page);
    const left = await boxOf(page, ".rwit-top > .six-boat-course");
    const right = await boxOf(page, ".rwit-detail");
    expect(Math.abs(left.y - right.y), "左右の上端").toBeLessThan(2);
    expect(right.x, "右のカードは6艇表の右").toBeGreaterThan(left.x + left.w);
    await expect(page.locator(".rwit-detail-title")).toBeVisible();

    // チップは 3×2（5＋1 の折れを出さない）
    const chipTops = await page
      .locator(".rwit-detail .rwit-boat-chip")
      .evaluateAll((es) => es.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(chipTops).size, "チップの行の数").toBe(2);

    // 下の3枚は同じ行に並ぶ
    const lower = await page
      .locator(".rwit-lower > .race-split")
      .evaluate((split) =>
        [...split.querySelectorAll(":scope > .race-split__main > *, :scope > .race-split__side")]
          .filter((e) => e.getBoundingClientRect().height > 0)
          .map((e) => Math.round(e.getBoundingClientRect().top)),
      );
    expect(lower.length, "下のカードの数").toBe(3);
    expect(Math.max(...lower) - Math.min(...lower), "下の3枚の上端").toBeLessThan(2);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "横スクロール").toBe(0);
  });

  test("1199px 以下は縦に積み、右の見出しを出さない", async ({ page }) => {
    test.skip(page.viewportSize().width >= 1200, "1199px 以下だけの並び");
    await openWaku(page);
    await expect(page.locator(".rwit-detail-title")).toBeHidden();
    const table = await boxOf(page, ".rwit-top > .six-boat-course");
    const chips = await boxOf(page, ".rwit-detail > .rwit-chip-row");
    expect(chips.y, "チップは6艇表の下").toBeGreaterThanOrEqual(table.bottom - 1);
  });
});
