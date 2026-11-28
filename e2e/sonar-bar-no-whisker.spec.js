import { test, expect } from "./fixtures.js";
import { routeAnalogyV16 } from "./analogy-v16-fixture.js";

/**
 * 龍神ソナーの割合の横棒（analogy/RateBar.jsx）は、ぶれ幅のひげと凡例「件数が少ないときのぶれ幅」を出さない
 * （2026-11-29 オーナー承認、plan.md §14 の「ひげは外し、説明は「?」へ」）。説明は見出し・凡例の「?」で開く。
 * 予想の Edge API・Supabase REST・ソナーの API は固定の応答に差し替え、DB に依存しない
 */

const DATE = "2026-09-22";
const RACE = `${DATE}-09-01`;
const entries = [1, 2, 3, 4, 5, 6].map((i) => ({
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
}));
const edgeData = {
  generatedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  races: [
    {
      raceId: RACE,
      venueCode: 9,
      venue: "津",
      raceNumber: 1,
      startTime: "23:50",
      raceGrade: "G1",
      raceStage: "準優勝戦",
      cancellationStatus: null,
      entries,
      predictions: null,
      exhibitionData: [],
      result: null,
    },
  ],
};

async function setup(page) {
  await page.addInitScript(() => {
    localStorage.setItem("boatai-language", "ja");
    localStorage.setItem("boatai:cookie-consent", "accepted");
  });
  await page.route("**/api/predictions/**", (route) =>
    route.fulfill({ json: edgeData }),
  );
  await page.route("**/rest/v1/**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("**/api/analogy/contribution*", (route) =>
    route.fulfill({ json: { available: false, stageMissing: true } }),
  );
  await routeAnalogyV16(page);
}

const sectionOf = (page) => page.getByRole("region", { name: /龍神ソナー/ });

test.describe("ソナーの割合の棒はひげを出さず、説明は「?」（2026-11-29）", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page);
  });

  test("類似レース: 棒にひげと凡例が無く、見出しの「?」で説明が開く", async ({
    page,
  }) => {
    await page.goto(`/race/${RACE}?tab=sonar&sonar=similar`);
    const section = sectionOf(page);
    await expect(section.locator(".af-bar").first()).toBeVisible({
      timeout: 20000,
    });
    await expect(section.locator(".af-bar .af-trk-w")).toHaveCount(0);
    await expect(section).not.toContainText("件数が少ないときのぶれ幅");
    const win = section.locator("h4", { hasText: "どの艇が勝った？" });
    await win.locator(".term-hint__button").click();
    await expect(page.locator(".term-hint__popover")).toContainText(
      "件数が少ないほど割合はぶれやすい",
    );
    await expect(
      section
        .locator("h4", { hasText: "どう決まった？" })
        .locator(".term-hint__button"),
    ).toBeVisible();
  });

  test("展開シナリオ: 結果の棒にひげと凡例が無く、凡例の行に「?」がある", async ({
    page,
  }) => {
    await page.goto(`/race/${RACE}?tab=sonar&sonar=scenario`);
    const section = sectionOf(page);
    await expect(section.locator(".af-bar").first()).toBeVisible({
      timeout: 20000,
    });
    await expect(section.locator(".af-bar .af-trk-w")).toHaveCount(0);
    await expect(section).not.toContainText("件数が少ないときのぶれ幅");
    await expect(
      section.locator(".af-key .term-hint__button").first(),
    ).toBeVisible();
  });
});
