import { test, expect } from "./fixtures.js";
import {
  analogyV16Facts,
  analogyV16Scenario,
  routeAnalogyV16,
} from "./analogy-v16-fixture.js";

const DATE = "2026-10-26";
const ID = `${DATE}-09-01`;
const absent = "欠場があったため、このレースの龍神ソナーは出していません";

async function setup(page, initial = "before_exhibition") {
  let status = initial;
  let requests = 0;
  // 展示の facts の何回目を HTTP 500 で返すか
  const failAt = new Set();
  await page.clock.install({ time: new Date(`${DATE}T10:00:00+09:00`) });
  await page.addInitScript(() => {
    localStorage.setItem("boatai-language", "ja");
    localStorage.setItem("boatai:cookie-consent", "accepted");
    // 展示の facts（stage=exhibition。similar 等も同じ stage を付けるので facts に限る）の応答を読み終えた回数。次の60秒の予約は
    // 読み終えた後の then で入るため、時計を進める前にこれで待つ。
    // MessageChannel は page.clock が差し替えないので、then の後に必ず回る。
    window.__exhibitionFactsRead = 0;
    const json = Response.prototype.json;
    Response.prototype.json = function readJson() {
      const exhibition =
        this.url.includes("/api/analogy/facts/") &&
        this.url.includes("stage=exhibition");
      return json.call(this).then((body) => {
        if (exhibition) {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => {
            window.__exhibitionFactsRead += 1;
          };
          channel.port2.postMessage(null);
        }
        return body;
      });
    };
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
    // 数えるのは龍神ソナーの定期更新の対象（stage=exhibition）だけ。
    // 基本情報タブの ST(30走)（getRaceSt30）も stage=racecard で facts を読むため、
    // まとめて数えると開いた直後から 1 にならない。
    if (
      new URL(route.request().url()).searchParams.get("stage") === "exhibition"
    ) {
      requests += 1;
      if (failAt.has(requests))
        return route.fulfill({ status: 500, json: { error: "test" } });
    }
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
    waitRead: (n) =>
      expect
        .poll(() => page.evaluate(() => window.__exhibitionFactsRead))
        .toBe(n),
    change: (next) => {
      status = next;
    },
    failOn: (n) => failAt.add(n),
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
  // 要求を数えるのは route の時点で、次の60秒の予約は応答を読み終えてから入る。
  // 読み終える前に時計を進めると、予約が進めた後の時刻から始まり60秒に届かない。
  await state.waitRead(2);
  await page.clock.runFor(61000);
  await expect.poll(state.count).toBe(3);
});

test("定期の読み直しが失敗しても前の値を残し、次の60秒で読み直す", async ({
  page,
}) => {
  const state = await setup(page);
  state.failOn(2);
  const failed = page.waitForEvent("console", (m) =>
    m.text().includes("定期の読み直しに失敗"),
  );
  await page.clock.runFor(61000);
  await expect.poll(state.count).toBe(2);
  // 次の60秒の予約は失敗を受けた後に入るので、それを待ってから時計を進める
  await failed;
  await expect(state.section.locator(".af-ctl-box")).toBeVisible();
  await expect(state.section.locator(".af-tab-error")).toHaveCount(0);
  state.change("exhibition_ready");
  await page.clock.runFor(61000);
  await expect.poll(state.count).toBe(3);
  const stage = state.section.locator('[data-af-control="stage"]');
  await expect(
    stage.getByRole("button", { name: "展示後（直前情報も）", exact: true }),
  ).toBeEnabled();
  await expect(state.section.locator(".af-tab-error")).toHaveCount(0);
  await page.clock.runFor(61000);
  expect(state.count()).toBe(3);
});

test("展示前にシナリオを開いてから展示後の段が届いたら、展示後でシナリオも展示後の値になる", async ({
  page,
}) => {
  const state = await setup(page);
  // 展示前の scenario は exhibition: null（api/analogy/scenario の展示前の応答と同じ）
  let scenarioExhibition = false;
  await page.route("**/api/analogy/scenario/**", (route) => {
    const body = analogyV16Scenario();
    if (!scenarioExhibition) body.exhibition = null;
    return route.fulfill({ json: body });
  });
  await state.section
    .getByRole("tab", { name: "展開シナリオ", exact: true })
    .click();
  await expect(state.section.locator(".af-scn-blk").first()).toBeVisible();
  state.change("exhibition_ready");
  scenarioExhibition = true;
  await page.clock.runFor(61000);
  await expect.poll(state.count).toBe(2);
  const stage = state.section.locator('[data-af-control="stage"]');
  const after = stage.getByRole("button", {
    name: "展示後（直前情報も）",
    exact: true,
  });
  await expect(after).toBeEnabled();
  // 時点は自動で切り替えない
  await expect(
    stage.getByRole("button", { name: "展示前（出走表）", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(state.section.locator(".af-today-badge")).toHaveCount(0);
  await after.click();
  await expect(state.section.locator(".af-today-badge").first()).toBeVisible();
});
