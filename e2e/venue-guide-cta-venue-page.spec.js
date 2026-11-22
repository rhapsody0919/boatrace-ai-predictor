import { test, expect } from "./fixtures.js";

// BOA-1704: 言語版の会場ガイドの「今日の予想」CTA は、その会場の言語版ページ /<lang>/venue/N へ送る。
// 平和島の会場コードは 4。一覧のページの CTA は会場が決まらないので /<lang>/ のまま。
const LANGS = ["en", "ko", "zh-TW"];
const VIEWPORTS = [
  { name: "375x812", width: 375, height: 812 },
  { name: "1280x800", width: 1280, height: 800 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`会場ガイドの CTA（${viewport.name}）`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const lang of LANGS) {
      test(`/${lang}/venues/heiwajima の CTA は /${lang}/venue/4 へ送る`, async ({
        page,
      }) => {
        await page.goto(`/${lang}/venues/heiwajima`);
        const cta = page.locator("a.eg-cta-button");
        await expect(cta).toHaveAttribute("href", `/${lang}/venue/4`);
        await cta.scrollIntoViewIfNeeded();
        await cta.click();
        await expect(page).toHaveURL(new RegExp(`/${lang}/venue/4$`));
        await expect(
          page
            .getByRole("heading", { name: /Heiwajima|헤이와지마|平和島/ })
            .first(),
        ).toBeVisible();
      });
    }

    test("/en/venues の一覧のページの CTA は /en/ のまま", async ({ page }) => {
      await page.goto("/en/venues");
      await expect(page.locator("a.eg-cta-button")).toHaveAttribute(
        "href",
        "/en/",
      );
    });
  });
}
