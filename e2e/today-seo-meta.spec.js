import { test, expect } from "./fixtures.js";

/**
 * 「本日のデータ一覧」（/today）の title・description・h1（集客レーン Phase3）の固定。
 *
 * - title・description・keywords（画面に表示されないメタ情報）は「今日の競艇 鉄板・荒れる」の語を含む
 *   （code-style.md 例外1）
 * - 画面の h1 は「本日のデータ一覧（鉄板・荒れるの判断材料）」で、「競艇」は出さない
 * - 画面の本文にも「競艇」は出ない
 *
 * 文言は src/data/morningDigestCopy.js の MORNING_DIGEST_META が唯一の出所。
 * 日付は生成済みの過去日に固定する（当日は早朝バッチの前だと未生成のため）。
 */
const DIGEST_FIXED_DATE = "2026-09-22";

test("/today: title・description に競艇・鉄板・荒れる、画面には競艇を出さない", async ({
  page,
}) => {
  await page.goto(`/today?date=${DIGEST_FIXED_DATE}`);

  const h1 = page.locator("h1.morning-digest__title");
  await expect(h1).toHaveText("本日のデータ一覧（鉄板・荒れるの判断材料）");

  await expect(page).toHaveTitle(/^今日の競艇 鉄板・荒れるの判断材料｜/);
  const description = await page
    .locator('meta[name="description"]')
    .last()
    .getAttribute("content");
  expect(description).toContain("競艇");
  expect(description).toContain("鉄板");
  expect(description).toContain("荒れる");

  // 画面に表示される本文には「競艇」を出さない（メタ情報だけの例外）
  await expect(page.locator(".morning-digest")).not.toContainText("競艇");
});
