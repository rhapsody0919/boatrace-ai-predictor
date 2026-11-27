// 記事のページの幅の使い方を守る: 表の列が潰れない・スマホは本文の枠を外す・1100px 以上は本文＋右の目次の2列（BlogPost.css、2026-11-27）
import { test, expect } from "../fixtures.js";
import { OVERFLOW_TOLERANCE_PX } from "./helpers.js";

// 3列の表（2着のコース・逃し時2着率・2連単）と2列の表（表示・意味）を持つ記事。
// 2026-11-27 の本番は 375px で表の2列目以降が1〜2文字幅（約20px）に潰れていた
const PATH = "/blog/nige-simulation-guide";

test(`${PATH} の表の列が潰れず、頁が横にはみ出さない @blog`, async ({ page }) => {
  await page.goto(PATH, { waitUntil: "domcontentloaded" });
  const cells = page.locator(".blog-post-content td");
  await expect(cells.first()).toBeVisible();
  const narrowest = await cells.evaluateAll((els) =>
    Math.min(...els.map((el) => el.getBoundingClientRect().width)),
  );
  // 1列目の下限（6em ≒ 96px）より細い列があれば潰れている
  expect(narrowest).toBeGreaterThanOrEqual(90);
  const sizes = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(sizes.scrollWidth).toBeLessThanOrEqual(
    sizes.clientWidth + OVERFLOW_TOLERANCE_PX,
  );
});

test(`${PATH} は幅に合わせて本文と目次を並べる @blog`, async ({ page }) => {
  await page.goto(PATH, { waitUntil: "domcontentloaded" });
  const article = page.locator(".blog-post-content");
  await expect(article).toBeVisible();
  const { width } = page.viewportSize();
  const box = await article.boundingBox();
  const sideToc = page.locator(".blog-post-side-toc");
  const inlineToc = page.locator(".blog-post-main .toc-section");

  if (width >= 1100) {
    // 右の目次が本文の右に並び、本文は 760px 以上ある（800px の1列に固定しない）
    await expect(sideToc).toBeVisible();
    await expect(inlineToc).toBeHidden();
    const side = await sideToc.boundingBox();
    expect(side.x).toBeGreaterThanOrEqual(box.x + box.width);
    expect(box.width).toBeGreaterThanOrEqual(760);
    // 左右の空きは器の外の余白だけ（1920px で本文の左が 576px あった）
    expect(box.x).toBeLessThan(width * 0.2);
  } else {
    await expect(sideToc).toBeHidden();
    await expect(inlineToc).toBeVisible();
  }

  if (width <= 768) {
    // スマホ・タブレットは本文の枠を外し、余白は外の 1rem だけ
    const padding = await article.evaluate(
      (el) => getComputedStyle(el).paddingLeft,
    );
    expect(padding).toBe("0px");
    expect(box.x).toBeLessThanOrEqual(17);
  }
});
