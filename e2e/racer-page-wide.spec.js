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

  test("1024px: レース名が長い選手でも、レース一覧は単勝配当まで枠に収まる（ファン評価1周目）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    // 選手5250: 全角英数字の長い節名（第２０回マンスリーＢＯＡＴＲＡＣＥ杯　男女Ｗ優勝戦）で 976/958 だった
    await page.goto("/racer/5250");
    const table = page.locator(".race-history-table").first();
    await expect(table).toBeVisible({ timeout: 30000 });
    const m = await table.evaluate((el) => {
      const w = el.closest(".race-history-table-wrapper");
      return { sw: w.scrollWidth, cw: w.clientWidth };
    });
    expect(m.sw).toBeLessThanOrEqual(m.cw);
  });

  test("フライングのSTは、直近10走・結果タブでも公式と同じ「F.01」（ファン評価1周目）", async ({
    page,
  }) => {
    // 2026-09-22 児島1R: 山本修一（4069）がF.01。以前は直近10走で「-」、結果タブで「F0.01」
    await page.goto("/race/2026-09-22-16-01");
    await page.locator(".race-tabs-btn", { hasText: "結果" }).click();
    await expect(
      page.locator(".rr-st-value", { hasText: /^F/ }).first(),
    ).toHaveText(/^F\.\d{2}$/, { timeout: 30000 });

    // 2026-09-30 浜名湖6R の基本情報 → 山本修一（2号艇）の直近10走に 9/22 児島1R の F が入る
    await page.goto("/race/2026-09-30-06-06");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await page.locator(".rbit-bar-row").nth(1).click();
    const row = page
      .locator(".race-history-table tr")
      .filter({ hasText: "2026-09-22" })
      .filter({ has: page.locator("td", { hasText: /^1R$/ }) })
      .first();
    await expect(row).toContainText("F.01", { timeout: 30000 });
  });

  test("同じ日に2走ある日でも、Fの点に乗せるとその走（会場・R・Fの深さ）が出る（ファン評価2周目）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // 選手3928: 2026-09-19 は戸田5R（0.12）と9R（F.04）の2走。以前は 9R の F の点で 5R が出た
    await page.goto("/racer/3928");
    const chart = page.locator(".racer-stat-chart").filter({
      has: page.locator("h3", { hasText: "STの推移" }),
    });
    await expect(chart).toBeVisible({ timeout: 30000 });
    await chart.scrollIntoViewIfNeeded();
    const dot = chart.locator('circle[fill="var(--color-error)"]').last();
    const box = await dot.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(chart.locator(".recharts-tooltip-label")).toHaveText(
      "26-09-19 戸田 9R",
    );
    await expect(chart.locator(".recharts-tooltip-wrapper")).toContainText(
      "F.04",
    );
  });

  test("375px: 推移グラフは直近50走に絞り、そのことを書く（ファン評価2周目）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/racer/4069");
    const chart = page.locator(".racer-stat-chart").filter({
      has: page.locator("h3", { hasText: "STの推移" }),
    });
    await expect(chart).toBeVisible({ timeout: 30000 });
    await expect(chart).toContainText("直近50走");
    const dots = await chart
      .locator(".recharts-line-dots")
      .first()
      .locator("circle")
      .count();
    expect(dots).toBeLessThanOrEqual(50);
  });
});
