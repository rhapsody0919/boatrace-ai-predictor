import { test, expect } from "./fixtures.js";

/**
 * イン崩れ注意度のカード（BOA-822、機能フラグの裏。?caution=1 で出す）。PR #1595 のファン評価1周目・mock-diff-checker で
 * 直した点を固定する。DB に依存しないよう Edge API と Supabase REST を差し替える（race-cancelled-ai.spec.js と同じ）。
 *
 *   - 1440px: カードの中を左右2列（承認モック 1-ai-tab-1440.png）、出現パターンはカードの下、理由の表は 420px まで
 *   - 「類似レース400件で見ると？」で龍神ソナーの類似レースの副タブが開く（「差がつく材料」で開いていた）
 *   - AI用にコピーの「イン崩れ狙い」は段が崩れやすいときだけ（堅めでも旧指数で出ていた）
 *   - ファン評価2周目: 1号艇の方が勝率が高いレースで、表の「一番高い」が真上の数字と矛盾して見えた（「他の艇で」を付ける）。
 *     準優・優勝戦の注記は「準優勝戦だけ」「優勝戦だけ」を分けて書く。全国の印は点線
 */

const DATE = "2026-09-22";
const entries = [1, 2, 3, 4, 5, 6].map((i) => ({
  number: i,
  name: `試験${i}　選手`,
  grade: i === 3 ? "A1" : "B1",
  age: 30,
  winRate: i === 1 ? 4.81 : i === 3 ? 6.93 : 5.0,
  localWinRate: 5.0,
  motorNumber: i,
  motor2Rate: 35,
  boatNumber: i,
  boat2Rate: 35,
}));
const inCaution = (level, pct, extra = {}) => ({
  pct,
  n: 34842,
  nonWin: 22634,
  level,
  gapCents: -212,
  band: -5,
  round: "other",
  boat1WinRate: 4.81,
  topOtherBoat: 3,
  topOtherWinRate: 6.93,
  basePct: 45,
  absentBoats: [],
  lowSample: false,
  through: "2026-09-21",
  def: "gapband-r-v1",
  ...extra,
});
const unified = {
  topPick: 1,
  top3: [1, 2, 3],
  confidence: 50,
  // 旧指数は「高い」。新しい段（堅め）と食い違うレースで、AIコピーの出し分けを見る
  volatilityPercentile: 0.95,
  volatilityPercentileIsFallback: false,
  turnPrediction: {
    patterns: [{ technique: "nige", winnerCourse: 1, probability: 0.6 }],
  },
};
const race = (n, ic) => ({
  raceId: `${DATE}-02-${String(n).padStart(2, "0")}`,
  venueCode: 2,
  venue: "戸田",
  raceNumber: n,
  startTime: "23:50",
  cancellationStatus: null,
  entries,
  predictions: { unified },
  inCaution: ic,
  exhibitionData: [],
  result: null,
});
const edgeData = {
  generatedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  races: [
    race(4, inCaution("high", 65)),
    race(5, inCaution("low", 26)),
    race(
      11,
      inCaution("low", 32, {
        round: "junyu",
        n: 2967,
        gapCents: 24,
        band: 0,
        boat1WinRate: 6.81,
        topOtherWinRate: 6.57,
      }),
    ),
    race(12, inCaution("low", 32, { round: "yusho", n: 1347 })),
  ],
};

const open = (page, n, query = "tab=aiPrediction&caution=1") =>
  page.goto(`/race/${DATE}-02-${String(n).padStart(2, "0")}?${query}`);

test.describe("イン崩れ注意度のカード（BOA-822、?caution=1）", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem("boatai-language", "ja"),
    );
    await page.route("**/api/predictions/**", (route) =>
      route.fulfill({ json: edgeData }),
    );
    await page.route("**/api/analogy/**", (route) =>
      route.fulfill({ status: 200, json: {} }),
    );
    await page.route("**/rest/v1/**", (route) =>
      route.fulfill({ status: 200, json: [] }),
    );
  });

  test("カード: 段・割合・理由（姓だけ）が出て、旧の龍神ソナーの案内ボタンは出ない", async ({
    page,
  }) => {
    await open(page, 4);
    const card = page.locator(".in-caution-card");
    await expect(card).toBeVisible({ timeout: 20000 });
    await expect(card).toContainText("崩れやすい");
    await expect(card.locator(".in-caution-card-pct")).toContainText("65");
    await expect(card).toContainText("1号艇 試験1（B1）");
    await expect(card).toContainText("他の艇で一番高い 3号艇 試験3（A1）");
    await expect(card).toContainText("−2.12");
    await expect(page.getByTestId("ai-tab-sonar-link")).toHaveCount(0);
  });

  test("理由の表は「他の艇で一番高い」（1号艇の方が高いレースでも矛盾して見えない）、準優・優勝戦の注記は範囲を分け、全国の印は点線", async ({
    page,
  }) => {
    await open(page, 11);
    const card = page.locator(".in-caution-card");
    await expect(card).toBeVisible({ timeout: 20000 });
    await expect(card).toContainText("他の艇で一番高い 3号艇");
    await expect(card).toContainText("+0.24");
    await expect(card).toContainText("件数は準優勝戦だけの全国の実績");
    await expect(card).toContainText("勝率差による差がつきにくい");
    const style = await card
      .locator(".in-caution-card-base")
      .evaluate((e) => getComputedStyle(e).borderLeftStyle);
    expect(style).toBe("dashed");
    await open(page, 12);
    await expect(page.locator(".in-caution-card")).toContainText(
      "件数は優勝戦だけの全国の実績",
      { timeout: 20000 },
    );
  });

  test("1440px: カードの中は左右2列、出現パターンはカードの下、理由の表は 420px まで", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await open(page, 4);
    const card = page.locator(".in-caution-card");
    await expect(card).toBeVisible({ timeout: 20000 });
    const main = await card.locator(".in-caution-card-main").boundingBox();
    const side = await card.locator(".in-caution-card-side").boundingBox();
    expect(side.x).toBeGreaterThan(main.x + main.width - 1);
    // 同じ行に並ぶ（上端の差は数 px。CI と手元でフォントが違うので、行の高さに比べて小さいことだけを見る）
    expect(Math.abs(side.y - main.y)).toBeLessThan(main.height / 4);
    const cardBox = await card.boundingBox();
    const pattern = await page
      .locator(".in-caution-tab > :nth-child(2)")
      .boundingBox();
    expect(pattern.y).toBeGreaterThanOrEqual(cardBox.y + cardBox.height - 1);
    const dl = await card.locator(".in-caution-card-reason dl").boundingBox();
    expect(dl.width).toBeLessThanOrEqual(420);
  });

  test("「類似レース400件で見ると？」で龍神ソナーの類似レースの副タブが開く", async ({
    page,
  }) => {
    await open(page, 4);
    await page
      .getByRole("button", { name: /類似レース[\d,]+件で見ると？/ })
      .click({ timeout: 20000 });
    await expect(
      page.getByRole("tab", { name: "類似レース", selected: true }),
    ).toBeVisible({ timeout: 10000 });
  });

  test("AI用にコピー: 「イン崩れ狙い」は崩れやすいときだけ（旧指数が高くても堅めなら出さない）", async ({
    page,
  }) => {
    await open(page, 4);
    await expect(page.locator(".in-caution-card")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByText("イン崩れ狙い").first()).toBeVisible({
      timeout: 20000,
    });
    await open(page, 5);
    await expect(page.locator(".in-caution-card")).toContainText("堅め", {
      timeout: 20000,
    });
    await expect(page.getByText("AI用にコピー").first()).toBeVisible();
    await expect(page.getByText("イン崩れ狙い")).toHaveCount(0);
  });
});
