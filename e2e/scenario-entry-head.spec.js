import { test, expect } from "./fixtures.js";
import { routeAnalogyV16 } from "./analogy-v16-fixture.js";

/**
 * 展開シナリオ STEP1 の進入の表の見出しは「1号艇1着率」を1行で出す（1440 で「率」だけ2行目に落ちた。
 * 2026-11-29 オーナー承認、レーン G1 の点検の案 D）。行の読み上げ（af-sr-only）の「1号艇の1着率」は変えない。
 * 予想の Edge API・Supabase REST・ソナーの API は固定の応答に差し替え、DB に依存しない
 */

const RACE = "2026-09-22-09-01";
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

test.describe("展開シナリオ STEP1 の見出し「1号艇1着率」は1行（2026-11-29）", () => {
  for (const [width, height] of [
    [1440, 900],
    [375, 812],
  ]) {
    test(`${width}px: 見出しが1行で、読み上げの行は「1号艇の1着率」のまま`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await setup(page);
      await page.goto(`/race/${RACE}?tab=sonar&sonar=scenario`);
      const head = page.locator(".af-ent-head span").last();
      await expect(head).toHaveText("1号艇1着率", { timeout: 20000 });
      const { h, lh } = await head.evaluate((el) => ({
        h: el.getBoundingClientRect().height,
        lh: parseFloat(getComputedStyle(el).lineHeight) || 0,
      }));
      expect(h).toBeLessThan((lh || 20) * 1.5);
      await expect(
        page.locator(".af-ents .af-sr-only", { hasText: "1号艇の1着率" }).first(),
      ).toBeAttached();
    });
  }
});
