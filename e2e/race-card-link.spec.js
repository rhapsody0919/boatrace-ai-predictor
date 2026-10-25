import { test, expect } from "./fixtures.js";

// SEO 点検 F3（2026-10-11）。会場のレース一覧からレース詳細へ進む「詳細を見る」が button の onClick で、
// 遷移先の URL を持たず、検索エンジンがレース詳細へのリンクを辿れなかった。URL を持つリンクにする
test.describe.configure({ timeout: 120000 });

test("会場のレース一覧の「詳細を見る」は、レース詳細の URL を持つリンクで、押すとレース詳細へ進む", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator(".venue-grid-card--open").first().click();
  const link = page.locator(".race-card .predict-btn").first();
  await expect(link).toBeVisible({ timeout: 30000 });
  await expect(link).toHaveJSProperty("tagName", "A");
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/race\/\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
});

test("英語の会場ページでは、リンク先も英語のレース詳細", async ({ page }) => {
  await page.goto("/en/", { waitUntil: "domcontentloaded" });
  await page.locator(".venue-grid-card--open").first().click();
  const link = page.locator(".race-card .predict-btn").first();
  await expect(link).toBeVisible({ timeout: 30000 });
  expect(await link.getAttribute("href")).toMatch(
    /^\/en\/race\/\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/,
  );
});

test("過去日付の会場ページでも、リンクでレース詳細へ進む", async ({ page }) => {
  await page.goto("/races/2026-07-13", { waitUntil: "domcontentloaded" });
  await page.locator(".venue-grid-card--open").first().click();
  const link = page.locator(".race-card .predict-btn").first();
  await expect(link).toBeVisible({ timeout: 30000 });
  expect(await link.getAttribute("href")).toMatch(/^\/race\/2026-07-13-/);
});

// 見た目の規則が締切後のカードにしか効かず、締切前のカードの「詳細を見る」が下線つき・左寄せ・
// 狭い inline だった（#1396 で規則の途中に差し込んだため）。締切前と締切後の両方のカードで確かめる。
// 締切前のカードは、録画の時刻（17時台）にまだ締切前のレースがある会場（ナイター等）を探して使う
async function expectButtonLook(card) {
  const link = card.locator(".predict-btn");
  await expect(link).toBeVisible({ timeout: 30000 });
  await expect(link).toHaveCSS("display", "block");
  await expect(link).toHaveCSS("text-decoration-line", "none");
  await expect(link).toHaveCSS("text-align", "center");
  const cardBox = await card.boundingBox();
  const box = await link.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  // カードの内側いっぱい（左右の余白ぶんだけ狭い）
  expect(box.width).toBeGreaterThan(cardBox.width * 0.8);
}

test("リンクにしても、ボタンと同じ見た目（幅いっぱい・中央そろえ・下線なし・高さ44px以上）: 締切後のカード", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator(".venue-grid-card--open").first().click();
  const card = page.locator(".race-card.race-card--deadline-passed").first();
  await expect(card).toBeVisible({ timeout: 30000 });
  await expectButtonLook(card);
});

test("リンクにしても、ボタンと同じ見た目（幅いっぱい・中央そろえ・下線なし・高さ44px以上）: 締切前のカード", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const venues = page.locator(".venue-grid-card--open");
  await expect(venues.first()).toBeVisible({ timeout: 30000 });
  const hrefs = await venues.evaluateAll((els) =>
    els.map((el) => el.getAttribute("href")),
  );
  for (const href of hrefs) {
    await page.goto(href, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".race-card").first()).toBeVisible({
      timeout: 30000,
    });
    const upcoming = page
      .locator(".race-card:not(.race-card--deadline-passed)")
      .first();
    if ((await upcoming.count()) === 0) continue;
    await expectButtonLook(upcoming);
    return;
  }
  throw new Error(
    "締切前のカードがある会場が見つからない（録画の時刻とデータを確かめる）",
  );
});
