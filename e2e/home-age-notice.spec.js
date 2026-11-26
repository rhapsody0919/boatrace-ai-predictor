import { test, expect } from "./fixtures.js";

/**
 * トップの「龍神レーダーのボートレースAI予想」の節に、公営競技の断り（投票は日本国内に住む20歳以上だけ）が
 * 4言語で出ることの固定（AGENTS.md「断り」、BOA-1722）。文は home.aiIntro.ageNotice。
 * 結果を保証しない旨（home.aiIntro.disclaimer）の直後に置く。
 */
test.describe("トップの20歳以上の断り（BOA-1722）", () => {
  test.describe.configure({ timeout: 120000 });

  for (const { path, text } of [
    { path: "/", text: "舟券の投票は、日本国内に住む20歳以上の方だけができます。" },
    { path: "/en/", text: "Only people aged 20 or over who live in Japan can bet on boat races." },
  ]) {
    test(`${path}: 保証しない旨の直後に断りがある`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const notes = page.locator(".home-ai-intro .home-ai-intro__note");
      await expect(notes.first()).toBeVisible({ timeout: 30000 });
      await expect(notes).toHaveCount(2);
      await expect(notes.nth(1)).toHaveText(text);
    });
  }
});
