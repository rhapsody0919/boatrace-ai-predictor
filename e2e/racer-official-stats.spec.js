import { test, expect } from "./fixtures.js";

/**
 * 選手ページの公式の成績（期別成績の推移・進入コース別成績）（GS00、2026-10-28）の固定。
 * 値の作り方は scripts/maintenance/verify-racer-official-period-stats.js が固定の入力で検証する。
 * ここでは画面に出ること、言ってはいけない言葉が無いこと、取得の失敗がエラー表示になることを見る。
 * 3941 池田浩二（A1、2019年後期から全期に出走）
 */

test("期別成績と進入コース別成績（公式）を出し、期の呼び名・注記を公式どおりにする", async ({
  page,
}) => {
  await page.goto("/racer/3941");
  const section = page.locator(".racer-official-stats");
  await expect(section.locator("h2")).toHaveText(
    "池田浩二の公式成績（期別・進入コース別）",
  );
  await expect(section).toContainText("期別成績（公式・");
  await expect(section).toContainText("年後期");
  await expect(section).toContainText("この期で決まった級");
  await expect(section).toContainText("進入コース別成績（公式・");
  // 進入コース別の表は6コース
  const courseTable = section.locator(".racer-official-table").last();
  await expect(courseTable.locator("tbody tr")).toHaveCount(6);
  // 推移に「調子」「通算」「年別」と言わない（data-scientist の言える範囲）
  for (const word of ["調子", "好調", "不調", "通算", "年別", "得意コース"]) {
    await expect(section).not.toContainText(word);
  }
});

test("勝率の折れ線は開いた時点で全期の点が出て、最後の点が最新の期の目盛りに重なる", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto("/racer/3941");
  const chart = page.locator(".racer-official-chart");
  // 目盛りの文字が出た直後に1回だけ測る（描く動きが終わるのを待たない）
  await chart
    .locator(".recharts-cartesian-axis-tick-value", { hasText: "期" })
    .last()
    .waitFor({ state: "attached" });
  // 描く動きがあると、開いた直後は点が出ていない・線が途中で止まって見える
  const measure = () =>
    chart.evaluate((el) => {
      const center = (n) => {
        const r = n.getBoundingClientRect();
        return r.x + r.width / 2;
      };
      const dots = [...el.querySelectorAll(".recharts-line-dot")].map(center);
      const lastTickLine = [
        ...el.querySelectorAll(
          ".recharts-xAxis .recharts-cartesian-axis-tick-line",
        ),
      ].at(-1);
      // 目盛りの文字は軸の線と別の層に描かれる。横軸の文字は「期」で終わるものだけ
      const lastTickValue = [
        ...el.querySelectorAll(".recharts-cartesian-axis-tick-value"),
      ]
        .filter((t) => t.textContent.endsWith("期"))
        .at(-1);
      // 線の見えている長さ。描く動きの途中は stroke-dasharray の1つ目が線の全長より短く、
      // 線が途中（例: 2023年後期の辺り）で止まって見える
      const path = el.querySelector(".recharts-line-curve");
      const dash = path?.getAttribute("stroke-dasharray");
      const visible = dash ? parseFloat(dash) : path.getTotalLength();
      return {
        dots,
        lastTickX: lastTickLine ? center(lastTickLine) : null,
        lastTickText: lastTickValue?.textContent ?? "",
        lineShownRatio: visible / path.getTotalLength(),
      };
    });
  const first = await measure();
  const rows = await page
    .locator(".racer-official-table")
    .first()
    .locator("tbody tr")
    .count();
  const hidden = await page
    .locator(".racer-official-more .racer-official-table tbody tr")
    .count();
  expect(first.dots.length).toBe(rows + hidden);
  expect(first.lineShownRatio).toBeGreaterThan(0.99);
  // 最新の期（表の先頭の行）の目盛りが右端にあり、最後の点と同じ位置
  const latestLabel = (
    await page
      .locator(".racer-official-table")
      .first()
      .locator("tbody tr th")
      .first()
      .innerText()
  ).split("\n")[0];
  expect(first.lastTickText).toBe(latestLabel);
  expect(Math.abs(first.dots.at(-1) - first.lastTickX)).toBeLessThan(2);
});

test("枠番別成績は当サイト集計と書き、進入コース別（公式）と分ける", async ({
  page,
}) => {
  await page.goto("/racer/3941");
  await expect(page.locator(".racer-performance-stats")).toContainText(
    "枠番別成績（当サイト集計・2025年12月以降・全会場計）",
  );
  await expect(page.locator(".racer-performance-stats")).not.toContainText(
    "前づけ）は現時点では区別できない",
  );
});

test("公式の期別成績の取得に失敗したらエラー表示を出す（「データなし」に化けさせない）", async ({
  page,
}) => {
  await page.route("**/rest/v1/racer_period_stats*", (route) => {
    // 期別成績の全期の取得（period_year で並べる問い合わせ）だけを落とす。平均ST の取得は通す
    if (route.request().url().includes("c1_entries")) return route.abort();
    return route.fallback();
  });
  await page.goto("/racer/3941");
  await expect(page.locator(".racer-profile-header h1")).toHaveText("池田浩二");
  await expect(page.locator(".inline-fetch-error").first()).toBeVisible();
  await expect(page.locator(".racer-official-stats")).toHaveCount(0);
});
