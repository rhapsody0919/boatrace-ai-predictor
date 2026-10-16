import { test, expect } from "./fixtures.js";

// BOA-881: PC のレース詳細の列の決まり（2026-10-16 オーナー承認の案A、docs/design/race-detail-pc-width）。
// 見出し・ヘッダー・タブ・本文・下の案内・思考アシストを、最大1200の1本の列にして画面の中央に置く。
// 列の幅は min(画面幅 − 48, 1200)、左端は (画面幅 − 列の幅) / 2。
// 1200px 以上は、幅を絞った中身（表 640〜720・1行1艇の棒）の右に注記や対のカードを置く2段（.race-split）。
// 以前（BOA-820）は最大1600のページの中で 全幅／1200／720 の3段を左端にそろえており、1920px で
// 右端が 904・1384・1736 と混ざって「PCで左に寄る」と見えた
const RACE = "/race/2026-10-09-20-09";

const TABS = [
  "基本情報",
  "龍神ソナー",
  "AI予想",
  "今節",
  "直前情報",
  "枠別情報",
  "モータ情報",
  "オッズ一覧",
  "結果",
];

const column = (vw) => {
  const width = Math.min(vw - 48, 1200);
  const left = (vw - width) / 2;
  return { left, right: left + width };
};

const rectOf = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, width: r.width };
  }, selector);

const near = (actual, expected, label) =>
  expect(
    Math.abs(actual - expected),
    `${label}: ${actual} と ${expected}`,
  ).toBeLessThanOrEqual(1);

for (const width of [1280, 1440, 1920, 2560]) {
  test(`${width}px: ヘッダー・見出し・タブ・本文・下の案内が同じ列にそろい、タブを切り替えても動かない（BOA-881）`, async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize({ width, height: 900 });
    await page.goto(RACE);
    await expect(page.locator(".race-tabs-btn").first()).toBeVisible({
      timeout: 30000,
    });
    const col = column(width);

    // ヘッダー（ロゴ・メニュー）、パンくず、タブの並び、攻略ガイド、その他のレース
    near((await rectOf(page, ".app-header .logo")).left, col.left, "ロゴの左端");
    near((await rectOf(page, ".app-header .nav")).right, col.right, "メニューの右端");
    for (const sel of [
      ".breadcrumb",
      ".race-tabs-bar",
      ".assist-entry-row",
      ".venue-guide-link",
      ".race-nav-card",
    ]) {
      const r = await rectOf(page, sel);
      expect(r, `${sel} がある`).not.toBeNull();
      near(r.left, col.left, `${sel} の左端`);
      near(r.right, col.right, `${sel} の右端`);
    }

    // どのタブでも、中身の一番外の箱は列の左右の端と同じ
    for (const tab of TABS) {
      await page.locator(".race-tabs-btn", { hasText: tab }).first().click();
      const panel = page.locator(".race-tabs-panel > *").first();
      await expect(panel).toBeVisible({ timeout: 30000 });
      const r = await panel.evaluate((el) => {
        const b = el.getBoundingClientRect();
        return { left: b.left, right: b.right };
      });
      near(r.left, col.left, `${tab} の中身の左端`);
      near(r.right, col.right, `${tab} の中身の右端`);
    }

    // ページ全体は横スクロールしない
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBe(0);
  });
}

for (const width of [1440, 1920]) {
  test(`${width}px: 2段は上端がそろい、左右のセルがカードの中身の両端に付く（BOA-881）`, async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize({ width, height: 900 });
    await page.goto(RACE);
    await expect(page.locator(".race-tabs-btn").first()).toBeVisible({
      timeout: 30000,
    });
    // 基本情報（棒｜凡例）・今節（表｜注記）・枠別情報（表｜注意書き、逃げ｜決まり手）・結果（隊形｜着順、払戻｜水面傾向）
    const expected = { 基本情報: 1, 今節: 1, 枠別情報: 2, 結果: 2 };
    for (const [tab, min] of Object.entries(expected)) {
      await page.locator(".race-tabs-btn", { hasText: tab }).first().click();
      const splits = page.locator(".race-tabs-panel .race-split");
      await expect
        .poll(() => splits.count(), { timeout: 30000, message: `${tab} の2段` })
        .toBeGreaterThanOrEqual(min);
      // 読み込みで高さが変わっても位置は変わらないが、中身がそろってから測る
      await page.waitForTimeout(1500);
      const cells = await splits.evaluateAll((els) =>
        els.map((el) => {
          const box = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          const main = el.querySelector(":scope > .race-split__main");
          const side = el.querySelector(":scope > .race-split__side");
          const r = (e) => e && e.getBoundingClientRect();
          return {
            display: style.display,
            columns: style.gridTemplateColumns.split(" ").length,
            left: box.left,
            right: box.right,
            main: r(main) && { left: r(main).left, top: r(main).top },
            side: r(side) && {
              right: r(side).right,
              top: r(side).top,
              width: r(side).width,
            },
          };
        }),
      );
      for (const [i, c] of cells.entries()) {
        const label = `${tab} の2段 ${i + 1}`;
        expect(c.display, label).toBe("grid");
        if (c.columns < 2) continue; // 片方が空のときは1列（データが無いレース）
        near(c.main.left, c.left, `${label}: 左のセルの左端`);
        near(c.side.right, c.right, `${label}: 右のセルの右端`);
        near(c.main.top, c.side.top, `${label}: 左右のセルの上端`);
        expect(c.side.width, `${label}: 右のセルの幅`).toBeGreaterThanOrEqual(300);
      }
    }
  });
}

test("1199px: 2段は使わず、今の縦並びのまま（BOA-881）", async ({ page }) => {
  await page.setViewportSize({ width: 1199, height: 900 });
  await page.goto(RACE);
  await page.locator(".race-tabs-btn", { hasText: "今節" }).first().click();
  const split = page.locator(".race-tabs-panel .race-split").first();
  await expect(split).toBeAttached({ timeout: 30000 });
  await expect(split).toHaveCSS("display", "contents");
});

test("1280px: 6艇を列に並べる表は、1艇の列が150px以上（BOA-881）", async ({
  page,
}) => {
  // 列 1200 に入れても窮屈にならない（BOA-612 で 1600 に広げた判断の見直し。文字 15px が前提）
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(RACE);
  await page.locator(".race-tabs-btn", { hasText: "基本情報" }).first().click();
  const heads = page.locator(".drt-table .drt-boat-th");
  await expect(heads).toHaveCount(6, { timeout: 30000 });
  const widths = await heads.evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().width),
  );
  for (const w of widths) expect(w).toBeGreaterThanOrEqual(150);
  const wrapper = page.locator(".drt-table-wrapper").first();
  expect(
    await wrapper.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
});

for (const width of [1440, 1920]) {
  test(`${width}px: 思考アシストの本体・切り替えの帯・ヘッダーは、レース詳細と同じ列（BOA-881）`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${RACE}/assist`);
    await expect(page.locator(".ta-page").first()).toBeVisible({
      timeout: 30000,
    });
    const col = column(width);
    const ta = await rectOf(page, ".ta-page");
    near(ta.left, col.left, "思考アシストの左端");
    near(ta.right, col.right, "思考アシストの右端");
    near(
      (await rectOf(page, ".assist-view-switch__seg")).left,
      col.left,
      "切り替えの帯の左端",
    );
    near((await rectOf(page, ".app-header .logo")).left, col.left, "ロゴの左端");
    near((await rectOf(page, ".app-header .nav")).right, col.right, "メニューの右端");
  });
}

for (const width of [375, 1024, 1440, 1920]) {
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
      const main = el.closest(".race-split__main");
      return {
        left: tableBox.left,
        width: tableBox.width,
        cardLeft: box.left,
        cardWidth: box.width,
        contentLeft: box.left + insetLeft,
        contentWidth: box.width - insetLeft - insetRight,
        // 1200px 以上は2段の左のセルの中
        mainWidth:
          main && getComputedStyle(main).display !== "contents"
            ? main.getBoundingClientRect().width
            : null,
      };
    });
    near(geometry.left, geometry.contentLeft, "表の左端");
    const room = geometry.mainWidth ?? geometry.contentWidth;
    const expectedWidth = width >= 1025 ? Math.min(720, room) : room;
    near(geometry.width, expectedWidth, "表の幅");
    if (width >= 1440) {
      // カードは列いっぱい（BOA-881）
      const col = column(width);
      near(geometry.cardLeft, col.left, "カードの左端");
      near(geometry.cardWidth, col.right - col.left, "カードの幅");
    }
  });
}

for (const width of [1440, 1920]) {
  test(`${width}px: AI予想は列の左端から始まり、1つの節は720まで。共有ボタンも左端（BOA-820・BOA-881）`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(RACE);
    await page.locator(".race-tabs-btn", { hasText: "AI予想" }).first().click();
    const tab = page
      .locator(".race-ai-prediction-tab, .prediction-result")
      .first();
    await expect(tab).toBeVisible({ timeout: 30000 });
    const colLeft = column(width).left;
    near((await tab.boundingBox()).x, colLeft, "AI予想の左端");
    // 節（1行1項目のリスト）は 720 まで。決まり手と確率が離れすぎない（BOA-619）
    const sections = await tab
      .locator(":scope > *")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    for (const w of sections) expect(w).toBeLessThanOrEqual(720);
    // 中の見出しは左そろえ
    const title = tab.locator(".result-verify-title").first();
    if (await title.count()) {
      await expect(title).toHaveCSS("text-align", "left");
    }
    // 共有ボタンも左端に（全タブ共通の部品）
    const share = page.locator(".social-share-buttons").first();
    if (await share.count()) {
      const first = await share
        .locator("> *")
        .first()
        .evaluate((el) => el.getBoundingClientRect().left);
      near(first, colLeft, "共有ボタンの左端");
    }
  });
}

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
