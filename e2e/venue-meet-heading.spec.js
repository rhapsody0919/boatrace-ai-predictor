import { test, expect } from "./fixtures.js";

/**
 * 会場ページの節と日目の行と「1R〜12R」のボタン（公式の形、docs/design/venue-race-card-redesign/approved.md）。
 *
 * - 節の行はグレード（SG〜G3）と節の名前を全グレードで出す（一般戦は札なし）
 * - 日付と日目（getVenueSeriesDayLabel。トップの会場カード・レース詳細の見出しと同じ値）
 * - 本日は、次の発走レースより前を「終わった」、そのレースを「次」にする。過去日付は状態を付けない
 * - ボタンを押すとそのレースの塊へ移る
 *
 * レースの並びは Edge API を差し替えて固定する（venue-next-race.spec.js と同じ。1R 10:30 〜 12R 16:00、30分おき）。
 */

const DATE = "2026-09-28";
const VENUE = 5;
const LONG_TITLE =
  "ＡＬ・ＲＢ大宮アルディージャＷＯＭＥＮカップ　第２０回日刊スポーツ杯争奪戦";
const startOf = (n) => {
  const m = 10 * 60 + 30 + (n - 1) * 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

const edgeData = ({ raceGrade, raceTitle }) => ({
  generatedAt: `${DATE}T00:00:00Z`,
  updatedAt: `${DATE}T00:00:00Z`,
  races: Array.from({ length: 12 }, (_, i) => i + 1).map((n) => ({
    raceId: `${DATE}-${String(VENUE).padStart(2, "0")}-${String(n).padStart(2, "0")}`,
    venueCode: VENUE,
    venue: "多摩川",
    raceNumber: n,
    startTime: startOf(n),
    raceGrade,
    raceTitle,
    seriesDay: 6,
    isFinalDay: false,
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

async function open(
  page,
  { path = `/venue/${VENUE}`, raceGrade = "G3", raceTitle = LONG_TITLE } = {},
) {
  // 8R 14:00 は締切、9R 14:30 が次
  await page.clock.setFixedTime(new Date(`${DATE}T14:00:00+09:00`));
  await page.route("**/api/predictions/**", (route) =>
    route.fulfill({ json: edgeData({ raceGrade, raceTitle }) }),
  );
  await page.goto(path);
  await expect(page.locator(".race-card")).toHaveCount(12, { timeout: 20000 });
  return page.getByTestId("venue-meet-heading");
}

const raceButtons = (heading) =>
  heading.getByRole("navigation").getByRole("button");

for (const width of [375, 1440]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("本日: 節の行・日付と日目・1R〜12R（9R の前は終わった、9R は次）を出し、横にはみ出さない", async ({
      page,
    }) => {
      const heading = await open(page);
      await expect(heading.locator(".venue-meet-heading__grade")).toHaveText(
        "G3",
      );
      await expect(heading.locator(".venue-meet-heading__title")).toHaveText(
        LONG_TITLE.normalize("NFKC"),
      );
      await expect(heading.locator(".venue-meet-heading__day")).toHaveText(
        "9月28日 / 6日目",
      );
      const buttons = raceButtons(heading);
      await expect(buttons).toHaveCount(12);
      for (let i = 0; i < 12; i++) {
        await expect(buttons.nth(i)).toHaveText(`${i + 1}R`);
        const want = i < 8 ? "is-done" : i === 8 ? "is-next" : "is-upcoming";
        await expect(buttons.nth(i)).toHaveClass(new RegExp(want));
      }
      await expect(buttons.nth(8)).toHaveAttribute("aria-current", "true");
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}

test.describe("押して移る・過去日付・一般戦", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test("「5R」を押すと 5R の塊がヘッダーの直下へ来る", async ({ page }) => {
    const heading = await open(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await raceButtons(heading).nth(4).click();
    const headerBottom = await page
      .locator(".app-header")
      .evaluate((e) => e.getBoundingClientRect().bottom);
    const fiveR = page.locator(".race-grid > .race-card").nth(4);
    await expect(fiveR).toContainText("5R");
    await expect
      .poll(() => fiveR.evaluate((e) => e.getBoundingClientRect().top))
      .toBeLessThan(headerBottom + 40);
  });

  test("過去日付は終わった・次の状態を付けない。一般戦はグレードの札を出さず節の名前だけ", async ({
    page,
  }) => {
    const heading = await open(page, {
      path: `/races/${DATE}/${VENUE}`,
      raceGrade: "ippan",
      raceTitle: "一般戦の節",
    });
    await expect(heading.locator(".venue-meet-heading__grade")).toHaveCount(0);
    await expect(heading.locator(".venue-meet-heading__title")).toHaveText(
      "一般戦の節",
    );
    const buttons = raceButtons(heading);
    await expect(buttons).toHaveCount(12);
    for (let i = 0; i < 12; i++) {
      await expect(buttons.nth(i)).not.toHaveClass(/is-(done|next|upcoming)/);
    }
  });
});
