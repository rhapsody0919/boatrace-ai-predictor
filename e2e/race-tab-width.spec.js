import { test, expect } from "./fixtures.js";

// BOA-820: PC のタブの横幅と左端を決まりにそろえる（2026-10-10 ユーザー決定）。
// 決まり: 全幅（6艇を列に並べる表）／最大1200（図とリスト）／720（文章と1行1項目）の3段で、どの段も左端はタブの列。
// 修正前は AI予想が720で中央寄せ（1440px で左端 x=360、1920px で x=600）、思考アシストが1920px で
// 左端 x=24（レース詳細のタブの列は x=184）だった
const RACE = "/race/2026-10-09-20-09";

const left = (locator) =>
  locator.evaluate((el) => Math.round(el.getBoundingClientRect().left));

for (const width of [375, 1024, 1025, 1440, 1920]) {
  test(`${width}px: 枠別情報の表はPCで最大720、カード内の左端を保つ（BOA-827）`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(RACE);
    await page
      .locator(".race-tabs-btn", { hasText: "枠別情報" })
      .first()
      .click();
    const table = page.locator(".rwit-today-table").first();
    await expect(table).toBeVisible({ timeout: 30000 });
    const geometry = await table.evaluate((el) => {
      const card = el.closest(".rwit-card");
      const style = getComputedStyle(card);
      const box = card.getBoundingClientRect();
      const tableBox = el.getBoundingClientRect();
      // 767px以下は既存の規則で表をカードの枠の内側まで広げる。
      const mobile = window.innerWidth <= 767;
      const insetLeft =
        parseFloat(style.borderLeftWidth) +
        (mobile ? 0 : parseFloat(style.paddingLeft));
      const insetRight =
        parseFloat(style.borderRightWidth) +
        (mobile ? 0 : parseFloat(style.paddingRight));
      return {
        left: tableBox.left,
        width: tableBox.width,
        cardLeft: box.left,
        cardWidth: box.width,
        contentLeft: box.left + insetLeft,
        contentWidth: box.width - insetLeft - insetRight,
      };
    });
    expect(Math.abs(geometry.left - geometry.contentLeft)).toBeLessThanOrEqual(
      1,
    );
    const expectedWidth =
      width >= 1025
        ? Math.min(720, geometry.contentWidth)
        : geometry.contentWidth;
    expect(Math.abs(geometry.width - expectedWidth)).toBeLessThanOrEqual(1);
    if (width >= 1440) {
      expect(Math.abs(geometry.cardWidth - 1200)).toBeLessThanOrEqual(1);
      expect(
        Math.abs(geometry.cardLeft - (width === 1440 ? 24 : 184)),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(geometry.left - (width === 1440 ? 37 : 197)),
      ).toBeLessThanOrEqual(1);
    }
  });
}

for (const width of [1440, 1920]) {
  test(`${width}px: AI予想の中身・共有ボタンの左端はタブの列にそろい、幅は720まで`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(RACE);
    await page.locator(".race-tabs-btn", { hasText: "AI予想" }).first().click();
    const tab = page
      .locator(".race-ai-prediction-tab, .prediction-result")
      .first();
    await expect(tab).toBeVisible({ timeout: 30000 });
    const barLeft = await left(page.locator(".race-tabs-bar"));
    const box = await tab.boundingBox();
    expect(Math.abs(Math.round(box.x) - barLeft)).toBeLessThanOrEqual(1);
    expect(box.width).toBeLessThanOrEqual(720);
    // 中の見出しは左そろえ
    const title = tab.locator(".result-verify-title").first();
    if (await title.count()) {
      await expect(title).toHaveCSS("text-align", "left");
    }
    // 共有ボタンも左端に（全タブ共通の部品）
    const share = page.locator(".social-share-buttons").first();
    if (await share.count()) {
      expect(
        Math.abs((await left(share.locator("> *").first())) - barLeft),
      ).toBeLessThanOrEqual(1);
    }
  });
}

test("1920px: 思考アシストの左端は、レース詳細のタブの列と同じ x", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(RACE);
  const barLeft = await left(page.locator(".race-tabs-bar"));
  await page.goto(`${RACE}/assist`);
  const ta = page.locator(".ta-page").first();
  await expect(ta).toBeVisible({ timeout: 30000 });
  expect(Math.abs((await left(ta)) - barLeft)).toBeLessThanOrEqual(1);
});

test("1440px: タブの説明文の行は最大720（枠別情報）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(RACE);
  await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).first().click();
  const note = page.locator(".rwit-note").first();
  await expect(note).toBeVisible({ timeout: 30000 });
  expect((await note.boundingBox()).width).toBeLessThanOrEqual(720);
});

test("「?」は見た目16pxのまま、押せる範囲は24×24", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(RACE);
  await page.locator(".race-tabs-btn", { hasText: "基本情報" }).first().click();
  const btn = page.locator(".drt-table .term-hint__button").first();
  await expect(btn).toBeVisible({ timeout: 30000 });
  await btn.scrollIntoViewIfNeeded();
  const b = await btn.boundingBox();
  expect(Math.round(b.width)).toBeLessThanOrEqual(18);
  // ボタンの外側 3px の点（見た目の外、押せる範囲の内）を押しても「?」が反応する。
  // 位置の取得と判定を同じ瞬間に行う（読み込み中に行がずれると、別々に取った座標が外れる）
  const hit = await btn.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.right + 3, r.top + r.height / 2);
    return at?.closest(".term-hint__button") === el;
  });
  expect(hit).toBe(true);
});
