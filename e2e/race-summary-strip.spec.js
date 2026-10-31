import { test, expect } from "./fixtures.js";

// レース詳細の 6艇の要約と 1R〜12R の帯（BOA-1189 GS01-c、2026-10-31 オーナー決定）
// done_when: 過去の確定済みの1件で、/racer/ へのリンクが6件、/race/ へのリンクが2件以上ある
const G1_RACE = "/race/2026-09-29-16-12"; // 児島12R（G1 児島キングカップ 2026-09-28〜10-03、確定済み）
const IPPAN_RACE = "/race/2026-09-22-02-05"; // 戸田5R（一般、確定済み）
const CANCELLED_RACE = "/race/2026-09-21-02-05"; // 戸田5R（一般、この日は全レース中止）
const REFUND_RACE = "/race/2026-09-29-16-11"; // 児島11R（確定、2・3号艇が返還）
// 帯が引く節（supabaseDataService.getSeriesOfDate）。race_series は他の部品も別の列で引く
const SERIES_OF_DATE =
  /\/rest\/v1\/race_series\?select=start_date(,|%2C)end_date(,|%2C)title(,|%2C)grade/;

test.describe("レース詳細: 6艇の要約と 1R〜12R の帯", () => {
  test.slow();

  test("確定済みの G1: 要約に /racer/ が6件、帯に /race/ が2件以上、節ページへのリンク", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    // G1 では節を引く（一般戦の「引かない」の検査が空振りしないよう、同じ照合で引くことも見る）
    const seriesRequest = page.waitForRequest(SERIES_OF_DATE, {
      timeout: 60000,
    });
    await page.goto(G1_RACE);
    await seriesRequest;
    const summary = page.getByTestId("race-summary-table");
    await expect(summary).toBeVisible({ timeout: 30000 });

    // 選手名は /racer/N へのリンクで6件
    await expect(summary.locator('a[href^="/racer/"]')).toHaveCount(6);
    // 確定後は着順の列を一番左に出す
    await expect(summary.locator("thead th").first()).toHaveText("着順");
    await expect(summary.locator("tbody tr")).toHaveCount(6);
    // 並びは艇番のまま（1〜6）
    await expect(summary.locator("tbody .rol-boat-badge")).toHaveText([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
    ]);
    // 展示タイムは秒数と「(N位)」、近くに「小さいほど速い」
    await expect(
      summary.locator(".race-summary-table__exh-rank").first(),
    ).toHaveText(/^\(\d位(タイ)?\)$/);
    await expect(summary).toContainText("展示タイムは小さいほど速い");
    // 「展示2位」の形（展示タイムを付けない順位）を出さない
    await expect(summary).not.toContainText(/展示\d位/);

    // 帯: a 要素で /race/ へのリンクが2件以上、今のレースを強調
    const strip = page.getByTestId("race-number-strip");
    const raceLinks = strip.locator('a[href^="/race/"]');
    expect(await raceLinks.count()).toBeGreaterThanOrEqual(2);
    const current = strip.locator('a[aria-current="page"]');
    await expect(current).toHaveText("12R");
    await expect(current).toHaveAttribute("href", "/race/2026-09-29-16-12");

    // SG/G1/G2 の節の日は、節ページ（初日は race_series の start_date）へのリンク
    await expect(page.getByTestId("race-number-strip-meet")).toHaveAttribute(
      "href",
      "/venue/16/meet/2026-09-28",
    );

    // 帯は要約より上、要約はタブより上
    const stripBox = await strip.boundingBox();
    const summaryBox = await summary.boundingBox();
    const tabsBox = await page.locator(".race-tabs-btn").first().boundingBox();
    expect(stripBox.y).toBeLessThan(summaryBox.y);
    expect(summaryBox.y).toBeLessThan(tabsBox.y);
  });

  test("一般戦では節を引かず、節ページへのリンクを出さない", async ({
    page,
  }) => {
    // 一般戦はレースのグレード（ippan）で SG/G1/G2 でないと分かるので、race_series を引かない。
    // 引かないことを見る（取得中もリンクは出ないので、リンクが無いことだけでは空振りする）
    const seriesRequests = [];
    page.on("request", (req) => {
      if (SERIES_OF_DATE.test(req.url())) seriesRequests.push(req.url());
    });
    await page.goto(IPPAN_RACE);
    const summary = page.getByTestId("race-summary-table");
    await expect(summary).toBeVisible({ timeout: 30000 });
    const strip = page.getByTestId("race-number-strip");
    await expect(strip.locator('a[aria-current="page"]')).toHaveText("5R");
    await expect(page.getByTestId("race-number-strip-meet")).toHaveCount(0);
    expect(seriesRequests).toEqual([]);
  });

  test("返還艇の着順は「—」でなく「返還」（ファン評価1周目 指摘2）", async ({
    page,
  }) => {
    await page.goto(REFUND_RACE);
    const summary = page.getByTestId("race-summary-table");
    await expect(summary).toBeVisible({ timeout: 30000 });
    const finishOf = (boat) =>
      summary
        .locator("tbody tr")
        .nth(boat - 1)
        .locator(".race-summary-table__finish");
    await expect(finishOf(2)).toHaveText("返還");
    await expect(finishOf(3)).toHaveText("返還");
    await expect(finishOf(1)).toHaveText(/^\d着$/);
  });

  test("中止のレースは要約を出さない（中止の知らせを押し下げない。ファン評価1周目 指摘1）", async ({
    page,
  }) => {
    await page.goto(CANCELLED_RACE);
    await expect(
      page.getByText("このレースは中止となりました").first(),
    ).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByTestId("race-number-strip")).toBeVisible();
    await expect(page.getByTestId("race-summary-table")).toHaveCount(0);
  });

  test("節の取得に失敗したら、帯は出したまま失敗を表示する（データなしに化けさせない）", async ({
    page,
  }) => {
    await page.route(/\/rest\/v1\/race_series\?/, (route) =>
      route.fulfill({ status: 500, body: '{"message":"boom"}' }),
    );
    await page.goto(G1_RACE);
    const strip = page.getByTestId("race-number-strip");
    await expect(strip.locator('a[href^="/race/"]').first()).toBeVisible({
      timeout: 30000,
    });
    await expect(strip.getByRole("alert")).toContainText(
      "節の情報を読み込めませんでした",
    );
    await expect(page.getByTestId("race-number-strip-meet")).toHaveCount(0);
  });

  test("en でも帯のリンクは言語の付いた URL、選手リンクは ja 専用の /racer/", async ({
    page,
  }) => {
    await page.goto(`/en${G1_RACE}`);
    const summary = page.getByTestId("race-summary-table");
    await expect(summary).toBeVisible({ timeout: 30000 });
    await expect(summary.locator('a[href^="/racer/"]')).toHaveCount(6);
    await expect(summary.locator("thead th").first()).toHaveText("Finish");
    const strip = page.getByTestId("race-number-strip");
    await expect(strip.locator('a[aria-current="page"]')).toHaveAttribute(
      "href",
      "/en/race/2026-09-29-16-12",
    );
  });
});
