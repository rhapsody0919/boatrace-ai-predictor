import { test, expect } from "./fixtures.js";

/**
 * 会場ページの節と日目の行と「1R〜12R」のボタン（公式の形、docs/design/venue-race-card-redesign/approved.md）。
 * 節の行は全グレード（一般戦は札なし）。本日は次の発走より前を「終わった」、そのレースを「次」。過去日付は状態なし。
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

const entry = (i) => ({ number: i, name: `選手${i}`, grade: "B1" });

const edgeData = ({ raceGrade, raceTitle }) => ({
  generatedAt: `${DATE}T00:00:00Z`,
  updatedAt: `${DATE}T00:00:00Z`,
  races: Array.from({ length: 12 }, (_, i) => i + 1).map((n) => ({
    raceId: `${DATE}-${String(VENUE).padStart(2, "0")}-${String(n).padStart(2, "0")}`,
    venueCode: VENUE,
    raceNumber: n,
    startTime: startOf(n),
    raceGrade,
    raceTitle,
    seriesDay: 6,
    entries: [1, 2, 3, 4, 5, 6].map(entry),
    predictions: {},
    exhibitionData: [],
  })),
});

async function open(
  page,
  { path = `/venue/${VENUE}`, raceGrade = "G3", raceTitle = LONG_TITLE } = {},
) {
  await page.clock.setFixedTime(new Date(`${DATE}T14:00:00+09:00`)); // 9R 14:30 が次
  await page.route("**/api/predictions/**", (route) =>
    route.fulfill({ json: edgeData({ raceGrade, raceTitle }) }),
  );
  await page.goto(path);
  await expect(page.locator(".race-card")).toHaveCount(12, { timeout: 20000 });
  return page.getByTestId("venue-meet-heading");
}

const raceButtons = (heading) =>
  heading.getByRole("navigation").getByRole("button");

for (const width of [375, 768, 1440]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("本日: 節の行・日付と日目・1R〜12R（9R の前は終わった、9R は次）を出し、横にはみ出さない", async ({
      page,
    }) => {
      const heading = await open(page);
      const meet = heading.locator(".venue-meet-heading__meet");
      await expect(meet).toHaveText(`G3${LONG_TITLE.normalize("NFKC")}`);
      await expect(heading).toContainText("9月28日 / 6日目");
      const states = await raceButtons(heading).evaluateAll((bs) =>
        bs.map((b) => `${b.textContent}:${b.className.match(/is-(\w+)/)?.[1]}`),
      );
      const want = (n) => (n < 9 ? "done" : n === 9 ? "next" : "upcoming");
      expect(states).toEqual(
        Array.from(
          { length: 12 },
          (_, i) => `${i + 1}R${i === 8 ? "14:30" : ""}:${want(i + 1)}`,
        ),
      );
      const boxes = await raceButtons(heading).evaluateAll((bs) =>
        bs.map((b) => b.getBoundingClientRect()),
      );
      expect(Math.min(...boxes.map((b) => b.height))).toBeGreaterThanOrEqual(
        44,
      );
      if (width >= 768) expect(new Set(boxes.map((b) => b.top)).size).toBe(1);
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
    await expect(raceButtons(heading)).toHaveCount(12);
    await expect(
      heading.locator(".is-done, .is-next, .is-upcoming"),
    ).toHaveCount(0);
  });
});
