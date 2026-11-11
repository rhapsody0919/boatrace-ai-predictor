// 旧 e2e/smoke.spec.js から切り出しスクリプトで移した（CI02。題・中身は元のまま、import の相対の字だけ1段深くした）
import { test, expect, e2eTodayJST, fetchRecorded } from "../fixtures.js";
import { HIT_RACES_FIXED_DATE } from "../layout/helpers.js";
import { gotoAnalysisTabOnFixedDate } from "./helpers.js";

/**
 * 分析ツールが読む「今日」の races（開催会場・本日のレース・好調/不調ランキングの出走表）を、
 * 生成済みの固定の過去日に向け直す。0:00〜7:00 JST は当日の行が無く、表が出ない（BOA-1458）。
 * ほかの日付の要求はそのまま通す。route.fetch() は録画を通らないため fetchRecorded を使う（ADR-0077）
 */
async function serveFixedTodaysRaces(page) {
  const todayJst = e2eTodayJST();
  await page.route(/\/rest\/v1\/races\?.*race_date=eq\./, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("race_date") !== `eq.${todayJst}`) {
      await route.fallback();
      return;
    }
    url.searchParams.set("race_date", `eq.${HIT_RACES_FIXED_DATE}`);
    const response = await fetchRecorded(route, { url: url.toString() });
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      body: await response.body(),
    });
  });
}

test.describe("データ分析ツール（BOA-150/151/152）", () => {
  test("ハンバーガーメニューからデータ分析ツールへ遷移できる", async ({
    page,
  }) => {
    // ブラウザのロケール検出でenへリダイレクトされるのを防ぎ、jaを固定する
    await page.addInitScript(() =>
      localStorage.setItem("boatai-language", "ja"),
    );
    await page.goto("/");
    await page.click(".menu-btn");
    const link = page.locator('a.submenu-item:has-text("データ分析ツール")');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/winning-technique");
    await link.click();
    await expect(page).toHaveURL(/\/winning-technique$/);
  });

  test("/winning-technique が表示される（データ未投入でも空状態を表示）", async ({
    page,
  }) => {
    await page.goto("/winning-technique");
    await expect(page.locator(".app-header")).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: /データ分析ツール/ }),
    ).toBeVisible();
  });

  test("出目分布タブが表示される（BOA-152: 旧/outcome-distributionを統合）", async ({
    page,
  }) => {
    await page.goto("/winning-technique");
    await page.click('.analysis-tab-btn:has-text("出目分布")');
    await expect(page.locator(".outcome-distribution-container")).toBeVisible({
      timeout: 10000,
    });
  });

  test("旧/outcome-distributionは会場指定を保ったままデータ分析ツールへリダイレクトされる（BOA-152）", async ({
    page,
  }) => {
    await page.goto("/outcome-distribution?venue_code=4");
    await expect(page).toHaveURL(
      /\/winning-technique\?venue_code=4&tab=outcome/,
    );
    await expect(
      page.locator('.analysis-tab-btn:has-text("出目分布")'),
    ).toHaveClass(/active/);
    await expect(page.locator(".outcome-distribution-container")).toBeVisible({
      timeout: 10000,
    });
  });

  test("モーター調子タブで本日のレースの枠番別モーター調子→クリックで推移グラフに切り替わる（BOA-151）", async ({
    page,
  }) => {
    await serveFixedTodaysRaces(page);
    await page.goto("/winning-technique");
    await page.click('.analysis-tab-btn:has-text("モーター調子")');
    const breakdown = page.locator(".motor-ranking-row");
    await expect(breakdown.first()).toBeVisible({ timeout: 10000 });
    await expect(breakdown).toHaveCount(6); // 6艇分
    await breakdown.first().click();
    await expect(page.locator(".back-to-ranking-btn")).toBeVisible();
    // BOA-265で展示タイム推移・使用履歴グラフが追加され2連率/3連率グラフと合わせて
    // 最大3つになりうるが、使用履歴・展示タイムは実データの有無で0〜2個の幅がある
    // ため、固定数ではなく「最低限2連率/3連率グラフは出る」の下限のみ検証する
    await expect(async () => {
      expect(
        await page.locator(".recharts-wrapper").count(),
      ).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 10000 });
  });

  test("選手調子タブで本日のレースの枠番別勝率変化→クリックで推移グラフに切り替わる（BOA-152）", async ({
    page,
  }) => {
    await serveFixedTodaysRaces(page);
    await page.goto("/winning-technique");
    await page.click('.analysis-tab-btn:has-text("選手調子")');
    const rows = page.locator(".motor-ranking-row");
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    await expect(rows).toHaveCount(6);
    await rows.first().click();
    await expect(page.locator(".back-to-ranking-btn")).toBeVisible();
    await expect(page.locator(".recharts-wrapper")).toBeVisible({
      timeout: 10000,
    });
  });

  test("STのズレタブで本日のレースの枠番別ズレ実績→クリックで推移グラフに切り替わる（BOA-153）", async ({
    page,
  }) => {
    await serveFixedTodaysRaces(page);
    await page.goto("/winning-technique");
    await page.click('.analysis-tab-btn:has-text("STのズレ")');
    const rows = page.locator(".motor-ranking-row");
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    await expect(rows).toHaveCount(6);
    // 過去のズレの件数（最後の列）が1件以上の選手を開く。先頭の艇がデビュー直後の選手だと、
    // 過去90日の走が無く推移は空（「推移データが見つかりません」）で正しい。先頭を決め打ちすると、
    // 撮影日の1Rの1号艇しだいで落ちる（2026-10-25 の撮り直し: 桐生1R 1号艇 5306 が件数0）
    const sampleCounts = await rows.evaluateAll((trs) =>
      trs.map((tr) =>
        tr.classList.contains("non-clickable-row")
          ? 0
          : Number(tr.lastElementChild?.textContent ?? "0"),
      ),
    );
    const target = sampleCounts.findIndex((n) => n > 0);
    // 6艇とも0件は、ST・展示の取得か集計が止まった疑いが強い。skip で隠さず落とす
    expect(
      target,
      `6艇とも過去のズレの件数が0件: ${sampleCounts}`,
    ).toBeGreaterThanOrEqual(0);
    await rows.nth(target).click();
    await expect(page.locator(".back-to-ranking-btn")).toBeVisible();
    await expect(page.locator(".recharts-wrapper")).toBeVisible({
      timeout: 10000,
    });
  });

  test("トップスタートタブが表示される（BOA-154: データ未投入でも空状態を表示）", async ({
    page,
  }) => {
    await page.goto("/winning-technique");
    await page.click('.analysis-tab-btn:has-text("トップスタート")');
    await expect(page.locator(".winning-technique-container")).toBeVisible({
      timeout: 10000,
    });
    // マイグレーション未適用の場合は空状態、適用済みならテーブルが表示される
    await expect(
      page.locator(".empty-state, .winning-technique-table"),
    ).toBeVisible({ timeout: 10000 });
  });

  test("負け決まり手タブが表示される（BOA-157: データ未投入でも空状態を表示）", async ({
    page,
  }) => {
    await page.goto("/winning-technique");
    await page.click('.analysis-tab-btn:has-text("負け決まり手")');
    await expect(page.locator(".winning-technique-container")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.locator(".empty-state, .winning-technique-table"),
    ).toBeVisible({ timeout: 10000 });
  });

  test("逃げ成功時分布タブが表示される（BOA-158: データ未投入でも空状態を表示）", async ({
    page,
  }) => {
    await page.goto("/winning-technique");
    await page.click('.analysis-tab-btn:has-text("逃げ成功時分布")');
    await expect(page.locator(".outcome-distribution-container")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator(".empty-state, .top-patterns-table")).toBeVisible(
      { timeout: 10000 },
    );
  });

  test("展示タイムタブが表示される（BOA-160: データ未投入でも空状態を表示）", async ({
    page,
  }) => {
    await page.goto("/winning-technique");
    await page.click('.analysis-tab-btn:text-is("⏲️ 展示タイム")');
    await expect(page.locator(".winning-technique-container")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.locator(".empty-state, .winning-technique-table"),
    ).toBeVisible({ timeout: 10000 });
  });

  test("選手別展示タイム推移タブで固定の過去レースの推移一覧→クリックで推移グラフに切り替わる（BOA-164、固定日の技法はBOA-664）", async ({
    page,
  }) => {
    await gotoAnalysisTabOnFixedDate(page, "extrend");
    await expect(page.locator(".motor-condition-container")).toBeVisible({
      timeout: 10000,
    });
    // 固定の過去レースのため6艇分の行が必ず出る（空状態を許容しない。BOA-664）
    const rows = page.locator(".motor-ranking-row");
    await expect(rows.first()).toBeVisible({ timeout: 15000 });
    await expect(rows).toHaveCount(6);

    // 90日平均（4列目）が出ている選手を選ぶ。平均は推移と同じ直近90日の展示タイムから
    // 出すため、平均があれば推移グラフは必ず描ける（新人等で平均が無い選手は空状態になる）
    const rowWithAvg = page
      .locator(".motor-ranking-row:not(.non-clickable-row)")
      .filter({
        has: page.locator("td:nth-child(4)", { hasText: /^\d+\.\d{2}$/ }),
      })
      .first();
    await expect(rowWithAvg).toBeVisible();
    await rowWithAvg.click();
    // 見出し（.selected-motor-heading）はクリック直後の1回の描画で一瞬出て、推移の取得中
    // （.loading-state）は消える。見出しだけで終えると推移の要求が録画に入らず、strict
    // 再生で落ちる（BOA-594）。取得が終わってからしか描かれない推移の点まで待つ
    await expect(
      page.locator(".motor-condition-container .recharts-line-dot").first(),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".loading-state")).toHaveCount(0);
    await expect(page.locator(".selected-motor-heading")).toBeVisible();
  });
});
