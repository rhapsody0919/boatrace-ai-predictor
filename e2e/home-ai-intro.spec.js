import { test, expect } from "./fixtures.js";

/**
 * トップの「龍神レーダーのボートレースAI予想」セクション（集客レーン Phase3）の固定。
 *
 * - 本文（見出し・説明）と /accuracy・/hit-races へのリンクは常に出る
 * - 実績は accuracy_cache（unified_model_accuracy）の展開予測の的中率を出す。回収率は出さない
 * - 取得に失敗したら、実績の行を黙って消さず InlineFetchError を出し、再試行で取り直せる
 * - 言語プレフィックス付きのトップでも、日本語のみのページへは言語プレフィックス無しでリンクする
 *
 * accuracy_cache は route で固定する（本番の値に左右されない）。
 */

const ACCURACY = {
  turn: { hitRate: 0.795, totalRaces: 7259, byVenue: [] },
  calculatedAt: "2026-09-28T20:42:56.099Z",
};

async function fulfillAccuracy(route) {
  // .single() は1件のオブジェクトを期待する（Accept: application/vnd.pgrst.object+json）
  await route.fulfill({ status: 200, json: { data: ACCURACY } });
}

test.describe("トップのAI予想説明セクション", () => {
  test("本文・実績・リンクが出る（回収率は出さない）", async ({ page }) => {
    await page.route("**/rest/v1/accuracy_cache**", fulfillAccuracy);
    await page.goto("/");

    const section = page.locator(".home-ai-intro");
    await expect(section.locator("h2")).toHaveText(
      "龍神レーダーのボートレースAI予想",
    );
    await expect(section).toContainText("全国24場");
    await expect(section.locator(".home-ai-intro__stat")).toContainText(
      "79.5%",
    );
    await expect(section.locator(".home-ai-intro__stat")).toContainText(
      "7,259",
    );
    await expect(section).not.toContainText("回収率");

    const hrefs = await section
      .locator(".home-ai-intro__links a")
      .evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(hrefs).toEqual(["/accuracy", "/hit-races"]);
  });

  test("実績の取得に失敗したらエラーを出し、再試行で出る", async ({ page }) => {
    let fail = true;
    await page.route("**/rest/v1/accuracy_cache**", (route) =>
      fail
        ? route.fulfill({
            status: 500,
            json: { message: "boom", code: "XX000" },
          })
        : fulfillAccuracy(route),
    );
    await page.goto("/");

    const section = page.locator(".home-ai-intro");
    await expect(section.locator(".inline-fetch-error")).toBeVisible({
      timeout: 20000,
    });
    // 本文とリンクは失敗しても出たまま
    await expect(section.locator("h2")).toBeVisible();
    await expect(section.locator(".home-ai-intro__links a")).toHaveCount(2);
    await expect(section.locator(".home-ai-intro__stat")).toHaveCount(0);

    fail = false;
    await section.locator(".inline-fetch-error__retry").click();
    await expect(section.locator(".home-ai-intro__stat")).toContainText(
      "79.5%",
    );
    await expect(section.locator(".inline-fetch-error")).toHaveCount(0);
  });

  test("英語のトップでも日本語ページへは言語プレフィックス無しでリンクする", async ({
    page,
  }) => {
    await page.route("**/rest/v1/accuracy_cache**", fulfillAccuracy);
    await page.goto("/en/");

    const section = page.locator(".home-ai-intro");
    await expect(section.locator("h2")).toHaveText(
      "Ryujin Radar's AI Boat Race Predictions",
    );
    const hrefs = await section
      .locator(".home-ai-intro__links a")
      .evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(hrefs).toEqual(["/accuracy", "/hit-races"]);
  });
});
