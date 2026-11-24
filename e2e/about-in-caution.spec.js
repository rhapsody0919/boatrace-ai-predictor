import { test, expect } from "./fixtures.js";

/**
 * 「龍神レーダーについて」の、イン崩れ注意度の公開の後の文（BOA-822 task 38、機能フラグの裏。?caution=1 で出す）。
 *   - 展開予測の的中率（79%）・「AI予想」・機械学習・「企業秘密」を出さない
 *   - 注意度の出し方の4つの段と、精度分析ページへの導線を出す
 *   - title・meta の keywords も「AI分析・機械学習」を外す
 *   - フラグの外は今のまま
 */

const container = (page) => page.locator(".about-container");

test("フラグの側: 「AI予想」と展開予測の的中率を出さず、注意度の出し方と実績への導線を出す", async ({
  page,
}) => {
  await page.goto("/about?caution=1");
  await expect(
    page.getByRole("heading", { name: "🎓 イン崩れ注意度の出し方" }),
  ).toBeVisible({ timeout: 20000 });
  const body = container(page);
  for (const word of ["79%", "展開予測", "AI予想", "機械学習", "企業秘密", "数え"]) {
    await expect(body).not.toContainText(word);
  }
  await expect(body).toContainText(
    "準優勝戦・優勝戦は、それぞれ準優勝戦だけ・優勝戦だけの過去レースの値です",
  );
  await expect(body.getByRole("link", { name: "段ごとの実績を見る →" }))
    .toHaveAttribute("href", "/accuracy");
  await expect(body.getByRole("button", { name: "レースの分析を見る" })).toBeVisible();
  await expect(body).toContainText("発走前は8つ");
  await expect(body).toContainText("龍神ソナー:");
  // 紹介動画は「AI予想」を映すので出さない
  await expect(page.locator(".about-hero-video")).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  const card = body.locator(".about-in-caution-steps .step-content").first();
  expect((await card.boundingBox()).height).toBeLessThan(300);
  await expect(page).toHaveTitle(
    "龍神レーダーについて | ボートレースのデータ分析サービスの詳細",
  );
  const keywords = await page
    .locator('meta[name="keywords"]')
    .first()
    .getAttribute("content");
  expect(keywords).not.toContain("機械学習");
});

test("フラグの外: 今のまま", async ({ page }) => {
  await page.goto("/about");
  await expect(page.getByText("展開予測的中率", { exact: true })).toBeVisible({
    timeout: 20000,
  });
  await expect(
    page.getByRole("heading", { name: "🎓 イン崩れ注意度の出し方" }),
  ).toHaveCount(0);
  await expect(page.locator(".about-hero-video")).toHaveCount(1);
});
