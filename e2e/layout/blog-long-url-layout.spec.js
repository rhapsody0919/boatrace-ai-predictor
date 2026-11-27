// 出典に生の長い URL を書いた記事でも、記事のページが横にはみ出さないことを守る（BlogPost.css の .blog-post-content a）
import { test, expect } from "../fixtures.js";
import { OVERFLOW_TOLERANCE_PX } from "./helpers.js";

// 出典の欄に kyoteibiyori.com の長い URL（race_ichiran.php?…）を生で並べている記事。
// 2026-11-27 に 375px で scrollWidth 393 / clientWidth 375 とはみ出していた
const PATH = "/blog/hiyori-how-to-use-guide";

test(`${PATH} の長い URL が折り返され、横スクロールが出ない @blog`, async ({
  page,
}) => {
  await page.goto(PATH, { waitUntil: "domcontentloaded" });
  const link = page.locator('.blog-post-content a[href*="race_ichiran.php"]');
  await expect(link).toBeVisible();
  const sizes = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(sizes.scrollWidth).toBeLessThanOrEqual(
    sizes.clientWidth + OVERFLOW_TOLERANCE_PX,
  );
  const right = await link.evaluate((el) => el.getBoundingClientRect().right);
  expect(right).toBeLessThanOrEqual(sizes.clientWidth + OVERFLOW_TOLERANCE_PX);
});
