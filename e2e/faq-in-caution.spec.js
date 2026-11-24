import { test, expect } from "./fixtures.js";

/**
 * よくある質問の、イン崩れ注意度の公開の後の文（BOA-822 task 38、機能フラグの裏。?caution=1 で出す）。
 *   - 「展開予測の的中率は約79%」の問いと、展開予測・イン崩れ指数の違いの問いを出さない
 *   - 注意度の定義の問いと、成績ページへの案内を出す
 *   - タブの説明は「イン崩れ」、サービスの呼び名は「AI予想」を使わない
 *   - 構造化データ（FAQPage）も画面と同じ問い
 *   - フラグの外は今のまま
 */

const faqText = (page) => page.locator("main, .faq-page, body").first();

test("フラグの側: 展開予測の的中率と「AI予想」を出さず、注意度の定義と成績への案内を出す", async ({
  page,
}) => {
  await page.goto("/faq?caution=1");
  await expect(page.getByText("イン崩れ注意度とは何ですか？")).toBeVisible({
    timeout: 20000,
  });
  const body = faqText(page);
  await expect(body).not.toContainText("79%");
  await expect(body).not.toContainText("展開予測");
  await expect(body).not.toContainText("AI予想");
  await expect(page.getByText("イン崩れ注意度・分析について")).toBeVisible();
  await expect(page.getByRole("button", { name: "レースの分析を見る" })).toBeVisible();

  const ld = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents();
  const faqLd = ld.map((t) => JSON.parse(t)).find((j) => j["@type"] === "FAQPage");
  const names = faqLd.mainEntity.map((q) => q.name);
  expect(names).toContain("イン崩れ注意度とは何ですか？");
  expect(names).not.toContain("AI予測の精度はどのくらいですか？");
  expect(JSON.stringify(faqLd)).not.toContain("展開予測");
  expect(JSON.stringify(faqLd)).not.toContain("機械学習");
  expect(JSON.stringify(faqLd)).not.toContain("数え");
  expect(names).toContain("どうやってレースの分析を見れば良いですか？");
});

test("フラグの外: 今のまま", async ({ page }) => {
  await page.goto("/faq");
  await expect(page.getByText("AI予測の精度はどのくらいですか？")).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByText("イン崩れ注意度とは何ですか？")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "AI予想を試す" })).toBeVisible();
});
