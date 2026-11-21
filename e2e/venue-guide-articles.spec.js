import { test, expect } from "./fixtures.js";

/**
 * 会場ページの「<会場>の攻略記事」の節（BOA-1692 GS02 V2）。
 *
 * - V1 のコース別の節（venue-course-section）の直後に、その会場の場別攻略の記事を最大3本
 * - 戸田は venue-toda の1本、平和島は venue-heiwajima → heiwajima-water-wind-guide の2本。
 *   開催向けの heiwajima-meet-ranking-guide は出さない
 * - ja 以外（en）では節を DOM に置かない。/races/:date/:venueCode でも出す
 *
 * レースの並びは Edge API を差し替えて固定する（venue-course-table.spec.js と同じ形）。
 */

const DATE = "2026-09-28";

const edgeData = (venue) => ({
  generatedAt: `${DATE}T00:00:00Z`,
  updatedAt: `${DATE}T00:00:00Z`,
  races: Array.from({ length: 12 }, (_, i) => i + 1).map((n) => ({
    raceId: `${DATE}-${String(venue).padStart(2, "0")}-${String(n).padStart(2, "0")}`,
    venueCode: venue,
    raceNumber: n,
    startTime: `${String(10 + Math.floor(n / 2)).padStart(2, "0")}:${n % 2 ? "30" : "00"}`,
    entries: [1, 2, 3, 4, 5, 6].map((i) => ({
      number: i,
      name: `テスト選手${i}`,
      grade: "B1",
      age: 30,
      winRate: 5.0,
      localWinRate: 5.0,
      motorNumber: i,
      motor2Rate: 35,
      boatNumber: i,
      boat2Rate: 35,
    })),
    predictions: {},
    exhibitionData: [],
    result: null,
  })),
});

async function open(page, venue, path = `/venue/${venue}`) {
  await page.clock.setFixedTime(new Date(`${DATE}T09:00:00+09:00`));
  await page.route("**/api/predictions/**", (route) =>
    route.fulfill({ json: edgeData(venue) }),
  );
  await page.goto(path);
  await expect(page.locator(".race-card")).toHaveCount(12, { timeout: 20000 });
  await expect(page.getByTestId("venue-course-section")).toBeAttached({
    timeout: 20000,
  });
}

const CASES = [
  { venue: 2, name: "戸田", ids: ["venue-toda"] },
  {
    venue: 4,
    name: "平和島",
    ids: ["venue-heiwajima", "heiwajima-water-wind-guide"],
  },
];

const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 1280, height: 800 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}px @blog`, () => {
    test.use({ viewport });

    for (const { venue, name, ids } of CASES) {
      test(`/venue/${venue}: コース別の節の直後に${name}の攻略記事${ids.length}本`, async ({
        page,
      }) => {
        await open(page, venue);
        const section = page.getByTestId("venue-guide-articles");
        await expect(section).toHaveCount(1);
        await expect(section.locator("h2")).toHaveText(`${name}の攻略記事`);
        const links = section.locator('a[href^="/blog/"]');
        await expect(links).toHaveCount(ids.length);
        for (let i = 0; i < ids.length; i++) {
          await expect(links.nth(i)).toHaveAttribute("href", `/blog/${ids[i]}`);
          await expect(links.nth(i)).toContainText("場別攻略");
        }
        await expect(
          page.locator('a[href="/blog/heiwajima-meet-ranking-guide"]'),
        ).toHaveCount(0);
        // 題は区切り（｜・ - ・ — ）の前まで
        const titles = await section
          .locator(".venue-guide-articles__title")
          .allTextContents();
        for (const title of titles) expect(title).not.toMatch(/｜| - | — /);
        // コース別の節の直後（間に他の要素を挟まない）
        const isNext = await page.evaluate(() => {
          const course = document.querySelector(
            '[data-testid="venue-course-section"]',
          );
          const guide = document.querySelector(
            '[data-testid="venue-guide-articles"]',
          );
          return (
            course.compareDocumentPosition(guide) &
              Node.DOCUMENT_POSITION_FOLLOWING &&
            course.nextElementSibling === guide
          );
        });
        expect(isNext).toBeTruthy();
        // 横あふれ無し
        await section.scrollIntoViewIfNeeded();
        await expect(section).toBeVisible();
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }

    test("/races/:date/2 でも戸田の攻略記事を出す", async ({ page }) => {
      await open(page, 2, `/races/${DATE}/2`);
      await expect(
        page.getByTestId("venue-guide-articles").locator('a[href^="/blog/"]'),
      ).toHaveCount(1);
    });

    test("/en/venue/2 では節を DOM に置かない", async ({ page }) => {
      await open(page, 2, "/en/venue/2");
      await expect(page.getByTestId("venue-guide-articles")).toHaveCount(0);
      await expect(page.locator('a[href*="/blog/venue-toda"]')).toHaveCount(0);
    });
  });
}
