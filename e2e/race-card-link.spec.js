import { test, expect, fetchRecorded } from "./fixtures.js";

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
// 締切前のカードは、固定の過去日（2026-09-18）の時計と結果 null で作る（実時計に依らず昼夜同じ）
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
  // 締切後のカードは過去日付の会場ページで探す（結果が確定したレースは締切後の見た目になる。getRaceStatus）。
  // 以前は本日の先頭の会場を開いていたが、撮影の時刻によっては先頭の会場（ナイター等）にまだ締切後の
  // レースが無く、撮り直しの strict 再生で落ちた（2026-10-26 の JST 10:23・12:47・14:37 の3回、BOA-929）
  await page.goto("/races/2026-07-13", { waitUntil: "domcontentloaded" });
  await page.locator(".venue-grid-card--open").first().click();
  const card = page.locator(".race-card.race-card--deadline-passed").first();
  await expect(card).toBeVisible({ timeout: 30000 });
  await expectButtonLook(card);
});

test("リンクにしても、ボタンと同じ見た目（幅いっぱい・中央そろえ・下線なし・高さ44px以上）: 締切前のカード", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  // race-entrants-strip.spec.js の「本日の締切前は、見出しに締切時刻を出す」と同じ固定: 戸田8R（2026-09-18）の
  // 締切前の 13:46 に時計を置き、全レースの結果を外して、どの会場でも締切前のカードが出るようにする
  await page.clock.setFixedTime(new Date("2026-09-18T13:46:00+09:00"));
  await page.route("**/api/predictions/2026-09-18*", async (route) => {
    try {
      const response = await fetchRecorded(route);
      const body = await response.json();
      const races = (body.races || []).map((race) => ({
        ...race,
        result: null,
      }));
      await route.fulfill(
        response.fulfillOptions({ json: { ...body, races } }),
      );
    } catch (error) {
      // アサーションが先に通ってページが閉じた後の失敗はテストの結果ではない
      // （BOA-1225。page のルートを途中で0件にしない決まり（e2e/fixtures.js）があるので unrouteAll は足さない）
      if (page.isClosed() || /has been closed/.test(String(error?.message)))
        return;
      throw error;
    }
  });
  await page.goto("/races/2026-09-18", { waitUntil: "domcontentloaded" });
  await page.locator(".venue-grid-card--open").first().click();
  const upcoming = page
    .locator(".race-card:not(.race-card--deadline-passed)")
    .first();
  await expectButtonLook(upcoming);
});

// BOA-1231: 会場だけでミニ出走表から ja 専用の選手ページへ進める。
test("会場のミニ出走表の6選手名は、日英とも選手ページへのリンク", async ({ page }) => {
  for (const home of ["/", "/en/"]) {
    await page.goto(home, { waitUntil: "domcontentloaded" });
    await page.locator(".venue-grid-card--open").first().click();
    const card = page.locator(".race-card").first();
    const names = card.locator(".rcdt-name-th a");
    await expect(names).toHaveCount(6);
    for (const name of await names.all()) {
      await expect(name).toHaveAttribute("href", /^\/racer\/\d{4}$/);
      await expect(name).toHaveAttribute("translate", "no");
      await expect(name.locator(".rcdt-name-part").first()).toBeVisible();
      await expect(name).toHaveCSS("text-decoration-line", "none");
    }
    const href = await names.first().getAttribute("href");
    await names.first().click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await page.goBack();
    const detail = page.locator(".race-card .predict-btn").first();
    const detailHref = await detail.getAttribute("href");
    await detail.click();
    await expect(page).toHaveURL(new RegExp(`${detailHref}$`));
  }
});
