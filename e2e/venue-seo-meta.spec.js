import { test, expect } from "./fixtures.js";
import {
  ensureOpenVenues,
  rewriteTodayRaces,
  setJstNoon,
} from "./today-races-rewrite.js";

/**
 * 会場ページの title・description・h1（集客レーン Phase3）の固定。
 *
 * - 本日の /venue/:code: title は「{会場}競艇の予想・出走表…」で始まる（BOA-1189 で「予想・出走表」寄りにした）。meta description にも「競艇」が入る
 *   （画面に表示されないメタ情報。code-style.md 例外1）
 * - 画面の h1 は「{会場} 本日のレース・AI予想」で、「競艇」は出さない
 * - 過去日付の /races/:date/:code は従来の title・h1 のまま
 *
 * SG・G1 開催中に節タイトルが入る判定は、開催日程に左右されないよう
 * scripts/maintenance/verify-venue-series-title.js で固定の入力を使って検証する。
 * ここでは、その日に開催中の会場（録画の先頭の会場）で文言の組み立てを見る。
 */

// 今日が題の試験は、本日のレースの応答に開催中の会場を足してトップから入る。
// 過去日の試験は固定の過去日の一覧から入る（どちらも深夜の会場無しに依らない）
async function firstOpenVenue(page, { from, codePattern }) {
  await page.goto(from);
  const card = page.locator("a.venue-grid-card--open").first();
  await expect(card).toBeVisible({ timeout: 20000 });
  const href = await card.getAttribute("href");
  const name = (
    await card.locator(".venue-grid-card__name").textContent()
  ).trim();
  const code = href.match(codePattern)?.[1];
  expect(
    code,
    `会場カードのリンクが想定の形ではない: ${href}`,
  ).toBeTruthy();
  return { href, name, code };
}

test.describe("会場ページの title・description・h1", () => {
  test("本日の会場ページ: title・description に競艇、h1 には出さない", async ({
    page,
  }) => {
    await setJstNoon(page);
    await rewriteTodayRaces(page, (venues) => ensureOpenVenues(venues, 1));
    const venue = await firstOpenVenue(page, {
      from: "/",
      codePattern: /\/venue\/(\d+)$/,
    });
    await page.goto(venue.href);

    const h1 = page.locator(".venue-race-list-page h1");
    await expect(h1).toContainText(`${venue.name} 本日のレース・AI予想`);
    await expect(h1).not.toContainText("競艇");

    await expect(page).toHaveTitle(
      new RegExp(`^${venue.name}競艇の予想・出走表`),
    );
    await expect(page).toHaveTitle(/｜本日の(全レース)?AI予想 - 龍神レーダー$/);
    const description = await page
      .locator('meta[name="description"]')
      .last()
      .getAttribute("content");
    expect(description).toContain(
      `${venue.name}競艇（ボートレース${venue.name}）`,
    );
  });

  test("過去日付の会場ページは従来の title・h1 のまま", async ({ page }) => {
    const venue = await firstOpenVenue(page, {
      from: "/races/2026-08-11",
      codePattern: /\/races\/2026-08-11\/(\d+)$/,
    });
    await page.goto(`/races/2026-08-11/${venue.code}`);

    const h1 = page.locator(".venue-race-list-page h1");
    await expect(h1).toContainText(`${venue.name} レース一覧`);
    await expect(page).toHaveTitle(
      /のレース一覧・AIデータ分析 - 龍神レーダー$/,
    );
  });
});
