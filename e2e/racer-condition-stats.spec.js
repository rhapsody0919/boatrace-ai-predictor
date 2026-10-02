import { test, expect } from "./fixtures.js";

// BOA-336: 選手ページ「レース条件別の成績」
test.describe("選手ページのレース条件別の成績（BOA-336）", () => {
  test.slow();

  test("天候・風速・波高の行と全体との差を出し、375pxで表が枠に収まる", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto("/racer/4320");
    const sec = page.locator(".racer-cond-stats");
    await expect(sec).toBeVisible({ timeout: 30000 });
    await expect(sec.locator("h3")).toHaveText("レース条件別の成績");

    // 小見出しは天候・風速・波高の順。行の名前は承認済みのモックどおり
    await expect(sec.locator(".racer-cond-group td")).toHaveText([
      "天候",
      "風速",
      "波高",
    ]);
    const labels = await sec
      .locator("tbody tr:not(.racer-cond-group) td:first-child")
      .allTextContents();
    expect(labels[0]).toBe("全体");
    for (const label of labels.slice(1)) {
      expect([
        "晴",
        "曇り",
        "雨・雪・台風",
        "風5m以上",
        "風5m未満",
        "波5cm以上",
        "波5cm未満",
      ]).toContain(label);
    }

    // 全体の行には差を出さず、条件の行には全体との差（pt）を出す
    await expect(
      sec.locator(".racer-cond-overall .racer-cond-diff"),
    ).toHaveCount(0);
    await expect(sec.locator(".racer-cond-diff").first()).toHaveText(
      /^(↑\+|↓−|±)\d+\.\d$/,
    );

    // 5走未満の条件は出さない
    const runs = await sec
      .locator(
        "tbody tr:not(.racer-cond-group):not(.racer-cond-overall) td:nth-child(2)",
      )
      .allTextContents();
    for (const n of runs) expect(Number(n)).toBeGreaterThanOrEqual(5);

    // 375pxで表がはみ出さない（条件名を1行に保ったうえで）
    const m = await sec
      .locator(".table-wrapper")
      .evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    expect(m.sw).toBeLessThanOrEqual(m.cw);
  });
});
