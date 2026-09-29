import { test, expect } from "./fixtures.js";

/**
 * 中止確定のレースで「AIが予想する」系の表示を出さない（BOA-424）。
 *
 * 中止確定（cancellation_status='confirmed' かつ結果なし、isRaceCancelled）でも
 * race_entries が残っていると出走表が組め、AI用コピーのバナー・ボタンと「AI予想」タブの
 * 展開予測・イン崩れ指数がそのまま出ていた。predictions も中止前に作られて残ることがある
 * （BOA-411。本番では 2026-08-11 大宮の12レースが該当）。
 *
 * DBに依存しないよう Edge API と Supabase REST を差し替える。
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
const unified = {
  topPick: 1,
  top3: [1, 2, 3],
  confidence: 50,
  volatilityPercentile: 0.85,
  volatilityPercentileIsFallback: false,
  turnPrediction: {
    patterns: [{ technique: "逃げ", winnerCourse: 1, probability: 0.6 }],
  },
};
const race = (n, cancellationStatus) => ({
  raceId: `${DATE}-09-${String(n).padStart(2, "0")}`,
  venueCode: 9,
  venue: "津",
  raceNumber: n,
  startTime: "23:50",
  cancellationStatus,
  entries,
  predictions: { unified },
  exhibitionData: [],
  result: null,
});
const edgeData = {
  generatedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  races: [
    // 1R: 中止確定・結果なし・選手と予想は残っている
    race(1, "confirmed"),
    // 2R: 通常の未確定レース
    race(2, null),
  ],
};

const COPY_LABEL = "AI用にコピー";
const CANCELLED_TEXT = "このレースは中止のため、AI予想はありません";

test.describe("中止確定レースでAI予想・AI用コピーを出さない（BOA-424）", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem("boatai-language", "ja"),
    );
    await page.route("**/api/predictions/**", (route) =>
      route.fulfill({ json: edgeData }),
    );
    await page.route("**/rest/v1/**", (route) =>
      route.fulfill({ status: 200, json: [] }),
    );
  });

  test("通常のレース: AI用コピーのバナー・ボタンとAI予想タブの中身が出る", async ({
    page,
  }) => {
    await page.goto(`/race/${DATE}-09-02`);
    await expect(page.getByText("テスト選手1").first()).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator(".ai-copy-banner")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator(".ai-copy-btn-inline")).toBeVisible();

    await page.locator(".race-tabs-btn", { hasText: "AI予想" }).click();
    await expect(page.locator(".prediction-result")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText(CANCELLED_TEXT)).toHaveCount(0);
  });

  test("中止確定のレース: AI用コピーを出さず、AI予想タブは案内だけを出す", async ({
    page,
  }) => {
    await page.goto(`/race/${DATE}-09-01`);
    await expect(
      page.getByText("このレースは中止となりました").first(),
    ).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("テスト選手1").first()).toBeVisible({
      timeout: 20000,
    });

    // タブは残す（他タブと扱いを揃える）
    const aiTab = page.locator(".race-tabs-btn", { hasText: "AI予想" });
    await expect(aiTab).toBeVisible();
    await aiTab.click();
    await expect(page.getByTestId("ai-prediction-cancelled")).toHaveText(
      CANCELLED_TEXT,
    );
    await expect(page.locator(".prediction-result")).toHaveCount(0);

    // 通常レースのテストでバナーが出ることを確かめているので、ここでの0件は
    // 「読み込み前」ではなく「出さない」を意味する。読み込み完了を待ってから数える
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".ai-copy-banner")).toHaveCount(0);
    await expect(page.locator(".ai-copy-btn")).toHaveCount(0);
    await expect(page.getByText(COPY_LABEL)).toHaveCount(0);
  });
});
