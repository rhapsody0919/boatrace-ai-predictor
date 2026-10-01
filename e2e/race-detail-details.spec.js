import { test, expect } from "./fixtures.js";

// レース詳細の表示の細部（BOA-613・618・619）
const RACE = "/race/2026-09-29-16-12"; // 児島12R（ピットレポートあり）

test.describe("レース詳細の表示の細部", () => {
  test.slow();

  test("直前情報の展示タイム: 数値は13px、1号艇の白い棒に輪郭、ツールチップの項目名は「展示タイム」（BOA-613・618）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(RACE);
    await page.locator(".race-tabs-btn", { hasText: "直前情報" }).click();
    // 展示タイムの数値ラベル（6.58 等）を持つグラフ
    const timeLabel = page
      .locator(".recharts-label-list .recharts-label")
      .filter({ hasText: /^\d\.\d{2}$/ });
    const chart = page
      .locator(".recharts-wrapper")
      .filter({ has: timeLabel })
      .first();
    await expect(chart).toBeVisible({ timeout: 30000 });
    const label = chart.locator(".recharts-label-list .recharts-label").first();
    // Recharts は描画のアニメーション中にラベルを差し替えるため、落ち着くまで読み直す
    // （差し替え直後の要素では computed の font-size が空文字になり NaN になった）
    await expect
      .poll(async () =>
        Number.parseFloat(
          await label.evaluate((el) => getComputedStyle(el).fontSize),
        ),
      )
      .toBeGreaterThanOrEqual(13);
    const firstBar = chart.locator(".recharts-bar-rectangle path").first();
    expect(await firstBar.getAttribute("stroke")).not.toBe("none");
    await chart.scrollIntoViewIfNeeded();
    await firstBar.hover({ force: true });
    const tip = chart.locator(".recharts-tooltip-wrapper");
    await expect(tip).toContainText("展示タイム");
    await expect(tip).not.toContainText("lead");
  });

  test("基本情報の勝率バー: 最下位の艇も棒が空にならない（BOA-618）", async ({
    page,
  }) => {
    await page.goto(RACE);
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
      timeout: 30000,
    });
    const widths = await page
      .locator(".rbit-bar-fill")
      .evaluateAll((els) => els.map((el) => parseFloat(el.style.width)));
    expect(widths).toHaveLength(6);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(10);
  });

  test("ピットレポートの名前は全角スペースを1つの空白にまとめる（BOA-618）", async ({
    page,
  }) => {
    await page.goto(RACE);
    await page.locator(".race-tabs-btn", { hasText: "直前情報" }).click();
    const names = page.locator(".rpr-racer-name");
    await expect(names.first()).toBeVisible({ timeout: 30000 });
    const texts = await names.allTextContents();
    for (const n of texts) expect(n).not.toMatch(/　/);
  });

  test("1440・1920px: ST考察の6艇の列は等幅、枠別情報のカードの右端がそろう（BOA-619）", async ({
    page,
  }) => {
    for (const width of [1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/race/2026-09-25-01-07");
      await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();
      await page.locator(".rsc-card").waitFor({ timeout: 30000 });
      const cols = await page
        .locator(".rsc-grid thead th.rsc-boat-th")
        .evaluateAll((els) =>
          els.map((el) => el.getBoundingClientRect().width),
        );
      expect(cols).toHaveLength(6);
      expect(Math.max(...cols) - Math.min(...cols)).toBeLessThanOrEqual(2);
      if (width === 1920) {
        const w = await page
          .locator(".rsc-card")
          .evaluate((el) => el.getBoundingClientRect().width);
        expect(w).toBeLessThanOrEqual(1200);
      }
    }
  });
});
