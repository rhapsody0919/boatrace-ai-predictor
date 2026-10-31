import { test, expect, fetchRecorded } from "./fixtures.js";

// レース詳細の出走6艇の1〜2行と 1R〜12R の帯（BOA-1189 GS01-c。2026-10-31 オーナー決定、11-01 A案で要約を縮めた）
// done_when: 過去の確定済みの1件で、/racer/ へのリンクが6件、/race/ へのリンクが2件以上ある
const G1_RACE = "/race/2026-09-29-16-12"; // 児島12R（G1 児島キングカップ 2026-09-28〜10-03、確定済み）
const IPPAN_RACE = "/race/2026-09-22-02-05"; // 戸田5R（一般、確定済み）
const CANCELLED_RACE = "/race/2026-09-21-02-05"; // 戸田5R（一般、この日は全レース中止）
// 帯が引く節（supabaseDataService.getSeriesOfDate）。race_series は他の部品も別の列で引く
const SERIES_OF_DATE =
  /\/rest\/v1\/race_series\?select=start_date(,|%2C)end_date(,|%2C)title(,|%2C)grade/;

test.describe("レース詳細: 出走6艇と 1R〜12R の帯", () => {
  test.slow();

  test("確定済みの G1: 出走6艇に /racer/ が6件、帯に /race/ が2件以上、節ページへのリンク", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    // G1 では節を引く（一般戦の「引かない」の検査が空振りしないよう、同じ照合で引くことも見る）
    const seriesRequest = page.waitForRequest(SERIES_OF_DATE, {
      timeout: 60000,
    });
    await page.goto(G1_RACE);
    await seriesRequest;
    const entrants = page.getByTestId("race-entrants");
    await expect(entrants).toBeVisible({ timeout: 30000 });

    // 選手名は /racer/N へのリンクで6件。並びは艇番のまま（1〜6）
    await expect(entrants.locator('a[href^="/racer/"]')).toHaveCount(6);
    await expect(entrants.locator(".rol-boat-badge")).toHaveText([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
    ]);
    // A案（2026-11-01）: 艇番・選手名・級別だけ。着順・展示タイムは結果タブ・直前情報に任せる
    await expect(entrants.locator(".race-entrants__grade").first()).toHaveText(
      /^[AB][12]$/,
    );
    await expect(entrants).not.toContainText("着");
    await expect(entrants).not.toContainText("展示");
    // 375px で2行まで
    const box = await entrants.boundingBox();
    const itemHeight = (
      await entrants.locator(".race-entrants__item").first().boundingBox()
    ).height;
    expect(box.height).toBeLessThanOrEqual(itemHeight * 2 + 8);

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

    // 帯は出走6艇より上、出走6艇はタブより上
    const stripBox = await strip.boundingBox();
    const tabsBox = await page.locator(".race-tabs-btn").first().boundingBox();
    expect(stripBox.y).toBeLessThan(box.y);
    expect(box.y).toBeLessThan(tabsBox.y);
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
    await expect(page.getByTestId("race-entrants")).toBeVisible({
      timeout: 30000,
    });
    const strip = page.getByTestId("race-number-strip");
    await expect(strip.locator('a[aria-current="page"]')).toHaveText("5R");
    await expect(page.getByTestId("race-number-strip-meet")).toHaveCount(0);
    expect(seriesRequests).toEqual([]);
  });

  test("中止のレースは出走6艇を出さない（中止の知らせを押し下げない。ファン評価1周目 指摘1）", async ({
    page,
  }) => {
    await page.goto(CANCELLED_RACE);
    await expect(
      page.getByText("このレースは中止となりました").first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("race-number-strip")).toBeVisible();
    await expect(page.getByTestId("race-entrants")).toHaveCount(0);
  });

  test("本日の締切前は、見出しに締切時刻を出す（ファン評価2周目 指摘2）", async ({
    page,
  }) => {
    // smoke.spec.js の「AI用にコピー」と同じ固定: 戸田8R（2026-09-18）の締切前の 13:46 に時計を置き、
    // 結果を外して締切前の状態にする
    await page.clock.setFixedTime(new Date("2026-09-18T13:46:00+09:00"));
    await page.route("**/api/predictions/2026-09-18*", async (route) => {
      const response = await fetchRecorded(route);
      const body = await response.json();
      const races = (body.races || []).map((race) =>
        race.raceId === "2026-09-18-02-08" ? { ...race, result: null } : race,
      );
      await route.fulfill(
        response.fulfillOptions({ json: { ...body, races } }),
      );
    });
    await page.goto("/race/2026-09-18-02-08");
    await expect(page.getByTestId("race-entrants")).toBeVisible({
      timeout: 30000,
    });
    const deadline = page.locator("h1").getByTestId("race-detail-deadline");
    await expect(deadline).toHaveText(/^（締切 \d{2}:\d{2}）$/);
  });

  test("確定済みのレースでは見出しに締切時刻を出さない", async ({ page }) => {
    await page.goto(G1_RACE);
    await expect(page.getByTestId("race-entrants")).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByTestId("race-detail-deadline")).toHaveCount(0);
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
    const entrants = page.getByTestId("race-entrants");
    await expect(entrants).toBeVisible({ timeout: 30000 });
    await expect(entrants.locator('a[href^="/racer/"]')).toHaveCount(6);
    const strip = page.getByTestId("race-number-strip");
    await expect(strip.locator('a[aria-current="page"]')).toHaveAttribute(
      "href",
      "/en/race/2026-09-29-16-12",
    );
  });
});
