import { test, expect } from "./fixtures.js";

/**
 * 選手ページの期別成績（公式）の勝率の折れ線の縦軸（BOA-1196）。
 * recharts の自動の目盛りだと 1 / 3 / 5 / 8 のように不等間隔になった（/racer/4998・5298）。
 * 縦軸の目盛りは整数で、1 刻みか 2 刻みの等間隔であること。
 */
for (const racerId of [4998, 5298, 3941]) {
  test(`/racer/${racerId} の勝率の折れ線は縦軸が整数の等間隔`, async ({
    page,
  }) => {
    await page.goto(`/racer/${racerId}`);
    const ticks = page.locator(
      ".racer-official-chart .recharts-cartesian-axis-tick-value",
      // 横軸の目盛りは「2019年後期」のような期の名前。縦軸は数字だけ
      { hasText: /^[\d.]+$/ },
    );
    await expect(ticks.first()).toBeAttached({ timeout: 30000 });
    const values = (await ticks.allTextContents()).map(Number);
    expect(values.length).toBeGreaterThanOrEqual(3);
    for (const v of values) expect(Number.isInteger(v)).toBe(true);
    const steps = new Set(values.slice(1).map((v, i) => v - values[i]));
    expect([...steps]).toHaveLength(1);
    expect([1, 2]).toContain([...steps][0]);
  });
}
