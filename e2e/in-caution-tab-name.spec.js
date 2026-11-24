import { test, expect } from "./fixtures.js";

/**
 * レース詳細のタブの名前（BOA-822 task 45、2026-11-24 オーナー決定）。機能フラグの側（?caution=1）では「AI予想」を
 * 「イン崩れ」にする。タブの id と ?tab=aiPrediction は変えない（共有リンク・計測が使う）。フラグの外は今のまま。
 *   - レース詳細のタブの名前・中止のレースの空状態の文
 * DB に依存しないよう Edge API と Supabase REST を差し替える（in-caution-card.spec.js と同じ形）。
 */

const DATE = "2026-09-22";
const entries = [1, 2, 3, 4, 5, 6].map((i) => ({
  number: i,
  name: `試験${i}　選手`,
  grade: "B1",
  age: 30,
  winRate: 5.0,
  localWinRate: 5.0,
  motorNumber: i,
  motor2Rate: 35,
  boatNumber: i,
  boat2Rate: 35,
}));
const race = (n, cancellationStatus = null) => ({
  raceId: `${DATE}-02-${String(n).padStart(2, "0")}`,
  venueCode: 2,
  venue: "戸田",
  raceNumber: n,
  startTime: "23:50",
  cancellationStatus,
  entries,
  predictions: { unified: { topPick: 1, top3: [1, 2, 3], confidence: 50 } },
  inCaution: null,
  exhibitionData: [],
  result: null,
});
const edgeData = {
  generatedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  races: [race(4), race(5, "confirmed")],
};

const open = (page, n, query) =>
  page.goto(`/race/${DATE}-02-${String(n).padStart(2, "0")}?${query}`);
const tab = (page, name) => page.getByRole("tab", { name, exact: true });

test.describe("タブの名前「イン崩れ」（BOA-822 task 45）", () => {
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

  test("フラグの側: タブは「イン崩れ」、URL の tab は aiPrediction のまま", async ({
    page,
  }) => {
    await open(page, 4, "tab=aiPrediction&caution=1");
    await expect(tab(page, "イン崩れ")).toBeVisible({ timeout: 20000 });
    await expect(tab(page, "イン崩れ")).toHaveAttribute("aria-selected", "true");
    await expect(tab(page, "AI予想")).toHaveCount(0);
  });

  test("フラグの側: 中止のレースの空状態は注意度の文", async ({ page }) => {
    await open(page, 5, "tab=aiPrediction&caution=1");
    await expect(page.getByTestId("ai-prediction-cancelled")).toHaveText(
      "このレースは中止のため、イン崩れ注意度はありません",
      { timeout: 20000 },
    );
  });

  test("フラグの外: 今のまま「AI予想」", async ({ page }) => {
    await open(page, 4, "tab=aiPrediction");
    await expect(tab(page, "AI予想")).toBeVisible({ timeout: 20000 });
    await expect(tab(page, "イン崩れ")).toHaveCount(0);
    await open(page, 5, "tab=aiPrediction");
    await expect(page.getByTestId("ai-prediction-cancelled")).toHaveText(
      "このレースは中止のため、AI予想はありません",
    );
  });
});
