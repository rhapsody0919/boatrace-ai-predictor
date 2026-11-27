import { test, expect } from "./fixtures.js";
import { DAYS, EDITION, FAQ } from "../src/data/grandPrixFeature.js";

// グランプリの特集（/grandprix、BOA-1724）。中身はデータのファイルから数えるので、年を差し替えても同じ形で試す
test("/grandprix: 題・日程・FAQ の構造化データ・会場ページへの導線・断り", async ({ page }) => {
  await page.goto("/grandprix");

  await expect(page).toHaveTitle(new RegExp(`グランプリ${EDITION.year}特集`));
  await expect(page.locator(".gp-head h1")).toContainText(EDITION.longDates);
  await expect(page.locator("link[rel=canonical]")).toHaveAttribute(
    "href",
    "https://www.boat-ai.jp/grandprix",
  );
  await expect(page.locator(".gp-days li")).toHaveCount(DAYS.length);
  await expect(page.locator(".gp-faq h3")).toHaveCount(FAQ.length);

  // FAQPage の問いは画面の問いと同じ数・同じ並び
  const faqLd = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((els) =>
      els.map((e) => JSON.parse(e.textContent)).find((d) => d["@type"] === "FAQPage"),
    );
  expect(faqLd.mainEntity.map((q) => q.name)).toEqual(FAQ.map((f) => f.q));

  // つなぐ先は会場ページ。節のページ（グランプリは対象外）と AI のタブ（展開予測）にはつながない
  await expect(page.locator(`main a[href="/venue/${EDITION.venueCode}"]`).first()).toBeVisible();
  await expect(page.locator('main a[href*="/meet/"]')).toHaveCount(0);
  await expect(page.locator('main a[href*="tab=ai"]')).toHaveCount(0);

  const disclaimer = page.locator(".gp-disclaimer");
  await expect(disclaimer).toContainText("結果を保証するものではありません");
  await expect(disclaimer).toContainText("日本国内に住む20歳以上");
  await expect(page.locator(".gp-page")).not.toContainText("競艇");
});
