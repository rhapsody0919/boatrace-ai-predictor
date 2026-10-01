import { test, expect } from "./fixtures.js";

/**
 * トップの「龍神レーダーのボートレースAI予想」セクション（集客レーン Phase3）の固定。
 *
 * - 本文（見出し・説明）と /accuracy・/hit-races へのリンクは常に出る
 * - 的中率・回収率の数値は出さない（2026-10-01 ユーザー判断。展開予測の実測的中率は、決まり手を見ずに
 *   判定しており、予想なしの基準を下回ることが分かった。BOA-617）
 * - 言語プレフィックス付きのトップでも、日本語のみのページへは言語プレフィックス無しでリンクする
 */

test.describe("トップのAI予想説明セクション", () => {
  test("本文とリンクが出て、的中率・回収率の数値は出さない", async ({
    page,
  }) => {
    let accuracyRequested = false;
    page.on("request", (req) => {
      if (req.url().includes("/rest/v1/accuracy_cache")) {
        accuracyRequested = true;
      }
    });
    await page.goto("/");

    const section = page.locator(".home-ai-intro");
    await expect(section.locator("h2")).toHaveText(
      "龍神レーダーのボートレースAI予想",
    );
    await expect(section).toContainText("全国24場");
    await expect(section).not.toContainText("的中率");
    await expect(section).not.toContainText("回収率");
    await expect(section).not.toContainText("%");

    const hrefs = await section
      .locator(".home-ai-intro__links a")
      .evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(hrefs).toEqual(["/accuracy", "/hit-races"]);

    // トップは実績の数値を取りに行かない（このセクションのために accuracy_cache を読まない）
    expect(accuracyRequested).toBe(false);
  });

  test("英語のトップでも日本語ページへは言語プレフィックス無しでリンクする", async ({
    page,
  }) => {
    await page.goto("/en/");

    const section = page.locator(".home-ai-intro");
    await expect(section.locator("h2")).toHaveText(
      "Ryujin Radar's AI Boat Race Predictions",
    );
    await expect(section).not.toContainText("hit rate");
    const hrefs = await section
      .locator(".home-ai-intro__links a")
      .evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(hrefs).toEqual(["/accuracy", "/hit-races"]);
  });
});
