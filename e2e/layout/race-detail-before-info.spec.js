import { test, expect } from "../fixtures.js";

// 直前情報の展示情報カード（本番の不具合、2026-10-02）。スマホで表だけを calc(50% - 50vw) で
// 画面の端まで広げていたため、表がカードの左右の枠の外へ覆い被さり、端末によっては表が画面の
// 左端より外へ押し出されて行見出しの頭（「展示ST」→「示ST」）が切れた
for (const path of ["/race/2026-09-29-16-12", "/en/race/2026-09-29-16-12"]) {
  test.describe(`レイアウト: 直前情報の展示情報カード（${path.startsWith("/en") ? "en" : "ja"}）`, () => {
    // スマホは機種で幅が違い、320px 以下だけ別の余白の指定がある（RaceDetail.css・RaceDetailPage.css）。
    // layout-mobile（375px）のときは 320・390px も通す（PR #1135 で、#1127 を取り込む前の
    // ブランチの Preview がこの崩れのまま出た）
    test("表がカードの内側に収まり、行見出しが画面の左端で切れない", async ({
      page,
    }, testInfo) => {
      // 7つの幅でページを開き直すので、既定の 60 秒では足りないことがある
      test.slow();
      const widths =
        testInfo.project.name === "layout-mobile"
          ? [320, 375, 390, 520, 600, 700, 768]
          : [null];
      for (const width of widths) {
        if (width) await page.setViewportSize({ width, height: 812 });
        await checkBeforeInfoExhibitionCard(page, path, width);
      }
    });
  });
}

async function checkBeforeInfoExhibitionCard(page, path, width) {
  const at = width ? `${width}px: ` : "";
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page
    .locator(".race-tabs-btn")
    .filter({ hasText: /直前情報|Just Before/ })
    .first()
    .click({ timeout: 30000 });
  const table = page.locator(".rbi-card .drt-table").first();
  await expect(table).toBeVisible({ timeout: 30000 });
  const m = await table.evaluate((el) => {
    const card = el.closest(".rbi-card").getBoundingClientRect();
    const wrap = el.closest(".drt-table-wrapper").getBoundingClientRect();
    const labels = [...el.querySelectorAll(".drt-label-cell")].map(
      (c) => c.getBoundingClientRect().left,
    );
    const wrapEl = el.closest(".drt-table-wrapper");
    // 同じタブの、表を持たないカード（水面・展示タイム・進入など）
    const others = [...document.querySelectorAll(".rbi-card")]
      .filter((c) => !c.querySelector(".drt-table-wrapper") && c.offsetParent)
      .map((c) => {
        const r = c.getBoundingClientRect();
        return [r.left, r.right];
      });
    return {
      card: [card.left, card.right],
      wrap: [wrap.left, wrap.right],
      minLabelLeft: Math.min(...labels),
      vw: document.documentElement.clientWidth,
      tableOverflow: wrapEl.scrollWidth - wrapEl.clientWidth,
      tableVOverflow: wrapEl.scrollHeight - wrapEl.clientHeight,
      others,
    };
  });
  // 表（横スクロールの枠）はカードの左右の枠の内側にある
  expect(m.wrap[0], `${at}表の左端`).toBeGreaterThanOrEqual(m.card[0] - 0.5);
  expect(m.wrap[1], `${at}表の右端`).toBeLessThanOrEqual(m.card[1] + 0.5);
  // カードも画面からはみ出さない
  expect(m.card[0], `${at}カードの左端`).toBeGreaterThanOrEqual(-0.5);
  expect(m.card[1], `${at}カードの右端`).toBeLessThanOrEqual(m.vw + 0.5);
  // 行見出しの左端が画面とカードの内側にある（頭が切れない）
  expect(m.minLabelLeft, `${at}行見出し`).toBeGreaterThanOrEqual(
    Math.max(0, m.card[0]) - 0.5,
  );
  // 表の内側で縦にスクロールしない。375px で表 716px / 枠 630px と下の行（今節直線など）が
  // 内側で切れ、続きがあると気づけなかった（BOA-757）
  expect(
    m.tableVOverflow,
    `${at}展示情報の表の縦スクロール`,
  ).toBeLessThanOrEqual(1);
  if (!width) return;
  // 375〜767px: 6艇が表の横スクロール無しで入る（以前は 520px で表 531px / 表示枠 438px）。
  // 320px は対象外: 列の幅が 11px の文字の幅だけで決まり、CI（Linux のフォント）では 34px はみ出す
  // （Mac の Chromium・Preview では 312/312 で収まる）。表は横スクロールのヒント付きで読める。
  // 320px で横スクロールを無くすには列の中身を折る必要があり、仕様（FR-1 は 520・600・700px）の外
  if (width >= 375) {
    expect(
      m.tableOverflow,
      `${width}px: 展示情報の表の横スクロール`,
    ).toBeLessThanOrEqual(1);
  }
  // 767px 以下: ほかのカードは画面の左右 8px（docs/design/race-detail-ui-unify FR-1 案B）。
  // 768px は表の縦スクロールの境目を確かめるために通すだけ（BOA-757）
  if (width > 767) return;
  for (const [left, right] of m.others) {
    expect(left, `${width}px: カードの左の余白`).toBeCloseTo(8, 0);
    expect(m.vw - right, `${width}px: カードの右の余白`).toBeCloseTo(8, 0);
  }
}
