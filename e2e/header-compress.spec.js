import { test, expect } from "./fixtures.js";

// ヘッダーの圧縮が閾値の付近で揺れ続けない（BOA-459）。
// ヘッダーは sticky で文書の流れの中にあり、圧縮で縮んだ分だけブラウザの
// スクロールアンカーが scrollY を戻す。閾値が1つだと、101〜122pxに止めたとき
// 圧縮と復帰が毎フレーム入れ替わり、下の要素が動き続けて E2E のクリックが
// 「element is not stable」のまま60秒で落ちていた（smoke の「条件別」タブ）
test.describe("ヘッダーの圧縮（BOA-459）", () => {
  test("圧縮の閾値の直後に止めても、ヘッダーとスクロール位置が揺れ続けない", async ({
    page,
  }) => {
    await page.goto("/race/2026-09-21-02-05");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
      timeout: 25000,
    });

    // 揺れていた帯（101〜122px）を端から端まで試す
    for (const y of [101, 110, 120]) {
      const toggles = await page.evaluate(async (y) => {
        const header = document.querySelector(".app-header");
        window.scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 300));
        window.scrollTo(0, y);
        // 状態が落ち着くまでの1回目の切り替えは許し、その後の切り替えを数える
        await new Promise((r) => setTimeout(r, 400));
        let last = header.classList.contains("compressed");
        let count = 0;
        const start = performance.now();
        while (performance.now() - start < 800) {
          await new Promise((r) => requestAnimationFrame(r));
          const now = header.classList.contains("compressed");
          if (now !== last) count++;
          last = now;
        }
        return count;
      }, y);
      expect(toggles, `scrollY=${y} でヘッダーが切り替わり続けた`).toBe(0);
    }

    // 圧縮と復帰そのものは今までどおり働く
    await page.evaluate(() => window.scrollTo(0, 400));
    await expect(page.locator(".app-header")).toHaveClass(/compressed/);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator(".app-header")).not.toHaveClass(/compressed/);
  });
});
