import { test, expect } from "./fixtures.js";
import { analogyV16Facts, routeAnalogyV16 } from "./analogy-v16-fixture.js";

const DATE = "2026-10-26";
const ID = `${DATE}-09-01`;
const absent = "欠場があったため、このレースの龍神ソナーは出していません";

async function setup(page, initial = "before_exhibition") {
  let status = initial;
  let requests = 0;
  await page.clock.install({ time: new Date(`${DATE}T10:00:00+09:00`) });
  await page.addInitScript(() => {
    localStorage.setItem("boatai-language", "ja");
    localStorage.setItem("boatai:cookie-consent", "accepted");
  });
  await page.route("**/api/predictions/**", (route) =>
    route.fulfill({
      json: {
        races: [
          {
            raceId: ID,
            venueCode: 9,
            venue: "津",
            raceNumber: 1,
            startTime: "23:50",
            raceGrade: "G1",
            raceStage: "準優勝戦",
            entries: [1, 2, 3, 4, 5, 6].map((number) => ({
              number,
              name: `テスト選手${number}`,
              grade: "B1",
              age: 30,
              winRate: 5,
              localWinRate: 5,
              motorNumber: number,
              motor2Rate: 35,
              boatNumber: number,
              boat2Rate: 35,
            })),
            predictions: null,
            exhibitionData: [],
            result: null,
          },
        ],
      },
    }),
  );
  await page.route("**/rest/v1/**", (route) => route.fulfill({ json: [] }));
  await routeAnalogyV16(page);
  await page.route("**/api/analogy/facts/**", (route) => {
    requests += 1;
    return route.fulfill({ json: { ...analogyV16Facts(), status } });
  });
  await page.goto(`/race/${ID}`);
  await page.locator(".race-tabs-btn", { hasText: "龍神ソナー" }).click();
  const section = page.locator("#ryujin-sonar");
  await expect.poll(() => requests).toBe(1);
  await expect(
    section.locator(".af-v16-line, .af-ctl-box").first(),
  ).toBeVisible();
  return {
    section,
    count: () => requests,
    change: (next) => {
      status = next;
    },
  };
}

for (const initial of ["before_exhibition", "exhibition_reflecting"]) {
  for (const terminal of [
    "exhibition_ready",
    "absent",
    "exhibition_missing",
    "not_saved",
  ]) {
    test(`${initial} → ${terminal}: 60秒更新し終端で停止`, async ({ page }) => {
      const state = await setup(page, initial);
      state.change(terminal);
      await page.clock.runFor(61000);
      await expect.poll(state.count).toBe(2);
      if (terminal === "exhibition_ready") {
        const stage = state.section.locator('[data-af-control="stage"]');
        await expect(
          stage.getByRole("button", {
            name: "展示後（直前情報も）",
            exact: true,
          }),
        ).toBeEnabled();
        await expect(
          stage.getByRole("button", { name: "展示前（出走表）", exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
      } else if (terminal === "absent") {
        await expect(state.section.locator(".af-v16-line")).toHaveText(absent);
        await expect(state.section.getByRole("tablist")).toHaveCount(0);
      }
      await page.clock.runFor(61000);
      expect(state.count()).toBe(2);
    });
  }
}

for (const status of [
  "exhibition_ready",
  "absent",
  "exhibition_missing",
  "not_saved",
]) {
  test(`${status} で開いたら読み直さない`, async ({ page }) => {
    const state = await setup(page, status);
    await page.clock.runFor(122000);
    expect(state.count()).toBe(1);
  });
}

test("内部タブとレース詳細タブを往復してもタイマーは重ならない", async ({
  page,
}) => {
  const state = await setup(page);
  await state.section
    .getByRole("tab", { name: "類似レース", exact: true })
    .click();
  await state.section
    .getByRole("tab", { name: "差がつく材料", exact: true })
    .click();
  await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
  await page.locator(".race-tabs-btn", { hasText: "龍神ソナー" }).click();
  await expect(state.section.locator(".af-ctl-box")).toBeVisible();
  await page.clock.runFor(61000);
  await expect.poll(state.count).toBe(2);
  await page.clock.runFor(61000);
  await expect.poll(state.count).toBe(3);
});
