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
    // 行は値より先に出る。6本の棒に長さが付くまで読み直す（行だけを待つと、値の読み込み前に
    // 測ってしまう。CI で列見出しを読み込み前に測って落ちたのと同じ形）
    await expect
      .poll(
        async () => {
          const widths = await page
            .locator(".rbit-bar-fill")
            .evaluateAll((els) => els.map((el) => parseFloat(el.style.width)));
          return widths.length === 6 ? Math.min(...widths) : -1;
        },
        { timeout: 30000 },
      )
      .toBeGreaterThanOrEqual(10);
    // 長さは6艇の中の相対比較なので、差の大きさは数字で見るよう書き添える（ファン評価2周目 P1）
    await expect(page.locator(".rbit-relative-note")).toContainText(
      "この6艇の中での比較",
    );
  });

  test("基本情報の勝率バー: 1号艇（白）の棒の輪郭がライトモードの地と見分けられる（ファン評価1周目 P2）", async ({
    page,
  }) => {
    await page.goto(RACE);
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
      timeout: 30000,
    });
    // 棒（.rbit-bar-fill）は値の読み込みが終わってから描かれる。行だけを待つと、
    // CI で棒の無い時点で測って落ちた
    const firstRow = page.locator(".rbit-bar-row").first();
    await expect(firstRow.locator(".rbit-bar-fill")).toBeVisible({
      timeout: 30000,
    });
    const [shadow, track] = await firstRow.evaluate((row) => [
      getComputedStyle(row.querySelector(".rbit-bar-fill")).boxShadow,
      getComputedStyle(row.querySelector(".rbit-bar-track")).backgroundColor,
    ]);
    const rgb = (s) =>
      s
        .match(/\d+(\.\d+)?/g)
        .slice(0, 3)
        .map(Number);
    const lum = ([r, g, b]) => {
      const f = (c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const [a, b] = [lum(rgb(shadow)), lum(rgb(track))];
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    // 非テキストの図形のコントラストの目安（WCAG 1.4.11）は 3:1
    expect(ratio).toBeGreaterThanOrEqual(3);
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
      // カードの枠はデータより先に出る。6艇の列見出しがそろうまで待ってから測る
      // （枠だけを待っていたため、CI では列が0本の時点で測って落ちた）
      const heads = page.locator(".rsc-grid thead th.rsc-boat-th");
      await expect(heads).toHaveCount(6, { timeout: 30000 });
      const cols = await heads.evaluateAll((els) =>
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

  test("375px: ST考察の級別の行で、バッジの有無にかかわらず級別の高さがそろう（ファン評価2周目 P2）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    // 桐生7R: 5・6号艇は「F1 今節」で2段、4号艇はバッジなし
    await page.goto("/race/2026-09-25-01-07");
    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();
    const grades = page.locator(".rsc-grid .rsc-cell-meta .rsc-grade");
    await expect(grades).toHaveCount(6, { timeout: 30000 });
    await expect(page.locator(".rsc-grid .flying-badge-meet")).toHaveCount(2);
    const tops = await grades.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().top),
    );
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
  });
});
