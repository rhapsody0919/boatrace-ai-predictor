// 旧 e2e/smoke.spec.js から切り出しスクリプトで移した（CI02。題・中身は元のまま、import の相対の字だけ1段深くした）
import { test, expect, applyCookieConsent, e2eTodayJST } from "../fixtures.js";
import {
  ANALYSIS_FIXED_RACE_ID,
  gotoAnalysisTabOnFixedDate,
} from "./helpers.js";

test.describe("データ分析ツール（BOA-150/151/152）", () => {

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
    await expect(async () => {
      await link.click();
      await expect(page).toHaveURL(/\/winning-technique\?/, { timeout: 5000 });
    }).toPass({ timeout: 30000 });
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
    await expect(async () => {
      await link.click();
      await expect(page).toHaveURL(/\/winning-technique\?/, { timeout: 5000 });
    }).toPass({ timeout: 30000 });
    await expect(page.locator(".motor-ranking-row").first()).toBeVisible({
      timeout: 10000,
    });
  });
});
