// 旧 e2e/smoke.spec.js から切り出しスクリプトで移した（CI02。題・中身は元のまま、import の相対の字だけ1段深くした）
import { test, expect } from "../fixtures.js";
import fs from "node:fs";
import { buildImageDimensions } from "../../scripts/lib/blogImageDimensions.js";

test.describe("ブログ英語版（部分翻訳、blog-i18n） @blog", () => {
  test("/en/blog は英語版が存在する記事のみ一覧表示される（ja版全件より少ない件数）", async ({
    page,
  }) => {
    await page.goto("/en/blog");
    await expect(page).toHaveURL(/\/en\/blog$/);
    const enCards = page.locator(".blog-card");
    await expect(enCards.first()).toBeVisible();
    const enCount = await enCards.count();
    expect(enCount).toBeGreaterThan(0);

    await page.goto("/blog");
    const jaCount = await page.locator(".blog-card").count();
    // フィルタが機能していれば英語版件数はja版全件より必ず少ない
    // （全件一致は「フィルタが効いていない」回帰を示す）
    expect(enCount).toBeLessThan(jaCount);
  });

  test("英語版がある記事は/en/blog/{id}でリダイレクトされずに表示される", async ({
    page,
  }) => {
    await page.goto("/en/blog/odds-expected-value-guide");
    await expect(page).toHaveURL(/\/en\/blog\/odds-expected-value-guide$/);
    await expect(page.locator(".blog-post-header h1")).toContainText(
      "How Odds Work",
    );
  });

  // BOA-908: 翻訳版のメタデータを 1記事1つの JSON（src/data/blog-posts/{lang}/{id}.json）に移した。
  // 画面の h1 と一覧のカードが、その JSON の title のままであること
  for (const lang of ["en", "ko", "zh-TW"]) {
    test(`${lang} の記事と一覧の title は src/data/blog-posts/${lang}/{id}.json のまま`, async ({
      page,
    }) => {
      const id = "odds-expected-value-guide";
      const { title } = JSON.parse(
        fs.readFileSync(`src/data/blog-posts/${lang}/${id}.json`, "utf8"),
      );
      await page.goto(`/${lang}/blog/${id}`);
      await expect(page.locator(".blog-post-header h1")).toHaveText(title);
      await page.goto(`/${lang}/blog`);
      await expect(
        page.locator(`a.blog-card[href$="/blog/${id}"]`).first(),
      ).toContainText(title);
    });
  }

  // BOA-908: ブログ画像の width/height はビルドの時に画像のヘッダーから作る。手書きの表に無かった
  // 画像（st-consideration-*）にも付き、値は実寸と同じであること
  test("記事の画像に実寸の width/height が付く（手書きの表に無かった画像も）", async ({
    page,
  }) => {
    const dims = buildImageDimensions("public/images/blog", "/images/blog/");
    await page.goto("/blog/st-consideration-guide");
    const imgs = page.locator(".blog-post-content img");
    await expect(imgs.first()).toBeAttached();
    const attrs = await imgs.evaluateAll((els) =>
      els.map((el) => ({
        src: el.getAttribute("src"),
        width: el.getAttribute("width"),
        height: el.getAttribute("height"),
      })),
    );
    expect(attrs.length).toBeGreaterThan(0);
    for (const { src, width, height } of attrs) {
      expect(dims[src], `${src} は寸法の表にある`).toBeTruthy();
      expect({ src, width, height }).toEqual({
        src,
        width: String(dims[src].width),
        height: String(dims[src].height),
      });
    }
  });

  test("英語版が無い記事は/en/blog/{id}でja版へリダイレクトされる", async ({
    page,
  }) => {
    await page.goto("/en/blog/why-you-lose");
    await expect(page).toHaveURL(/\/blog\/why-you-lose$/);
    await expect(page).not.toHaveURL(/^\/en\//);
  });
});
