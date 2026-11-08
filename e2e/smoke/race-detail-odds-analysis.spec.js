import {
  test,
  expect,
  applyCookieConsent,
  fetchRecorded,
} from "../fixtures.js";
import {
  ANALYSIS_FIXED_RACE_ID,
  gotoAnalysisTabOnFixedDate,
} from "./helpers.js";

test.describe("レースページ再設計（BOA-168）", () => {
  test("オッズ一覧タブで券種切替・全通り常時表示・推移ドリルダウン・免責文言が表示される（BOA-311）", async ({
    page,
  }) => {
    // 全窓（60/30/15/10/5/0分前）で全券種の全通りオッズが保存された過去レース
    // （FR-4、ADR-0057稼働後の2026-09-18戸田8R）を固定で使う
    await page.goto("/race/2026-09-18-02-08");
    await page.locator(".race-tabs-btn", { hasText: "オッズ一覧" }).click({
      timeout: 20000,
    });

    // 3連単（初期表示）: 1着ごとの6ブロックに全120通りがタップ不要で並ぶ（日和と同じ構造）
    await expect(page.locator(".rol-block")).toHaveCount(6, {
      timeout: 20000,
    });
    await expect(page.locator(".rol-block .rol-odds")).toHaveCount(120);
    await expect(page.locator(".rol-disclaimer")).toContainText("主催者");

    // オッズ一覧タブ専用の内容のため、基本情報系のデータ出走表・枠別傾向・
    // 分析ツールアコーディオンは隠れる（モータ情報タブと同じ方針の再発防止）
    await expect(page.locator(".data-race-table")).toHaveCount(0);
    await expect(page.locator(".venue-tendency-panel")).toHaveCount(0);
    await expect(page.locator(".embedded-analysis-section")).toHaveCount(0);

    // 3連単: オッズをタップするとそのブロックの行の直後に推移が表示され、再タップで閉じる
    await page.locator(".rol-odds[class*='rol-heat-']").first().click();
    await expect(page.locator(".rol-trend")).toBeVisible();
    await expect(page.locator(".rol-trend-item").first()).toBeVisible();
    await page.locator(".rol-odds.is-selected").click();
    await expect(page.locator(".rol-trend")).toHaveCount(0);

    // 3連複: 艇番3つの全20通りが一覧で表示される
    await page.locator(".rol-chip", { hasText: "3連複" }).click();
    await expect(page.locator(".rol-two-col-grid > .rol-odds")).toHaveCount(20);
    // 推移パネルは選択した行（1行目。列数は画面幅で2〜4列）の直後に全幅で出る。DOM では選択した要素の直後に
    // 置き、grid-auto-flow: dense で同じ行の残りが前に詰まる（BOA-530）ため、見た目の位置で確かめる
    const trioCells = page.locator(".rol-two-col-grid > .rol-odds");
    await trioCells.first().click();
    await expect(page.locator(".rol-two-col-grid > .rol-trend")).toBeVisible();
    const placement = await page
      .locator(".rol-two-col-grid")
      .evaluate((grid) => {
        const cells = [...grid.querySelectorAll(":scope > .rol-odds")].map(
          (c) => c.getBoundingClientRect(),
        );
        const trend = grid
          .querySelector(":scope > .rol-trend")
          .getBoundingClientRect();
        const firstRow = cells.filter((c) => c.top === cells[0].top);
        const rest = cells.filter((c) => c.top !== cells[0].top);
        return {
          firstRowAbove: firstRow.every((c) => c.bottom <= trend.top),
          restBelow: rest.every((c) => c.top >= trend.bottom),
          firstRowCount: firstRow.length,
        };
      });
    expect(placement.firstRowCount).toBeGreaterThanOrEqual(2);
    expect(placement.firstRowAbove).toBe(true);
    expect(placement.restBelow).toBe(true);

    // 2連単: 1着ごとの6ブロック（全30通り）。タップで推移が表示される
    await page.locator(".rol-chip", { hasText: "2連単" }).click();
    await expect(page.locator(".rol-block")).toHaveCount(6);
    await expect(page.locator(".rol-block .rol-odds")).toHaveCount(30);
    await page.locator(".rol-odds[class*='rol-heat-']").first().click();
    await expect(page.locator(".rol-trend")).toBeVisible();

    // 2連複: 小さい艇番ごとの5ブロック（全15通り、最大艇番のブロックは作らない）
    await page.locator(".rol-chip", { hasText: "2連複" }).click();
    await expect(page.locator(".rol-block")).toHaveCount(5);
    await expect(page.locator(".rol-block .rol-odds")).toHaveCount(15);

    // 拡連複（レンジ値）: 推移スパークラインがNaNにならず描画される
    await page.locator(".rol-chip", { hasText: "拡連複" }).click();
    await page.locator(".rol-odds[class*='rol-heat-']").first().click();
    const points = await page
      .locator(".rol-sparkline polyline")
      .getAttribute("points");
    expect(points).not.toContain("NaN");

    // 基本情報タブへ戻ればデータ出走表が再表示される（上の非表示検証が空振りでないことの裏付け）
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 15000,
    });
  });

  for (const [tab, selector] of [
    ["attackdefense", ".ad-section"],
    ["racecard", ".rcd-table"],
  ]) {
    test(`${tab} のディープリンクは当日一覧にない過去レースを維持する（BOA-744）`, async ({
      browser,
    }, testInfo) => {
      // 通常fixtureの録画時計を使わない。通信は録画だけで返し、外部へ出さない。
      const context = await browser.newContext({
        baseURL: testInfo.project.use.baseURL,
      });
      await applyCookieConsent(context, "rejected");
      const page = await context.newPage();
      const dataRequests = [];
      let venueLists = 0;
      const raceListVenues = [];
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (
          url.pathname === "/rest/v1/races" &&
          url.searchParams.has("race_date")
        ) {
          const venuesOnly = url.searchParams.get("select") === "venue_code";
          if (venuesOnly) venueLists++;
          else raceListVenues.push(url.searchParams.get("venue_code"));
          // 戸田も対象レースも無い一覧。空一覧による偽陽性を避ける。
          return route.fulfill({ json: venuesOnly ? [{ venue_code: 1 }] : [] });
        }
        if (
          url.pathname.startsWith("/rest/v1/") ||
          url.pathname.startsWith("/api/")
        ) {
          dataRequests.push(decodeURIComponent(url.href));
          const response = await fetchRecorded(route);
          return route.fulfill({
            status: response.status(),
            headers: response.headers(),
            body: await response.body(),
          });
        }
        if (url.origin === new URL(testInfo.project.use.baseURL).origin)
          return route.fallback();
        return route.abort();
      });
      try {
        const request = page.waitForRequest((r) =>
          decodeURIComponent(r.url()).includes(ANALYSIS_FIXED_RACE_ID),
        );
        await page.goto(
          `/winning-technique?tab=${tab}&venue_code=2&race_id=${ANALYSIS_FIXED_RACE_ID}`,
        );
        await request;
        await expect.poll(() => venueLists).toBeGreaterThan(0);
        await expect.poll(() => raceListVenues.length).toBeGreaterThan(0);
        await page.waitForLoadState("networkidle");
        expect(raceListVenues.every((venue) => venue === "eq.2")).toBeTruthy();
        await expect(
          page.locator(
            `${tab === "racecard" ? "#race-card" : "#attack-defense"}-venue-select option`,
          ),
        ).toHaveCount(1);
        // 一覧取得後も表を維持する。初回のID取得だけでは旧実装も成功し得る。
        await expect(page.locator(selector)).toBeVisible({ timeout: 20000 });
        if (tab === "racecard")
          await expect(page.locator(".rcd-table tbody tr")).toHaveCount(6);
        expect(
          dataRequests.some((url) => url.includes(ANALYSIS_FIXED_RACE_ID)),
        ).toBeTruthy();
      } finally {
        await context.close();
      }
    });
  }

  test("分析ツールの超展開データタブで固定の過去レースの実データが表示される（レースAI予想からの外出し、固定日の技法はBOA-664）", async ({
    page,
  }) => {
    await gotoAnalysisTabOnFixedDate(page, "attackdefense");
    await expect(page.locator(".motor-condition-container")).toBeVisible({
      timeout: 10000,
    });
    // 固定の過去レースは6艇分のデータが揃っているため実テーブルが必ず出る
    // （空状態を許容しない。BOA-664）
    await expect(page.locator(".ad-section")).toBeVisible({ timeout: 20000 });
  });

  test("分析ツールの出走表データタブで固定の過去レースの実データが表示される（レースAI予想からの外出し、固定日の技法はBOA-664）", async ({
    page,
  }) => {
    await gotoAnalysisTabOnFixedDate(page, "racecard");
    await expect(page.locator(".motor-condition-container")).toBeVisible({
      timeout: 10000,
    });
    // 固定の過去レースは出走表データが確定しているため実テーブルが必ず出る
    // （空状態を許容しない。BOA-664）
    await expect(page.locator(".rcd-table")).toBeVisible({ timeout: 20000 });
    await expect(page.locator(".rcd-table tbody tr")).toHaveCount(6);
  });
});
