// ブログの一覧の探しやすさを守る: 記事を探す欄・20本ずつの表示・注目記事3本と「すべて見る」・件数つきの分類（スマホは1行）（Blog.jsx、2026-11-27）
import { test, expect } from "../fixtures.js";
import { OVERFLOW_TOLERANCE_PX } from "./helpers.js";

// 2026-11-27 の本番は 163 本を1ページに全て並べ（375px で約3.9万px）、注目記事 32 本が先に続き、検索が無かった
test("/blog は20本ずつ出し、探す欄で絞れる @blog", async ({ page }) => {
  await page.goto("/blog", { waitUntil: "domcontentloaded" });
  const cards = page.locator(".blog-grid .blog-card");
  await expect(cards.first()).toBeVisible();
  await expect(cards).toHaveCount(20);

  // 「さらに表示」で20本足す。残りの本数を札に出す
  const more = page.locator(".blog-show-more");
  await expect(more).toContainText("残り");
  await more.click();
  await expect(cards).toHaveCount(40);

  // 注目記事は3本と「すべて見る」。開くと全部出る
  const featured = page.locator(".featured-grid .featured-card");
  await expect(featured).toHaveCount(3);
  const toggle = page.locator(".blog-featured-toggle");
  await toggle.click();
  expect(await featured.count()).toBeGreaterThan(3);

  // 「多摩川」で探すと、出る記事は全て題・説明・タグのどれかに多摩川を含み、件数の表示と数が合う
  await page.locator(".blog-search-input").fill("多摩川");
  await expect(page.locator(".featured-section")).toHaveCount(0);
  const texts = await cards.allTextContents();
  expect(texts.length).toBeGreaterThan(0);
  for (const text of texts) expect(text).toContain("多摩川");
  await expect(page.locator(".blog-result-count")).toHaveText(
    `${texts.length}本`,
  );
});

test("/blog の分類は件数つきで、スマホは1行に収まり、頁が横にはみ出さない @blog", async ({
  page,
}) => {
  await page.goto("/blog", { waitUntil: "domcontentloaded" });
  const filter = page.locator(".category-filter");
  await expect(filter).toBeVisible();
  await expect(
    filter.locator("button").first().locator(".blog-category-count"),
  ).toHaveText(/^\d+$/);

  const { width } = page.viewportSize();
  if (width <= 768) {
    const tops = await filter
      .locator("button")
      .evaluateAll((els) => [
        ...new Set(els.map((el) => Math.round(el.getBoundingClientRect().top))),
      ]);
    expect(tops).toHaveLength(1);
  }

  const sizes = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(sizes.scrollWidth).toBeLessThanOrEqual(
    sizes.clientWidth + OVERFLOW_TOLERANCE_PX,
  );
});
