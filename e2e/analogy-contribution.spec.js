import { test, expect } from "./fixtures.js";
import {
  THEMES,
  boatRow,
  contribution,
} from "./analogy-contribution-fixture.js";

/**
 * アナロジー・ファインダーの寄与度（BOA-271 FR-1）。
 *
 * 寄与度 API（/api/analogy/contribution）と予想の Edge API・Supabase REST を差し替え、DB に依存しない。
 * 固定するもの:
 *   - 学習前（is_active の版が無い）は節ごと出さない
 *   - API にはこのレースの会場・グレード・ラウンドを既定の条件として渡す
 *   - テーマは API の themes 配列から描く（7つ目のテーマを足しても出る）
 *   - 予想が無いレースでも節を出す（予想の有無と切り離す）
 *   - 艇番比較の表・テーマの内訳・小標本・広げた段の表示
 *   - 375px で横スクロールが出ない
 */

const DATE = "2026-09-22";
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
const race = (n, { predictions = true } = {}) => ({
  raceId: `${DATE}-09-${String(n).padStart(2, "0")}`,
  venueCode: 9,
  venue: "津",
  raceNumber: n,
  startTime: "23:50",
  raceGrade: "G1",
  raceStage: "準優勝戦",
  cancellationStatus: null,
  entries,
  predictions: predictions
    ? {
        unified: {
          topPick: 1,
          top3: [1, 2, 3],
          confidence: 50,
          volatilityPercentile: 0.5,
          volatilityPercentileIsFallback: false,
          turnPrediction: {
            patterns: [
              { technique: "逃げ", winnerCourse: 1, probability: 0.6 },
            ],
          },
        },
      }
    : null,
  exhibitionData: [],
  result: null,
});
const edgeData = {
  generatedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  races: [race(1), race(2, { predictions: false })],
};

async function setup(page, respond) {
  const calls = [];
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
  await page.route("**/api/analogy/contribution*", (route) => {
    const u = new URL(route.request().url());
    const params = {
      venue: Number(u.searchParams.get("venue")),
      grade: u.searchParams.get("grade"),
      round: u.searchParams.get("round"),
      target: Number(u.searchParams.get("target")),
    };
    calls.push(params);
    return route.fulfill({ json: respond(params) });
  });
  return calls;
}

async function openAiTab(page, n = 1) {
  await page.goto(`/race/${DATE}-09-${String(n).padStart(2, "0")}`);
  await expect(page.getByText("テスト選手1").first()).toBeVisible({
    timeout: 20000,
  });
  await page.locator(".race-tabs-btn", { hasText: "AI予想" }).click();
}

const sectionOf = (page) =>
  page.getByRole("region", { name: "アナロジー・ファインダー" });

test.describe("アナロジー・ファインダーの寄与度（BOA-271 FR-1）", () => {
  test("学習前（版が無い）は節ごと出さない", async ({ page }) => {
    const calls = await setup(page, () => ({ available: false }));
    await openAiTab(page);
    await expect.poll(() => calls.length).toBeGreaterThan(0);
    await expect(page.locator(".prediction-result")).toBeVisible();
    await expect(sectionOf(page)).toHaveCount(0);
  });

  test("このレースの会場・グレード・ラウンドを既定の条件にし、6テーマを出す", async ({
    page,
  }) => {
    const calls = await setup(page, (p) => contribution(p));
    await openAiTab(page);
    const section = sectionOf(page);
    await expect(section).toBeVisible();
    expect(calls[0]).toEqual({
      venue: 9,
      grade: "G1",
      round: "junyu",
      target: 1,
    });
    await expect(
      section.getByRole("heading", { level: 3, name: "寄与度" }),
    ).toBeVisible();
    for (const [, name] of THEMES.map((t) => [t.key, t.name])) {
      await expect(
        section.getByRole("button", { name: new RegExp(name) }),
      ).toBeVisible();
    }
    await expect(section.getByText("n=1,234レース（7,404艇）")).toBeVisible();
    await expect(section.getByText("2025-10〜2026-10")).toBeVisible();
    await expect(section.getByText("モデル 2026-10-05")).toBeVisible();
    await expect(section.getByText("小標本")).toHaveCount(0);
    expect(await section.innerText()).not.toMatch(/AI指数|総合点|競艇/);
  });

  test("予想が無いレースでも節を出す", async ({ page }) => {
    await setup(page, (p) => contribution(p));
    await openAiTab(page, 2);
    await expect(sectionOf(page)).toBeVisible();
  });

  test("テーマは API の themes 配列から描く（7つ目を足しても出る）", async ({
    page,
  }) => {
    const themes = [
      ...THEMES,
      {
        key: "market",
        name: "市場",
        description: "",
        features: [],
        groups: [{ key: "odds", label: "単勝オッズ" }],
      },
    ];
    await setup(page, (p) => contribution(p, { themes }));
    await openAiTab(page);
    await expect(
      sectionOf(page).getByRole("button", { name: /市場/ }),
    ).toBeVisible();
  });

  test("着順・グレードを切り替えると条件を変えて読み直す", async ({ page }) => {
    const calls = await setup(page, (p) => contribution(p));
    await openAiTab(page);
    const section = sectionOf(page);
    await expect(section).toBeVisible();
    await section.getByRole("tab", { name: "3着以内", exact: true }).click();
    await expect.poll(() => calls.at(-1)?.target).toBe(3);
    await section.getByText("詳細条件", { exact: true }).click();
    await section
      .getByLabel("グレード", { exact: true })
      .selectOption({ label: "SG" });
    await expect.poll(() => calls.at(-1)?.grade).toBe("SG");
    await section
      .getByLabel("ラウンド", { exact: true })
      .selectOption({ label: "すべて" });
    await expect.poll(() => calls.at(-1)?.round).toBe("all");
  });

  test("艇番比較は表で数値を出し、テーマを押すと内訳が開く", async ({
    page,
  }) => {
    await setup(page, (p) => contribution(p));
    await openAiTab(page);
    const section = sectionOf(page);
    await section.getByRole("checkbox", { name: "艇番で比較" }).check();
    const table = section.getByRole("table");
    await expect(table.getByRole("columnheader")).toHaveCount(3);
    await expect(table.getByRole("columnheader").nth(1)).toContainText("1号艇");
    await expect(table.getByRole("columnheader").nth(2)).toContainText("6号艇");
    await expect(table.getByRole("row")).toHaveCount(1 + THEMES.length);

    const theme = section.getByRole("button", { name: /選手・基礎成績/ });
    await expect(theme).toHaveAttribute("aria-expanded", "false");
    await theme.click();
    await expect(theme).toHaveAttribute("aria-expanded", "true");
    await expect(section.getByText("全国勝率・2連率")).toBeVisible();
    await expect(section.getByText(/個別の値は参考/)).toBeVisible();
  });

  test("小標本と、広げて集計したことを出す", async ({ page }) => {
    await setup(page, (p) =>
      contribution(
        { ...p, venue: 0, round: "all" },
        { nRaces: 12, widened: ["venue", "round"] },
      ),
    );
    await openAiTab(page);
    const section = sectionOf(page);
    await expect(section.getByText("小標本")).toBeVisible();
    await expect(
      section.getByText(
        /はレース数が少ないため、全会場・全ラウンドに広げて集計しています$/,
      ),
    ).toBeVisible();
  });

  test("取得に失敗したら「データなし」ではなく再試行できるエラーを出す", async ({
    page,
  }) => {
    let fail = true;
    await setup(page, (p) => (fail ? null : contribution(p)));
    await page.route("**/api/analogy/contribution*", (route) =>
      fail
        ? route.fulfill({ status: 500, json: { error: "x" } })
        : route.fallback(),
    );
    // 直読みの経路も失敗させる
    await page.route("**/rest/v1/analogy_models*", (route) =>
      fail
        ? route.fulfill({ status: 500, json: { message: "x" } })
        : route.fallback(),
    );
    await openAiTab(page);
    const section = sectionOf(page);
    await expect(section.getByRole("alert")).toContainText(
      "寄与度を読み込めませんでした",
    );
    fail = false;
    await section.getByRole("button", { name: /再/ }).click();
    await expect(section.getByText("n=1,234レース（7,404艇）")).toBeVisible();
  });

  test("API が失敗しても Supabase の直読みで出し、レースが少ないスライスは広げる", async ({
    page,
  }) => {
    await setup(page, (p) => contribution(p));
    await page.route("**/api/analogy/contribution*", (route) =>
      route.fulfill({ status: 500, json: { error: "x" } }),
    );
    await page.route("**/rest/v1/analogy_models*", (route) =>
      route.fulfill({
        json: [
          {
            model_version: "2026-10-05",
            trained_at: "2026-10-05T00:00:00Z",
            themes: THEMES,
            metrics: { periods: { test: ["2025-10-02", "2026-10-01"] } },
          },
        ],
      }),
    );
    // このレースのスライス（津・G1・準優勝戦）は12レースしかない。全会場に広げると500レース
    const rows = [0, 1, 2, 3, 4, 5, 6].flatMap((b) => [
      boatRow(b, 1, 12, THEMES),
      boatRow(b, 1, 500, THEMES, { venue_code: 0 }),
    ]);
    await page.route("**/rest/v1/analogy_contribution_profiles*", (route) =>
      route.fulfill({ json: rows }),
    );
    await openAiTab(page);
    const section = sectionOf(page);
    await expect(section.getByText("n=500レース（3,000艇）")).toBeVisible();
    await expect(
      // 選んだ条件（このレースの条件）と、実際に集計した範囲の両方を書く（ファン評価1周目 P2）
      section.getByText(
        "津・G1・準優勝戦はレース数が少ないため、全会場に広げて集計しています",
      ),
    ).toBeVisible();
    await expect(section.getByText("小標本")).toHaveCount(0);
  });

  test("テーブルがまだ無い（マイグレーション未適用）ときは節を出さない", async ({
    page,
  }) => {
    await setup(page, (p) => contribution(p));
    await page.route("**/api/analogy/contribution*", (route) =>
      route.fulfill({ status: 404, body: "not found" }),
    );
    let asked = 0;
    await page.route("**/rest/v1/analogy_models*", (route) => {
      asked += 1;
      return route.fulfill({
        status: 404,
        json: {
          code: "PGRST205",
          message: "Could not find the table 'public.analogy_models'",
        },
      });
    });
    await openAiTab(page);
    await expect.poll(() => asked).toBeGreaterThan(0);
    await expect(page.locator(".prediction-result")).toBeVisible();
    await expect(page.locator(".af-section")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("棒はシェアの大きい順に並べ、棒の長さはシェアそのもの（全テーマで100%）。大きさの意味を書く", async ({
    page,
  }) => {
    await setup(page, (p) => contribution(p));
    await openAiTab(page);
    const section = sectionOf(page);
    const heads = section.locator(".af-theme-head");
    await expect(heads).toHaveCount(THEMES.length);
    const values = await section.locator(".af-theme-value").allInnerTexts();
    const nums = values.map((v) => Number(v.replace("%", "")));
    expect(nums).toEqual([...nums].sort((a, b) => b - a));
    // 棒の長さ: 1位の棒が溝いっぱい（100%）にならない（シェアの値そのものの長さ）
    const ratio = await section
      .locator(".af-theme")
      .first()
      .evaluate((li) => {
        const fill = li.querySelector(".af-bar-fill").getBoundingClientRect();
        const track = li.querySelector(".af-bar-track").getBoundingClientRect();
        return fill.width / track.width;
      });
    expect(Math.abs(ratio - nums[0] / 100)).toBeLessThan(0.02);
    await expect(
      section.getByText(/有利・不利のどちらに働いたかを問わない/),
    ).toBeVisible();
  });

  test("375px で横スクロールが出ない", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await setup(page, (p) => contribution(p));
    await openAiTab(page);
    const section = sectionOf(page);
    await section.getByRole("checkbox", { name: "艇番で比較" }).check();
    await section.getByRole("button", { name: /環境/ }).click();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
