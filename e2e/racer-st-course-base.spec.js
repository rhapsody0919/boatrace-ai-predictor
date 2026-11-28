import { test, expect } from "./fixtures.js";

// 選手ページの ST の推移に、今の級×同じ進入コースの全国平均を破線で重ね、右端に級と値の札、図の上に凡例の2行目を出す
// （分割の3つ目、オーナー 2026-11-27 ファン4人の議論の推奨）
test.describe("選手ページの ST の推移の級×同コースの破線", () => {
  test.slow();

  test("375px: ST の図に破線と「同コース」の札が出て、凡例は点線と破線の2行", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto("/racer/4069");
    const st = page.locator(".racer-stat-chart").filter({
      has: page.locator("h3", { hasText: "STの推移" }),
    });
    await expect(st).toBeVisible({ timeout: 30000 });
    await expect(st.locator(".racer-run-line-base")).toHaveCount(1);
    await expect(st.locator(".racer-run-line-avg")).toHaveCount(1);
    await expect(
      st.locator(".racer-run-label", { hasText: "同コース" }),
    ).toHaveCount(1);
    await expect(st.locator(".racer-run-label").first()).toBeVisible();
    await expect(st.locator(".racer-stat-note-base")).toHaveText(
      /^破線は(A1|A2|B1|B2)の同コースの全国平均$/,
    );
    // 札の値と凡例の級がそろう
    const grade = (await st.locator(".racer-stat-note-base").textContent()).match(
      /(A1|A2|B1|B2)/,
    )[1];
    await expect(
      st.locator(".racer-run-label", { hasText: "同コース" }),
    ).toContainText(new RegExp(`${grade} 0\\.\\d{3}`));
    // 展示の図には破線を出さない（展示の比べる線は別の PR）
    const ex = page.locator(".racer-stat-chart").filter({
      has: page.locator("h3", { hasText: "展示タイムの推移" }),
    });
    await expect(ex.locator(".racer-run-line-base")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
});
