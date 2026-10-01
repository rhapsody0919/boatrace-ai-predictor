import { test, expect } from "./fixtures.js";

// BOA-583: 選手ページのレース一覧・平均STカード・STの推移
test.describe("選手ページの表とグラフ（BOA-583）", () => {
  test.slow();

  test("1440px: レース一覧は決まり手・単勝配当まで横スクロール無しで見え、平均STカードは全会場の値だと分かる", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/racer/4069");
    const table = page.locator(".race-history-table").first();
    await expect(table).toBeVisible({ timeout: 30000 });
    // 以前はページの上限 800px で表示枠 734px、表 887px（決まり手・単勝配当が枠外）
    const m = await table.evaluate((el) => {
      const w = el.closest(".race-history-table-wrapper");
      return { sw: w.scrollWidth, cw: w.clientWidth };
    });
    expect(m.sw).toBeLessThanOrEqual(m.cw);
    // 平均STカードは絞り込みに連動しない日次集計の値（「桐生での平均ST」と読まれていた）
    await expect(page.locator(".racer-stat-card h3", { hasText: "平均ST" }).first()).toHaveText(
      "平均ST（全会場・全条件）",
    );
  });

  test("STの推移はフライングの走を赤い点で残し、ツールチップに会場とR番号を出す", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // 選手4069: 2026-06-17 宮島5R・2026-09-22 児島1R の2本がF
    await page.goto("/racer/4069");
    const chart = page.locator(".racer-stat-chart").filter({
      has: page.locator("h3", { hasText: "STの推移" }),
    });
    await expect(chart).toBeVisible({ timeout: 30000 });
    // フライングの印（赤い点）が2つ
    await expect(
      chart.locator('circle[fill="var(--color-error)"]'),
    ).toHaveCount(2);
    // ツールチップ: 日付だけでなく会場とR番号
    await chart.scrollIntoViewIfNeeded();
    const box = await chart.locator(".recharts-surface").boundingBox();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
    await expect(chart.locator(".recharts-tooltip-label")).toHaveText(
      /^\d{2}-\d{2}-\d{2} .+ \d{1,2}R$/,
    );
  });
});
