import { test, expect, applyCookieConsent, e2eTodayJST } from "../fixtures.js";
import {
  ANALYSIS_FIXED_RACE_ID,
  gotoAnalysisTabOnFixedDate,
} from "./helpers.js";

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

  // BOA-744: 録画fixtureの時計を使わず、実時刻＋合成応答で一覧外リンクを再現する。
  for (const tab of ["techprofile", "returnrate"]) {
    test(`${tab} のディープリンクは当日一覧にない会場・レースも保持する（BOA-744）`, async ({
      browser,
      baseURL,
    }) => {
      const context = await browser.newContext({ baseURL });
      try {
        await applyCookieConsent(context);
        const page = await context.newPage();
        const requests = [];
        const today = new Date(Date.now() + 9 * 3600000)
          .toISOString()
          .slice(0, 10);
        const otherRace = `${today}-01-01`;
        const rows = Array.from({ length: 6 }, (_, i) => ({
          boat_number: i + 1,
          racer_id: 4000 + i,
          player_name: `リンク先選手${i + 1}`,
          win_count: 1,
          techniques: [{ technique: "逃げ", percentage: 100 }],
          sample_count: 10,
          win_return_rate: 100,
          place_return_rate: 100,
        }));
        let releaseVenues;
        const venuesReady = new Promise((resolve) => {
          releaseVenues = resolve;
        });
        await context.route("**/*", async (route) => {
          const url = new URL(route.request().url());
          if (url.pathname.includes("/rest/v1/")) {
            let data = [];
            if (url.pathname.endsWith("/races")) {
              if (url.searchParams.get("select") === "venue_code") {
                await venuesReady;
                data = [{ venue_code: 1 }]; // 戸田を含めない
              } else {
                data =
                  url.searchParams.get("venue_code") === "eq.1"
                    ? [
                        {
                          race_id: otherRace,
                          race_number: 1,
                          start_time: "12:00",
                        },
                      ]
                    : [];
              }
            } else if (url.pathname.includes("/rpc/get_race_")) {
              const id = route.request().postDataJSON()?.p_race_id;
              requests.push(id);
              data = id === ANALYSIS_FIXED_RACE_ID ? rows : [];
            }
            return route.fulfill({ json: data });
          }
          if (url.pathname.startsWith("/api/"))
            return route.fulfill({ json: [] });
          if (url.origin !== new URL(baseURL).origin) return route.abort();
          return route.fallback();
        });
        const targetRequest = page.waitForRequest(
          (request) =>
            request
              .url()
              .includes(
                `/rpc/${tab === "techprofile" ? "get_race_technique_profile" : "get_race_return_rate"}`,
              ) && request.postDataJSON()?.p_race_id === ANALYSIS_FIXED_RACE_ID,
        );
        await page.goto(
          `/winning-technique?tab=${tab}&venue_code=2&race_id=${ANALYSIS_FIXED_RACE_ID}`,
        );
        await targetRequest; // RPCのレースIDはURLではなくPOST本文に入る
        releaseVenues();
        await expect(
          page.locator(".controls-section select").first().locator("option"),
        ).toHaveCount(1);
        await expect(page.locator(".controls-section select")).toHaveCount(1);
        // 一覧の適用後まで待つ。初回の正しい取得だけで修正前を通さない。
        await page.waitForTimeout(300);
        expect(requests.length).toBeGreaterThan(0);
        expect(requests.every((id) => id === ANALYSIS_FIXED_RACE_ID)).toBe(
          true,
        );
        await expect(page.locator(".motor-ranking-row")).toHaveCount(6);
        await expect(page.locator(".motor-ranking-row").first()).toContainText(
          "リンク先選手1",
        );
      } finally {
        await context.close();
      }
    });
  }

  test("選手別決まり手傾向タブで固定の過去レースの内訳が表示される（BOA-165、固定日の技法はBOA-664）", async ({
    page,
  }) => {
    await gotoAnalysisTabOnFixedDate(page, "techprofile");
    await expect(page.locator(".motor-condition-container")).toBeVisible({
      timeout: 10000,
    });
    // 固定の過去レースのため6艇分の行が必ず出る（空状態を許容しない。BOA-664）
    const rows = page.locator(".motor-ranking-row");
    await expect(rows.first()).toBeVisible({ timeout: 15000 });
    await expect(rows).toHaveCount(6);
  });

  test("本日の好調・不調選手ランキングタブで固定日の実データが表示される（BOA-166、固定日の技法はBOA-664）", async ({
    page,
  }) => {
    // venue_code/race_id を受け付けないタブのため、時計だけを固定の過去日に合わせる
    await gotoAnalysisTabOnFixedDate(page, "formranking", {
      withRace: false,
    });
    await expect(page.locator(".motor-condition-container")).toBeVisible({
      timeout: 10000,
    });
    // 固定日は550人超の選手に当時・90日前時点の両方の全国勝率があり、急上昇/急下降
    // どちらのランキングにも実データが出る（空状態を許容しない。BOA-664）
    const rows = page.locator(".motor-ranking-row");
    await expect(rows.first()).toBeVisible({ timeout: 15000 });
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test("選手×艇番別 回収率分析タブで固定の過去レースの実データが表示される（BOA-167、固定日の技法はBOA-664）", async ({
    page,
  }) => {
    await gotoAnalysisTabOnFixedDate(page, "returnrate");
    await expect(page.locator(".motor-condition-container")).toBeVisible({
      timeout: 10000,
    });
    // 固定の過去レースのため6艇分の行が必ず出る（空状態を許容しない。BOA-664）
    const rows = page.locator(".motor-ranking-row");
    await expect(rows.first()).toBeVisible({ timeout: 15000 });
    await expect(rows).toHaveCount(6);
  });

  test("会場ランキングタブで固定日の実データが表示される（BOA-171/BOA-267、固定日の技法はBOA-664）", async ({
    page,
  }) => {
    // venue_code/race_id を受け付けないタブのため、時計だけを固定の過去日に合わせる。
    // 固定日は24会場中15会場・180レース全てが結果確定済み（配当データ込み）のため
    // 本日限定の4指標・直近90日の1号艇勝率とも実データが出る（空状態を許容しない。BOA-664）
    await gotoAnalysisTabOnFixedDate(page, "venueranking", {
      withRace: false,
    });
    await expect(page.locator(".motor-condition-container")).toBeVisible({
      timeout: 10000,
    });
    const rows = page.locator(".motor-ranking-row");
    await expect(rows.first()).toBeVisible({ timeout: 30000 });
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test("会場×グレード分析タブが表示される（BOA-263）", async ({ page }) => {
    await page.goto("/winning-technique");
    await page.click('.analysis-tab-btn:text-is("📊 会場×グレード分析")');
    await expect(page.locator(".motor-condition-container")).toBeVisible({
      timeout: 10000,
    });
    // 会場・指標のセレクタが表示される
    await expect(page.locator("#venue-grade-venue-select")).toBeVisible();
    await expect(page.locator("#venue-grade-metric-select")).toBeVisible();
    // venue_grade_boat_stats未集計（マイグレーション未適用）の環境では
    // エラー状態になる（getVenueGradeBoatStatsはエラーを握りつぶさずthrowする
    // 設計のため）。マイグレーション適用後は空状態またはデータ表示になるため、
    // いずれの環境でも通るよう3状態を許容する
    await expect(
      page.locator(".empty-state, .motor-ranking-table, .error-state").first(),
    ).toBeVisible({ timeout: 15000 });
    // 指標を切り替えてもクラッシュしない
    await page.selectOption("#venue-grade-metric-select", "manshuRate");
    await expect(
      page.locator(".empty-state, .motor-ranking-table, .error-state").first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test("会場・レース・タブ指定のディープリンクで直接開ける（BOA-152）", async ({
    page,
  }) => {
    await page.goto(
      "/winning-technique?venue_code=4&race_id=2026-07-30-04-01&tab=racer",
    );
    await expect(
      page.locator('.analysis-tab-btn:has-text("選手調子")'),
    ).toHaveClass(/active/);
    await expect(page.locator(".motor-ranking-row").first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("トップページ（開催場一覧）からデータ分析ツールへの導線がある（BOA-152）", async ({
    page,
  }) => {
    // venue-list-redesign: / は開催場一覧 → 会場別レース一覧 → /race/:raceId の3階層
    await page.goto("/");
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();
    await expect(page).toHaveURL(/\/race\//);
    const link = page.locator(".analysis-tools-link");
    await expect(link).toBeVisible({ timeout: 10000 });
    await link.click();
    await expect(page).toHaveURL(/\/winning-technique\?/);
    await expect(page.locator(".motor-ranking-row").first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("過去アーカイブ（/races/）にはデータ分析ツールへの導線が無い（本日開催中の会場のみ対応のため）", async ({
    page,
  }) => {
    await page.goto("/races/2026-07-13");
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();
    await expect(page).toHaveURL(/\/race\//);
    // 結果確定済みレースは「結果」タブがデフォルト表示され、データ出走表は
    // 結果タブ表示中は隠れる（フィードバック#7）ため、基本情報タブへ切り替える
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator(".analysis-tools-link-section")).toHaveCount(0);
  });

  test("/races/{本日}には導線がある（本日開催中のレースのため機能する）", async ({
    page,
  }) => {
    const today = e2eTodayJST();
    await page.goto(`/races/${today}`);
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();
    const link = page.locator(".analysis-tools-link");
    await expect(link).toBeVisible({ timeout: 10000 });
    await link.click();
    await expect(page).toHaveURL(/\/winning-technique\?/);
    await expect(page.locator(".motor-ranking-row").first()).toBeVisible({
      timeout: 10000,
    });
  });
});
