// 旧 e2e/smoke.spec.js から切り出しスクリプトで移した（CI02。題・中身は元のまま、import の相対の字だけ1段深くした）
import { test, expect, e2eNow, e2eTodayJST } from "../fixtures.js";
import {
  ensureOpenVenues,
  rewriteTodayRaces,
  setJstNoon,
} from "../today-races-rewrite.js";

test.describe("会場ガイド (venues)", () => {
  test("/en のハンバーガーメニューから会場ガイドへ遷移できる", async ({
    page,
  }) => {
    await page.goto("/en");
    await page.click(".menu-btn");
    const venuesLink = page.locator('a.submenu-item:has-text("Venue Guides")');
    await expect(venuesLink).toBeVisible();
    await expect(venuesLink).toHaveAttribute("href", "/en/venues");
    await venuesLink.click();
    await expect(page).toHaveURL(/\/en\/venues$/);
  });

  test("/en/venues に会場カードが表示される", async ({ page }) => {
    await page.goto("/en/venues");
    const cards = page.locator(".evg-card");
    await expect(cards.first()).toBeVisible();
  });

  test("会場詳細ページ(/en/venues/heiwajima)が表示される", async ({ page }) => {
    await page.goto("/en/venues/heiwajima");
    await expect(
      page.getByRole("heading", { name: /Heiwajima/i }),
    ).toBeVisible();
  });
});

/**
 * 会場グリッドが実データで描画されたことを確かめる（BOA-593）。
 *
 * 読み込み中のスケルトン（VenueGridSkeleton）も `.venue-grid` と `.venue-grid-card` を
 * 24件持つため、それらの件数では実物のカードが出る前でも通り、データ取得が壊れても
 * 検知できなかった。スケルトンには無い `--open` / `--closed` を数え、取得失敗の表示が
 * 無いこと、開催中の会場が1つ以上あること（取得が空・失敗だと24会場すべてが
 * 「本日開催なし」になる）まで見る
 */
async function expectVenueGridLoaded(page) {
  const realCards = page.locator(
    ".venue-grid-card--open, .venue-grid-card--closed",
  );
  await expect(realCards).toHaveCount(24, { timeout: 30000 });
  // スケルトンが残っていない（実物と合わせて24件ちょうど）
  await expect(page.locator(".venue-grid-card")).toHaveCount(24);
  await expect(page.locator(".data-fetch-error")).toHaveCount(0);

  const names = (
    await realCards.locator(".venue-grid-card__name").allTextContents()
  ).map((name) => name.trim());
  expect(names).toHaveLength(24);
  expect(
    names.filter((name) => name === "" || name.startsWith("venues.")),
  ).toEqual([]);
  expect(new Set(names).size).toBe(24);

  expect(
    await page.locator(".venue-grid-card--open").count(),
    "開催中の会場が1つも無い（会場データの取得が空か失敗している）",
  ).toBeGreaterThan(0);
}

test.describe("開催場一覧ページ（venue-list-redesign）", () => {
  test("トップページに24会場のグリッドが固定表示される", async ({ page }) => {
    // 深夜は本日のレースに開催中の会場が無い。取得の失敗とは別に、開催中の会場を1つ足して見る
    await setJstNoon(page);
    await rewriteTodayRaces(page, (venues) => ensureOpenVenues(venues, 1));
    await page.goto("/");
    await expectVenueGridLoaded(page);
  });

  // ホームの会場データ取得（/api/races/today → 失敗時は Supabase へのフォールバック）が
  // 失敗したら、本文の形によらずエラー表示を出し、「本日開催なし」の会場カードを出さない
  // （BOA-668）。以前は本文が空・{} の 5xx だと PostgrestError の message が空文字になり、
  // エラー表示が出ないまま24会場すべてが「本日開催なし」になっていた。
  // message がある場合もエラー表示の下に24会場の「本日開催なし」が並んでいた。
  const POSTGREST_TIMEOUT = JSON.stringify({
    code: "57014",
    details: null,
    hint: null,
    message: "canceling statement due to statement timeout",
  });
  const homeFetchFailures = [
    {
      name: "本文が {} の 500",
      api: { status: 500, contentType: "application/json", body: "{}" },
      rest: { status: 500, contentType: "application/json", body: "{}" },
    },
    {
      name: "本文が空の 503",
      api: { status: 500, body: "" },
      rest: { status: 503, body: "" },
    },
    {
      name: "PostgREST のエラー本文（code・message・details・hint）の 500",
      api: {
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: "Supabase RPC error: 500",
        }),
      },
      rest: {
        status: 500,
        contentType: "application/json",
        body: POSTGREST_TIMEOUT,
      },
    },
    {
      name: "Vercel・ゲートウェイのタイムアウト（504, text/plain）",
      api: {
        status: 504,
        contentType: "text/plain",
        body: "An error occurred with your deployment\n\nFUNCTION_INVOCATION_TIMEOUT",
      },
      rest: {
        status: 504,
        contentType: "text/plain",
        body: "upstream request timeout",
      },
    },
    { name: "ネットワーク切断", api: "abort", rest: "abort" },
  ];
  for (const failure of homeFetchFailures) {
    test(`ホームの会場データ取得が失敗したらエラー表示を出し、「本日開催なし」にしない: ${failure.name}（BOA-668）`, async ({
      page,
    }) => {
      const respond = (spec) => (route) =>
        spec === "abort"
          ? route.abort("internetdisconnected")
          : route.fulfill(spec);
      await page.route("**/api/races/**", respond(failure.api));
      await page.route("**/rest/v1/**", respond(failure.rest));

      await page.goto("/");
      await expect(page.locator(".data-fetch-error")).toHaveCount(1, {
        timeout: 30000,
      });
      await expect(page.locator(".venue-grid-card--closed")).toHaveCount(0);
      await expect(page.locator(".venue-grid-card")).toHaveCount(0);
    });
  }

  test("ホームの会場データ取得が成功して0件なら、24会場すべてを「本日開催なし」にする（BOA-668）", async ({
    page,
  }) => {
    await page.route("**/api/races/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: [] }),
      }),
    );

    await page.goto("/");
    await expect(page.locator(".venue-grid-card--closed")).toHaveCount(24, {
      timeout: 30000,
    });
    await expect(page.locator(".data-fetch-error")).toHaveCount(0);
  });

  test("会場一覧→レース一覧→レース詳細と遷移し、URLがディープリンク可能", async ({
    page,
  }) => {
    await page.goto("/races/2026-08-11");
    await expectVenueGridLoaded(page);

    await page.locator(".venue-grid-card--open").first().click();
    await expect(page).toHaveURL(/\/races\/2026-08-11\/\d+$/);
    await expect(page.locator(".race-card").first()).toBeVisible({
      timeout: 10000,
    });

    await page.locator(".race-card .predict-btn").first().click();
    await expect(page).toHaveURL(/\/race\/2026-08-11-\d{2}-\d{2}$/);
    // 結果確定済みレースは「結果」タブがデフォルト表示され、データ出走表は
    // 結果タブ表示中は隠れる（フィードバック#7）ため、基本情報タブへ切り替える
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 15000,
    });

    // 同じURLを直接開いても表示される（ディープリンク）
    const url = page.url();
    await page.goto(url);
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 15000,
    });
  });

  test("レース一覧カードに出走表（勝率・当地・モーター）が常時表示され、折りたたみを開くと残りの指標が表示される", async ({
    page,
  }) => {
    // 過去日付は開催会場・出走表データが確定しているため安定してテストできる
    await page.goto("/races/2026-08-11");
    await page.locator(".venue-grid-card--open").first().click();
    await expect(page.locator(".race-card").first()).toBeVisible({
      timeout: 10000,
    });

    const firstCard = page.locator(".race-card").first();
    await expect(firstCard.locator(".rcdt-table").first()).toBeVisible();
    const alwaysLabels = await firstCard
      .locator(".rcdt-label-cell")
      .allTextContents();
    expect(alwaysLabels).toEqual(["勝率", "当地", "モーター"]);

    // 折りたたみは開く前は残りの指標（調子等）が存在しない
    await expect(firstCard.locator("tr", { hasText: "調子" })).toHaveCount(0);

    await firstCard.locator(".rcdt-expand-btn").click();
    await expect(firstCard.locator("tr", { hasText: "調子" })).toBeVisible({
      timeout: 10000,
    });
    const expandedLabels = await firstCard
      .locator(".rcdt-label-cell")
      .allTextContents();
    // BOA-221でチルト・調整重量の2行を追加したため11→13行、
    // BOA-268で全国2連率の行を追加したため13→14行、
    // BOA-289で当日体重・前走成績の2行を追加したため14→16行、
    // BOA-304で部品交換の行を追加したため16→17行、
    // BOA-815で平均STを公式と直近30走の2行にしたため17→18行になる
    // （直前情報タブへの分離はDataRaceTable専用のbuildBasicIndicatorRows経由のみで、
    // このカードは従来通りbuildIndicatorRows＝全指標を使うため件数は変わらず増える）
    expect(expandedLabels.length).toBe(18);
  });

  test("非開催の会場カードは「本日開催なし」でリンクを持たない", async ({
    page,
  }) => {
    // 過去日付は開催会場が確定しているため安定して非開催カードが存在する
    await page.goto("/races/2026-08-11");
    const closedCard = page.locator(".venue-grid-card--closed").first();
    await expect(closedCard).toBeVisible({ timeout: 10000 });
    await expect(closedCard).toContainText("本日開催なし");
  });
});

// 本番でRPC(get_predictions_by_date)がanonのstatement_timeout(3s)を超えて失敗した際、
// 取得失敗が「本日、このレース場での開催はありません」に化け、しかも空結果が30分間
// キャッシュされて再読み込みしても直らなかった不具合の回帰テスト。
// DBの状態に依存しないよう、Edge API・Supabase RESTはpage.routeで差し替える
test.describe("予測データ取得失敗の扱い（失敗を「開催なし」と誤表示せずキャッシュしない）", () => {
  const NO_RACES_TEXT = "本日、このレース場での開催はありません";
  const todayJST = e2eTodayJST;

  const predictionCacheKeys = (page) =>
    page.evaluate(() =>
      Object.keys(localStorage).filter((k) =>
        k.startsWith("boatai:predictions-"),
      ),
    );

  const mockEdgeRaces = (date) => ({
    generatedAt: e2eNow().toISOString(),
    updatedAt: e2eNow().toISOString(),
    races: [1, 2].map((n) => ({
      raceId: `${date}-05-${String(n).padStart(2, "0")}`,
      venueCode: 5,
      venue: "多摩川",
      raceNumber: n,
      startTime: `1${n}:00`,
      entries: [1, 2, 3, 4, 5, 6].map((i) => ({
        number: i,
        name: `テスト選手${i}`,
        grade: "B1",
        age: 30,
        winRate: 5.0,
        localWinRate: 5.0,
        motorNumber: i,
        motor2Rate: 35,
        boatNumber: i,
        boat2Rate: 35,
      })),
      predictions: {},
      exhibitionData: [],
      result: null,
    })),
  });

  const failAll = async (page) => {
    await page.route("**/api/predictions/**", (route) =>
      route.fulfill({ status: 500, body: "Internal Server Error" }),
    );
    await page.route("**/rest/v1/**", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          message: "canceling statement due to statement timeout",
        }),
      }),
    );
  };

  test("取得に失敗した場合、「開催なし」ではなくエラー表示を出し、空結果をキャッシュしない", async ({
    page,
  }) => {
    const edgeRequests = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/predictions/")) edgeRequests.push(req.url());
    });
    await failAll(page);
    await page.goto("/venue/5");

    const errorBox = page.locator(".data-fetch-error");
    await expect(errorBox).toBeVisible({ timeout: 20000 });
    await expect(errorBox).toContainText("データ取得エラー");
    await expect(errorBox.locator("button")).toContainText("再読み込み");
    await expect(page.getByText(NO_RACES_TEXT)).toHaveCount(0);

    // 失敗（=空の結果）がlocalStorageに保存されていない
    expect(await predictionCacheKeys(page)).toEqual([]);

    // 軽量版が失敗した場合はフル版を続けて取得しない（障害中のDBへの負荷を増やさない）
    expect(edgeRequests).toHaveLength(1);
    expect(edgeRequests[0]).toContain("light=true");
  });

  test("過去日付のレース一覧でも、取得失敗はエラー表示になり「データはありません」と誤表示しない", async ({
    page,
  }) => {
    await failAll(page);
    await page.goto("/races/2026-08-11/5");

    await expect(page.locator(".data-fetch-error")).toBeVisible({
      timeout: 20000,
    });
    await expect(
      page.getByText("このレース場のデータはありません"),
    ).toHaveCount(0);
    expect(await predictionCacheKeys(page)).toEqual([]);
  });

  test("失敗はキャッシュされず、再読み込みで取得がやり直されて一覧が表示される", async ({
    page,
  }) => {
    let failing = true;
    const date = todayJST();
    await page.route("**/api/predictions/**", (route) =>
      failing
        ? route.fulfill({ status: 500, body: "Internal Server Error" })
        : route.fulfill({ json: mockEdgeRaces(date) }),
    );
    // 直接クエリへのフォールバックは常に失敗させ、成功時のデータが
    // Edge APIのモック経由であることを明確にする
    await page.route("**/rest/v1/**", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "statement timeout" }),
      }),
    );

    await page.goto("/venue/5");
    await expect(page.locator(".data-fetch-error")).toBeVisible({
      timeout: 20000,
    });

    // 障害が解消した想定で、再読み込みボタンを押す
    failing = false;
    await page.locator(".data-fetch-error button").click();

    await expect(page.locator(".race-card")).toHaveCount(2, {
      timeout: 20000,
    });
    await expect(page.locator(".data-fetch-error")).toHaveCount(0);
    await expect(page.getByText(NO_RACES_TEXT)).toHaveCount(0);
  });

  test("取得に成功して0件のときだけ「開催はありません」を表示する", async ({
    page,
  }) => {
    await page.route("**/api/predictions/**", (route) =>
      route.fulfill({ json: { races: [] } }),
    );
    await page.route("**/rest/v1/**", (route) =>
      route.fulfill({ status: 200, json: [] }),
    );

    await page.goto("/venue/5");
    await expect(page.getByText(NO_RACES_TEXT)).toBeVisible({ timeout: 20000 });
    await expect(page.locator(".data-fetch-error")).toHaveCount(0);
  });
});
