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
