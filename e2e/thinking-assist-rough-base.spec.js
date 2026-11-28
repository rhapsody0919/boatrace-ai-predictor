import { test, expect } from "./fixtures.js";
import {
  THINKING_ASSIST_RACE,
  routeThinkingAssistV16,
} from "./thinking-assist-fixture.js";

/**
 * 思考アシスト「堅い？荒れる？」の2本の棒の数字は「63%（全国55%）」の形（2026-11-28 オーナー決定、plan.md §14）。
 *   - ↑↓→ の矢印と、矢印の凡例「↑↓＝全国の全レースより高め・低め」を出さない
 *   - 点線の下に「全国」の名前を置き、次の行に重ならない
 * 例のレースは thinking-assist-fixture.js の固定データ（2026-10-06 徳山10R）
 */

const URL_ = `/race/${THINKING_ASSIST_RACE}/assist`;

test.describe("堅い？荒れる？の数字は値と括弧の全国（2026-11-28）", () => {
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page);
  });

  test("数字は「n%（全国n%）」で、矢印と矢印の凡例が無い", async ({ page }) => {
    await page.goto(URL_);
    const card = page.locator(".ta-rough");
    const nums = card.locator(".baseline-bar-num");
    await expect(nums).toHaveCount(2, { timeout: 30000 });
    for (const num of await nums.all()) {
      await expect(num).toHaveText(/^\d+%\s*（全国\d+%）$/);
    }
    await expect(card).not.toContainText(/[↑↓→]/);
    await expect(card).not.toContainText("高め・低め");
  });

  test("点線の下に「全国」があり、棒の行の中に収まる", async ({ page }) => {
    await page.goto(URL_);
    const labels = page.locator(".ta-rough .baseline-bar-base-label");
    await expect(labels).toHaveCount(2, { timeout: 30000 });
    await expect(labels.first()).toHaveText("全国");
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll(".ta-rough .baseline-bar")].map((bar) => {
        const r = bar.getBoundingClientRect();
        const l = bar
          .querySelector(".baseline-bar-base-label")
          .getBoundingClientRect();
        return { barBottom: r.bottom, labelBottom: l.bottom, h: l.height };
      }),
    );
    for (const b of boxes) {
      expect(b.h).toBeGreaterThan(0);
      expect(b.labelBottom).toBeLessThanOrEqual(b.barBottom + 1);
    }
  });
});
