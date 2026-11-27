import { test, expect } from "./fixtures.js";

/**
 * 結果確定後のレース詳細の共有文（BOA-754）。
 * 確定後の共有文は展開予測の的中の文面（「展開予測的中」「1着の艇が的中」）だけだった。展開予測は
 * BOA-822 の公開（2026-11-27、IN_CAUTION_PUBLIC = true）で画面から消えたので、確定後のレースには
 * 共有ボタンを出さない（task 26）。的中の文面の試験は、表示が無くなったので外した。
 */

test("確定後のレースに共有ボタンを出さない（展開予測の的中の文面は公開で廃止）", async ({
  page,
}) => {
  test.slow();
  // 戸田 9/27 11R: 以前は本命の1号艇の逃げで「展開予測的中」の共有ボタンが出たレース
  await page.goto("/race/2026-09-27-02-11", {
    waitUntil: "domcontentloaded",
  });
  // タブの名前は「イン崩れ」（BOA-822 task 45）
  await page
    .locator(".race-tabs-btn", { hasText: /^イン崩れ$/ })
    .click({ timeout: 60000 });
  await expect(page.locator(".in-caution-tab")).toBeVisible({
    timeout: 60000,
  });
  await page.waitForTimeout(2000);
  await expect(page.locator(".social-share-wrapper")).toHaveCount(0);
});
