import { test, expect } from "./fixtures.js";

/**
 * 結果確定後のレース詳細の共有文（BOA-754、ユーザー承認の推奨案）。
 * 以前は結果が出た後も、発走前の予想の文面（「推奨: 1-4 最近的中率が上がってきてて嬉しい😊」）を
 * そのまま共有させていた。結果確定後は、展開予測の候補のどれかが1着なら的中の文面
 * （本命が予想どおりなら「展開予測的中」、それ以外は「1着の艇が的中」）、どれも1着でなければ
 * 共有ボタンを出さない。4言語。
 */

async function captureShare(page, path) {
  await page.addInitScript(() => {
    window.__opened = [];
    window.open = (url) => {
      window.__opened.push(String(url));
      return null;
    };
  });
  await page.goto(path, { waitUntil: "domcontentloaded" });
  const button = page
    .locator(".social-share-wrapper .social-share-button")
    .first();
  await button.waitFor({ timeout: 60000 });
  // 進入コースの取得（非同期）を待ってから押す
  await page.waitForTimeout(2000);
  await button.click();
  await expect
    .poll(() => page.evaluate(() => window.__opened.length))
    .toBeGreaterThan(0);
  return decodeURIComponent(
    await page.evaluate(() => window.__opened.join(" ")),
  );
}

test("本命が予想どおりに勝ったレースは「展開予測的中」の文面で共有する", async ({
  page,
}) => {
  test.slow();
  // 戸田 9/27 11R: 本命の1号艇が1コースから逃げ
  const text = await captureShare(page, "/race/2026-09-27-02-11");
  expect(text).toContain("🌊 展開予測的中！【09/27 戸田11R】");
  expect(text).toContain("1号艇が1着（AIの予想: 逃げ");
  expect(text).toContain("予想通りの展開でした ✅");
  expect(text).not.toContain("推奨");
});

test("2番手の候補が勝ったレースは「1着の艇が的中」の控えめな文面で共有する", async ({
  page,
}) => {
  test.slow();
  // 戸田 9/30 8R: 本命は1号艇の逃げ、2番手の3号艇がまくりで1着
  const text = await captureShare(page, "/race/2026-09-30-02-08");
  expect(text).toContain("🌊 1着の艇が的中【09/30 戸田8R】");
  expect(text).toContain("3号艇が1着（AIの予想: まくり");
  expect(text).not.toContain("予想通り");
  expect(text).not.toContain("推奨");
});

test("英語版でも、結果確定後は的中の文面を英語で共有する", async ({ page }) => {
  test.slow();
  const text = await captureShare(page, "/en/race/2026-09-30-02-08");
  expect(text).toContain("🌊 The winning boat was in the turn prediction");
  expect(text).toContain("Boat 3 won");
  // 本文にかな（日本語の文面）が混ざらない。ハッシュタグ（#ボートレース 等）は従来どおり日本語
  const body = text.split("&hashtags=")[0];
  expect(body).not.toMatch(/[\u3040-\u30ff]/);
});

test("展開予測の候補がどれも1着でないレースは、共有ボタンを出さない", async ({
  page,
}) => {
  test.slow();
  // 桐生 8/13 2R: 上位候補に無い6号艇が1着
  await page.goto("/race/2026-08-13-01-02", { waitUntil: "domcontentloaded" });
  await page
    .locator(".race-tabs-btn", { hasText: /^AI予想$/ })
    .click({ timeout: 60000 });
  await expect(page.locator(".turn-pattern-summary--miss")).toBeVisible({
    timeout: 60000,
  });
  await expect(page.locator(".social-share-wrapper")).toHaveCount(0);
});
