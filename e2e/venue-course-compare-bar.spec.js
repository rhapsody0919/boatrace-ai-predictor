// 会場ページの進入コース別1着率に、全国の同じコースと比べる棒を出す（見せ方の型1・値の尺度、意味づけ 2026-11-26 オーナー承認）。
// 緑▲・赤▼は全国との差を言える1コースだけ（docs/reference/venue-summary-stats.md「言える範囲」）で、
// 24会場の線（vsNational.course1）を超えた会場だけ。2〜6コースは棒（位置）だけで色を付けない。
import { test, expect } from "./fixtures.js";
import { VENUE_SUMMARY_STATS as S } from "../src/data/venueSummaryStats.js";

async function openVenue(page, venue, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.route("**/api/predictions/**", (route) =>
    route.fulfill({ json: { generatedAt: null, updatedAt: null, races: [] } }),
  );
  await page.goto(`/venue/${venue}`, { waitUntil: "domcontentloaded" });
  const table = page.getByTestId("venue-course-table");
  await expect(table).toBeVisible({ timeout: 20000 });
  return table;
}

// 22 福岡は1コースが全国より高い、1 桐生は低い、8 常滑は差を言えない（静的な値で選ぶ）
const CASES = [
  { venue: 22, dir: "higher", text: "▲全国より出やすい" },
  { venue: 1, dir: "lower", text: "▼全国より出にくい" },
  { venue: 8, dir: null, text: null },
];

for (const width of [375, 1440]) {
  for (const c of CASES) {
    test(`会場${c.venue}: 1コースの向き ${c.dir ?? "なし"}、2〜6コースは色なし ${width}px`, async ({ page }) => {
      expect(S.venues[c.venue].vsNational.course1 ?? null).toBe(c.dir);
      const table = await openVenue(page, c.venue, width);
      const bars = table.locator(".venue-course-bar");
      await expect(bars).toHaveCount(6);
      const first = page.getByTestId("venue-course-row-1").locator(".venue-course-bar");
      await expect(first).toHaveAttribute("data-dir", c.dir ?? "none");
      if (c.text) await expect(first.locator(".venue-course-bar__mark")).toHaveText(c.text);
      else await expect(first.locator(".venue-course-bar__mark")).toHaveCount(0);
      // 2〜6コースは向きも印も出さない
      for (let course = 2; course <= 6; course += 1) {
        const bar = page.getByTestId(`venue-course-row-${course}`).locator(".venue-course-bar");
        await expect(bar).toHaveAttribute("data-dir", "none");
        await expect(bar.locator(".venue-course-bar__mark")).toHaveCount(0);
      }
      // 棒の長さはこの会場の率に比例し、｜（全国）は全国の率の位置
      const geo = await page.getByTestId("venue-course-row-1").evaluate((row) => {
        const track = row.querySelector(".venue-course-bar__track").getBoundingClientRect();
        const fill = row.querySelector(".venue-course-bar__fill").getBoundingClientRect();
        const nat = row.querySelector(".venue-course-bar__national").getBoundingClientRect();
        return { track: track.width, fill: fill.width, nat: nat.left + nat.width / 2 - track.left };
      });
      const v = S.venues[c.venue].courses[0].rate;
      const n = S.national.courses[0].rate;
      expect(geo.fill / geo.nat).toBeCloseTo(v / n, 1);
      await expect(page.locator(".venue-course-bar-note")).toContainText("1コースだけ");
      // 既存の決まり: 表の幅は 720px まで、セルからあふれない
      expect((await table.boundingBox()).width).toBeLessThanOrEqual(720);
      const overflows = await table.evaluate((el) =>
        [...el.querySelectorAll("th, td")].filter((cell) => cell.scrollWidth > cell.clientWidth + 0.5).length,
      );
      expect(overflows).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }
}
