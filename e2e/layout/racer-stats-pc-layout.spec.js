// 選手ページの PC の並び、後半（src/components/racer/RacerPerformanceStatsPc.css）。
// 1200px 以上: 成績・調子は 左に選手調子→全国勝率の推移→平均ST｜右に条件別、絞り込みの枠は 会場別｜枠番別＋決まり手。
// 右の列は1つの入れ物で、枠番別と決まり手の間を空けない（会場の多い選手で約100px 空いた、ファン評価 P2）。
// 1199px 以下は今の縦並びのまま
import { test, expect } from "../fixtures.js";

const box = (page, selector) =>
  page.locator(selector).first().evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left };
  });

const VENUE = ".racer-vc-pair > .racer-technique-profile";
const COURSE = ".racer-vc-pair-side > .racer-technique-profile:first-child";

async function openRacer(page) {
  await page.goto("/racer/4320", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".racer-cond-stats")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(VENUE)).toBeVisible({ timeout: 30000 });
}

test.describe("レイアウト: 選手ページの PC の並び（後半）", () => {
  test("1200px 以上は2列で、右の列に隙間が無く、横にはみ出さない", async ({ page }) => {
    test.skip(page.viewportSize().width < 1200, "1200px 以上だけの並び");
    await openRacer(page);

    const chart = await box(page, "#racer-stats > .racer-stat-chart");
    const cond = await box(page, ".racer-cond-stats");
    expect(cond.left, "条件別が勝率の推移の右").toBeGreaterThan(chart.left + 100);

    const venue = await box(page, VENUE);
    const course = await box(page, COURSE);
    expect(course.left, "枠番別が会場別の右").toBeGreaterThan(venue.left + 100);
    expect(Math.abs(course.top - venue.top), "会場別と枠番別の上端").toBeLessThan(2);

    // 決まり手は枠番別のすぐ下（カードの下の余白 16px ほど）
    const side = page.locator(".racer-vc-pair-side > .racer-technique-profile");
    if ((await side.count()) > 1) {
      const tech = await box(page, ".racer-vc-pair-side > .racer-technique-profile:nth-child(2)");
      expect(tech.top - course.bottom, "枠番別と決まり手の間").toBeLessThan(24);
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "横のはみ出し").toBeLessThanOrEqual(2);
  });

  test("1199px 以下は今の縦並び（会場別→枠番別、勝率の推移→条件別）", async ({ page }) => {
    test.skip(page.viewportSize().width >= 1200, "1199px 以下だけ");
    await openRacer(page);
    const venue = await box(page, VENUE);
    const course = await box(page, COURSE);
    expect(course.top, "枠番別が会場別の下").toBeGreaterThan(venue.bottom - 1);
    const chart = page.locator("#racer-stats > .racer-stat-chart");
    if ((await chart.count()) > 0) {
      const c = await box(page, "#racer-stats > .racer-stat-chart");
      const cond = await box(page, ".racer-cond-stats");
      expect(cond.top, "条件別が勝率の推移の下").toBeGreaterThan(c.bottom - 1);
    }
  });
});
