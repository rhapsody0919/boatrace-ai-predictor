import { test, expect } from "./fixtures.js";

// BOA-612 スマホ側: レース詳細のデータ出走表を画面の端まで広げ、6艇を横スクロール無しで並べる。
// 以前は 375px で表 380px が表示枠 301px に入らず、6号艇の列が画面外に出ていた
test.describe("レース詳細のデータ出走表（スマホ、BOA-612）", () => {
  for (const [width, tab] of [
    [375, "基本情報"],
    [375, "直前情報"],
    // 320px（iPhone SE 初代など）でも6号艇まで収まる（ファン評価1周目 P0）
    [320, "基本情報"],
    [320, "直前情報"],
  ]) {
    test(`${width}px: ${tab}タブの6艇の表は画面内に収まる（基本情報は名前が姓と名の2行）`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 812 });
      await page.goto("/race/2026-09-29-16-12");
      await page.locator(".race-tabs-btn", { hasText: tab }).first().click();
      const table = page.locator(".drt-table").first();
      await expect(table).toBeVisible({ timeout: 30000 });
      // データ（前走・機力など幅を取る行）が出そろってから測る。以前は読み込み前に測って、
      // 320px で はみ出しているのに通っていた（ファン評価1周目で発覚）
      await expect(table.locator(".drt-sub").first()).toBeVisible({
        timeout: 30000,
      });
      await page.waitForTimeout(1500);

      const m = await table.evaluate((el) => {
        const wrap = el.parentElement;
        const sixth = el.querySelector("thead tr:first-child th:last-child");
        return {
          sw: wrap.scrollWidth,
          cw: wrap.clientWidth,
          sixthRight: sixth.getBoundingClientRect().right,
          vw: window.innerWidth,
          pageOverflow:
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        };
      });
      // 表は枠に収まり（横スクロール無し）、6号艇の列が画面の中にある
      expect(m.sw).toBeLessThanOrEqual(m.cw);
      expect(m.sixthRight).toBeLessThanOrEqual(m.vw);
      expect(m.pageOverflow).toBe(0);

      // 直前情報の表には名前の行が無い（艇番の見出しだけ）
      if (tab !== "基本情報") return;
      // 名前は姓・名の2つの塊で、別の行に置かれ、どちらも途中で折れない（「西山貴／浩」にならない）
      const names = await page
        .locator(".drt-table")
        .first()
        .locator(".drt-name-th")
        .evaluateAll((ths) =>
          ths.map((th) => {
            const parts = [...th.querySelectorAll(".drt-name-part")];
            return {
              text: th.textContent,
              parts: parts.map((p) => ({
                chars: p.textContent.length,
                top: Math.round(p.getBoundingClientRect().top),
                lines: Math.round(
                  p.getBoundingClientRect().height /
                    parseFloat(getComputedStyle(p).lineHeight),
                ),
              })),
            };
          }),
        );
      expect(names).toHaveLength(6);
      for (const n of names) {
        expect(n.parts.length, n.text).toBe(2);
        expect(n.parts[1].top, n.text).toBeGreaterThan(n.parts[0].top);
        for (const p of n.parts.filter((x) => x.chars <= 3)) {
          expect(p.lines, n.text).toBe(1);
        }
      }
    });
  }
});
