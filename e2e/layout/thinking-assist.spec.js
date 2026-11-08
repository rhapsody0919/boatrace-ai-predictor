import { test, expect } from "../fixtures.js";
import {
  THINKING_ASSIST_RACE,
  routeThinkingAssistV16,
} from "../thinking-assist-fixture.js";

test.describe("レイアウト: 思考アシストの PC 表示（BOA-880）", () => {
  /** 2026-10-10 の「堅い？荒れる？」の枠 480px のときの棒の行の幅。棒はこれより伸ばさない（差が読みにくくなる） */
  const ROUGH_BAR_ROW_MAX = 458;

  const measure = (page) =>
    page.evaluate(() => {
      const box = (sel) => {
        const e = document.querySelector(sel);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { left: r.left, right: r.right, width: r.width };
      };
      return {
        page: box(".ta-page"),
        header: box(".ta-header"),
        rough: box(".ta-rough-btn"),
        roughBar: box(".ta-rough-btn > .baseline-bar"),
        roughFoot: box(".ta-rough-btn > .ta-rough-foot"),
        fig: box(".ta-split-fig"),
        side: box(".ta-split-side"),
        foot: box(".ta-foot"),
      };
    });

  test("堅い？荒れる？の枠・2段組・固定フッターが列の幅にそろい、棒は伸びすぎない", async ({
    page,
  }) => {
    await routeThinkingAssistV16(page);
    await page.goto(`/race/${THINKING_ASSIST_RACE}/assist`);
    await expect(page.locator(".baseline-bar-track").first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator(".ta-lane").first()).toBeVisible();
    const m = await measure(page);
    const near = (a, b, label) =>
      expect(Math.abs(a - b), `${label}: ${a} と ${b}`).toBeLessThanOrEqual(1);

    // どの幅でも、固定フッターは本文の列と同じ左右の端
    near(m.foot.left, m.page.left, "固定フッターの左端");
    near(m.foot.right, m.page.right, "固定フッターの右端");
    expect(m.roughBar.width).toBeLessThanOrEqual(ROUGH_BAR_ROW_MAX + 1);

    if (page.viewportSize().width < 1024) {
      // 1列: 枠はヘッダーの幅いっぱい、段は縦に積む（棒の下に級の並び）
      expect(m.roughFoot.left).toBeLessThan(m.roughBar.right);
      return;
    }
    // 枠はヘッダーの中で列の幅いっぱい（480px で止まらない）
    const headerPad = m.rough.left - m.header.left;
    near(m.rough.right, m.header.right - headerPad, "堅い？荒れる？の枠の右端");
    // 図と右の列は 1:1、2つで列の幅を埋める
    near(m.fig.width, m.side.width, "図と右の列の幅");
    near(m.fig.left, m.page.left, "図の左端");
    near(m.side.right, m.page.right, "右の列の右端");
    // 枠の右の段（級の並び・件数）は右の列と同じ位置から始まる
    near(m.roughFoot.left, m.side.left, "枠の右の段の左端");
  });
});

// 思考アシストの買い目の券種（BOA-990 ①）。「券種で比べる」の表・券種のタブ・マークシート（2連単で3着の段を薄く残す）が、
// 375〜1920px で横にはみ出さず、タブ・ボタンは 44px 以上押せる
test.describe("レイアウト: 思考アシストの買い目の券種（BOA-990）", () => {
  test("券種で比べる・券種のタブ・マークシートが横にはみ出さない", async ({
    page,
  }) => {
    await routeThinkingAssistV16(page);
    await page.goto(`/race/${THINKING_ASSIST_RACE}/assist`);
    const lens = page.getByRole("tablist", { name: "見方" });
    await expect(lens).toBeVisible({ timeout: 30000 });
    await lens.getByRole("tab", { name: "買い目", exact: true }).click();
    const cand = (b, p) =>
      page.getByRole("button", { name: `${b}号艇を${p}着の候補に` });
    await cand(1, 1).click();
    for (const b of [2, 3, 4]) await cand(b, 2).click();
    for (const b of [2, 3, 4, 5]) await cand(b, 3).click();
    const cmp = page.locator(".ta-bettype-cmp");
    await expect(cmp).toBeVisible();
    // 1列の幅では券種のタブが艇の行より上、2列では右の列（ファン評価3周目 P2、2026-10-27 オーナー）
    const tabs = page.getByRole("group", { name: "券種" });
    await expect(tabs).toHaveCount(1);
    const tabsBox = await tabs.boundingBox();
    const laneBox = await page.locator(".ta-lane").first().boundingBox();
    if (page.viewportSize().width < 1024)
      expect(tabsBox.y + tabsBox.height).toBeLessThanOrEqual(laneBox.y);
    else
      expect(tabsBox.x).toBeGreaterThanOrEqual(laneBox.x + laneBox.width - 1);
    // 図の見出し（どの券種の合成か）は 12px 以上（ファン評価2周目 P2-2）
    expect(
      await page
        .locator(".ta-board-title.is-bet")
        .evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
    ).toBeGreaterThanOrEqual(12);
    // 固定フッターの「（9点）」は数字と単位を別の行に分けない（ファン評価1周目 指摘3）
    expect(
      await page
        .locator(".ta-foot .ta-nowrap")
        .evaluate((e) => e.getClientRects().length),
    ).toBe(1);
    const overflow = (sel) =>
      page.evaluate((s) => {
        const e = document.querySelector(s);
        return e.scrollWidth - e.clientWidth;
      }, sel);
    expect(await overflow(".ta-bettype-cmp")).toBeLessThanOrEqual(1);
    const cmpBox = await cmp.boundingBox();
    const cmpParent = await page
      .locator(".ta-bettype-cmp")
      .locator("xpath=..")
      .boundingBox();
    expect(cmpBox.x + cmpBox.width).toBeLessThanOrEqual(
      cmpParent.x + cmpParent.width + 1,
    );
    for (const b of await page
      .locator(".ta-bettype button:visible, .ta-bettype-cmp button")
      .all()) {
      const box = await b.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(2);

    await page
      .getByRole("button", { name: "マークシートを開く", exact: true })
      .click();
    const sheet = page.getByRole("dialog", { name: "マークシート" });
    await sheet
      .getByRole("group", { name: "券種" })
      .getByRole("button", { name: "2連単" })
      .click();
    await expect(sheet.locator(".ta-ms-row.is-unused").first()).toBeAttached();
    expect(await overflow(".ta-sheet")).toBeLessThanOrEqual(1);
    for (const b of await sheet
      .locator(".ta-bettype button, .ta-box-short button")
      .all())
      expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(44);

    // BOA-990 ②: 連複は段の見出しが「1艇目／順不同」の2行。見出しの文字が隣のマスにはみ出さず、6艇のマスは 44px 以上
    // BOA-990 ③: 拡連複も同じ段（2艇の組）
    for (const name of ["3連複", "2連複", "拡連複"]) {
      await sheet
        .getByRole("group", { name: "券種" })
        .getByRole("button", { name, exact: true })
        .click();
      await expect(sheet.locator(".ta-ms.is-unordered")).toBeVisible();
      expect(await overflow(".ta-sheet")).toBeLessThanOrEqual(1);
      // 見出しは「1艇目」「順不同」の2行まで（折り返して3行以上にならない。セルフレビュー #5）
      const heads = await sheet.locator(".ta-ms-h").evaluateAll((els) =>
        els
          .filter((e) => /艇目/.test(e.textContent))
          .map((e) => ({
            over: e.scrollWidth - e.clientWidth,
            h: e.getBoundingClientRect().height,
            fs: parseFloat(getComputedStyle(e).fontSize),
          })),
      );
      expect(heads.length).toBe(3);
      for (const d of heads) {
        expect(d.over).toBeLessThanOrEqual(1);
        expect(d.h).toBeLessThanOrEqual(d.fs * 2 * 1.8);
      }
      // マスは 44px 以上（4em の見出しで 375px が 41px になった。セルフレビュー #2）
      for (const b of await sheet
        .getByRole("button", { name: /艇目の候補に$/ })
        .all()) {
        const box = await b.boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
      }
    }
    // BOA-990 ③: 拡連複の配分の表（オッズの列が「1.9〜2.3」、見出し「払戻（下限）」）がシートの幅に収まる
    const wideTable = sheet.locator(".ta-table").last();
    await expect(
      wideTable.getByRole("columnheader", { name: "払戻（下限）" }),
    ).toBeVisible();
    const tBox = await wideTable.boundingBox();
    const sBox = await sheet.boundingBox();
    expect(tBox.x + tBox.width).toBeLessThanOrEqual(sBox.x + sBox.width + 1);
    await sheet.getByRole("button", { name: "閉じる" }).first().click();
    // 図の艇の行の候補のボタン「1艇目」も横にはみ出さない（最後に選んだ2連複のまま）
    await expect(
      page.getByRole("button", { name: "1号艇を1艇目の候補に" }),
    ).toBeVisible();
    const pos = await page
      .locator(".ta-pos3 button")
      .evaluateAll((els) => els.map((e) => e.scrollWidth - e.clientWidth));
    for (const d of pos) expect(d).toBeLessThanOrEqual(1);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(2);
  });
});
