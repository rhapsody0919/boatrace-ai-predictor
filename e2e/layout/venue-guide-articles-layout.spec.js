import { test, expect } from "../fixtures.js";
import { inspectGrids, expectNoWastedGrids } from "./helpers.js";

/**
 * 会場ページの「<会場>の攻略記事」（BOA-1692 GS02 V2）の並び。
 * 本数は会場で変わる（戸田1本・平和島2本、上限3本）。上限3列の固定列だと
 * 1〜2本の会場で右に空の列が残るため、本数を差し替えて空トラックが出ないことを見る。
 * レースの並びは Edge API を差し替えて固定する（e2e/venue-guide-articles.spec.js と同じ形）。
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

test.describe("レイアウト: 会場ページの攻略記事は本数が列数より少なくても空の列を残さない（BOA-1692） @blog", () => {
  for (const { venue, count } of [
    { venue: 2, count: 1 },
    { venue: 4, count: 2 },
  ]) {
    test(`/venue/${venue}: 記事${count}本のとき空トラックが出ない`, async ({
      page,
    }) => {
      await page.clock.setFixedTime(new Date(`${DATE}T09:00:00+09:00`));
      await page.route("**/api/predictions/**", (route) =>
        route.fulfill({ json: edgeData(venue) }),
      );
      await page.goto(`/venue/${venue}`);
      const section = page.getByTestId("venue-guide-articles");
      await expect(section.locator('a[href^="/blog/"]')).toHaveCount(count, {
        timeout: 20000,
      });
      await section.scrollIntoViewIfNeeded();
      const result = await inspectGrids(page);
      expectNoWastedGrids({
        ...result,
        found: result.found.filter((f) =>
          f.cls.includes("venue-guide-articles"),
        ),
      });
    });
  }
});
