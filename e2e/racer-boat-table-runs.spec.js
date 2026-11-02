import { test, expect } from "./fixtures.js";

// BOA-1190 の1: 選手ページの「枠番別成績（全会場計）」の出走数の合計が、同じ画面の
// 「レース条件別の成績」の全体・レース一覧の走数と合わなかった（/racer/3941 で 218走と 232走）。
// 枠番別だけが日次の集計（racer_aggregated_stats.course_race_counts）を読み、race_results の
// course_1〜6 が空のレース（結果はあるのに進入の列が無い。本番で約4%）を数えていなかった。
// ほかの表と同じ出走履歴から数え、母数をそろえる
test.describe("選手ページの枠番別成績の走数（BOA-1190）", () => {
  test.slow();

  test("枠番別成績（全会場計）の出走数の合計が、条件別の全体・レース一覧の走数と一致する", async ({
    page,
  }) => {
    await page.goto("/racer/3941");
    // 条件別・レース一覧は出走履歴から作る。履歴が届いてから読む
    const cond = page.locator(".racer-cond-stats");
    await expect(cond).toBeVisible({ timeout: 60000 });
    const pager = page.locator(".racer-vc-pager span");
    await expect(pager).toBeVisible({ timeout: 60000 });

    const overall = Number(
      await cond.locator(".racer-cond-overall td").nth(1).textContent(),
    );
    const listTotal = Number(
      (await pager.textContent()).match(/全(\d+)走/)?.[1],
    );
    expect(overall).toBeGreaterThan(0);
    expect(listTotal).toBe(overall);

    const boatSec = page.locator(".racer-technique-profile", {
      hasText: "枠番別成績（当サイト集計",
    });
    await expect(boatSec).toBeVisible();
    const runs = (
      await boatSec.locator("tbody tr td:nth-child(2)").allTextContents()
    ).map(Number);
    // 5走未満の枠番は表に出さない。6枠とも出ているときだけ合計が全体と一致する
    expect(runs).toHaveLength(6);
    expect(runs.reduce((a, b) => a + b, 0)).toBe(overall);
  });
});
