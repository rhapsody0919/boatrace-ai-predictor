import { test, expect, e2eTodayJST } from "./fixtures.js";

/**
 * 会場ページの title・description・h1（集客レーン Phase3）の固定。
 *
 * - 本日の /venue/:code: title は「{会場}競艇のAI予想…」で始まる。meta description にも「競艇」が入る
 *   （画面に表示されないメタ情報。code-style.md 例外1）
 * - 画面の h1 は「{会場} 本日のレース・AI予想」で、「競艇」は出さない
 * - 過去日付の /races/:date/:code は従来の title・h1 のまま
 *
 * SG・G1 開催中に節タイトルが入る判定は、開催日程に左右されないよう
 * scripts/maintenance/verify-venue-series-title.js で固定の入力を使って検証する。
 * ここでは、その日に開催中の会場（録画の先頭の会場）で文言の組み立てを見る。
 */

async function firstOpenVenue(page) {
  await page.goto("/");
  const card = page.locator("a.venue-grid-card--open").first();
  await expect(card).toBeVisible({ timeout: 20000 });
  const href = await card.getAttribute("href");
  const name = (
    await card.locator(".venue-grid-card__name").textContent()
  ).trim();
  const code = href.match(/\/venue\/(\d+)$/)?.[1];
  expect(
    code,
    `会場カードのリンクが /venue/:code ではない: ${href}`,
  ).toBeTruthy();
  return { href, name, code };
}

test.describe("会場ページの title・description・h1", () => {
  test("本日の会場ページ: title・description に競艇、h1 には出さない", async ({
    page,
  }) => {
    const venue = await firstOpenVenue(page);
    await page.goto(venue.href);

    const h1 = page.locator(".venue-race-list-page h1");
    await expect(h1).toContainText(`${venue.name} 本日のレース・AI予想`);
    await expect(h1).not.toContainText("競艇");

    await expect(page).toHaveTitle(new RegExp(`^${venue.name}競艇のAI予想`));
    await expect(page).toHaveTitle(/｜本日の全レース - 龍神レーダー$/);
    const description = await page
      .locator('meta[name="description"]')
      .last()
      .getAttribute("content");
    expect(description).toContain(
      `${venue.name}競艇（ボートレース${venue.name}）`,
    );
  });

  test("過去日付の会場ページは従来の title・h1 のまま", async ({ page }) => {
    const venue = await firstOpenVenue(page);
    await page.goto(`/races/${e2eTodayJST()}/${venue.code}`);

    const h1 = page.locator(".venue-race-list-page h1");
    await expect(h1).toContainText(`${venue.name} レース一覧`);
    await expect(page).toHaveTitle(
      /のレース一覧・AIデータ分析 - 龍神レーダー$/,
    );
  });
});
