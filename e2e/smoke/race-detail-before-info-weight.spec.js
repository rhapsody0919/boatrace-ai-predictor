// 旧 e2e/smoke.spec.js から切り出しスクリプトで移した（CI02。題・中身は元のまま、import の相対の字だけ1段深くした）
import { test, expect, E2E_MODE, fetchRecorded } from "../fixtures.js";

// 展示前の体重（BOA-484）。展示前は exhibition_data の行がまだ無いため、
// 出走表の体重（race_entries.weight_kg）を直前情報タブに出し、チルトは展示後に
// 公開される旨を添える。DBの状態に依存しないよう、直前情報の設定値の取得
// （exhibition_data の select に tilt を含むもの）と出走表の体重の取得だけを差し替える
test.describe("レース詳細の直前情報タブ: 展示前の体重", () => {
  const RACE = "/race/2026-09-21-05-12";
  const ENTRY_WEIGHTS = [1, 2, 3, 4, 5, 6].map((n) => ({
    boat_number: n,
    weight_kg: 50 + n,
  }));

  const isMaintenance = (url) =>
    url.pathname.endsWith("/rest/v1/exhibition_data") &&
    (url.searchParams.get("select") ?? "").includes("tilt");
  const isEntryWeights = (url) =>
    url.pathname.endsWith("/rest/v1/race_entries") &&
    url.searchParams.get("select") === "boat_number,weight_kg";

  const fulfillJson =
    (body, status = 200) =>
    (route) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

  const openBeforeInfoTab = async (page) => {
    await page.goto(RACE);
    await page.click('[role="tab"]:has-text("直前情報")');
    await expect(page.locator(".race-before-info-tab")).toBeVisible({
      timeout: 20000,
    });
  };

  const rowByLabel = (page, label) =>
    page.locator(".drt-table tbody tr").filter({
      has: page.locator(".drt-label-full", {
        hasText: new RegExp(`^${label}$`),
      }),
    });

  // 展示前の注記は確定済みのレースには出さない。確定済みの過去レースを
  // 「未確定」に見せるため、予想データの応答から結果（rank1 を持つ result）を外す
  // （Edge API・RPC のどちらの経路でも効くよう、応答のJSONを走査する）
  const stripResults = (value) => {
    if (Array.isArray(value)) return value.map(stripResults);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) =>
          k === "result" && v && typeof v === "object" && v.rank1 != null
            ? [k, null]
            : [k, stripResults(v)],
        ),
      );
    }
    return value;
  };
  const routeUnfinished = async (page) => {
    const handler = async (route) => {
      try {
        // route.fetch() は録画を通らないため fetchRecorded を使う（e2e/fixtures.js）
        const response = await fetchRecorded(route);
        const json = stripResults(await response.json());
        await route.fulfill({
          status: response.status(),
          headers: response.headers(),
          json,
        });
      } catch (error) {
        // 録画に無い要求は本番へ素通しして応答を待つ（ADR-0077 の A改）。
        // アサーションが先に終わってページが閉じた後の失敗は、テストの結果ではない
        if (route.request().frame().page().isClosed()) return;
        throw error;
      }
    };
    await page.route("**/api/predictions/**", handler);
    await page.route("**/rest/v1/rpc/get_predictions*", handler);
  };

  // routeUnfinished の route.fetch は本物の応答を待つため、アサーションが先に終わると
  // テスト終了時にまだ応答待ちのリクエストが残り、「page closed」でテストが失敗扱いになる
  // （2026-09-28実測。アサーションは全て通っていた）。終了時に待ちを捨てる。
  // 録画の再生（replay）では fetchRecorded が待たずに返るうえ、ここで page のルートを
  // 外すと context 側の routeFromHAR と競合して「Route is already handled!」で落ちる
  // （BOA-466で実測）ため、replay では外さない。本番へ出る live と録画中（record）は従来どおり
  test.afterEach(async ({ page }) => {
    if (E2E_MODE !== "replay") {
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  });

  test("展示前（exhibition_data が空）は出走表の体重を出し、チルトは展示後に公開される旨を添える", async ({
    page,
  }) => {
    await routeUnfinished(page);
    await page.route(isMaintenance, fulfillJson([]));
    await page.route(isEntryWeights, fulfillJson(ENTRY_WEIGHTS));
    await openBeforeInfoTab(page);

    const weightRow = rowByLabel(page, "当日体重");
    await expect(weightRow).toBeVisible({ timeout: 20000 });
    await expect(weightRow.locator("td.drt-cell")).toHaveText([
      "51.0kg",
      "52.0kg",
      "53.0kg",
      "54.0kg",
      "55.0kg",
      "56.0kg",
    ]);
    await expect(page.getByTestId("rbi-pre-exhibition-note")).toContainText(
      "チルトは展示航走の後に公開されます",
    );
  });

  test("展示後は exhibition_data の当日体重を優先し、展示前の注記を出さない", async ({
    page,
  }) => {
    const maintenance = [1, 2, 3, 4, 5, 6].map((n) => ({
      boat_number: n,
      tilt: -0.5,
      adjustment_weight: n === 1 ? 0.5 : 0,
      propeller_change: null,
      parts_changed: null,
      today_weight: n === 1 ? 51.5 : 50 + n,
      prev_race_no: null,
      prev_entry_course: null,
      prev_start_timing: null,
      prev_finish_rank: null,
    }));
    await routeUnfinished(page);
    await page.route(isMaintenance, fulfillJson(maintenance));
    await page.route(isEntryWeights, fulfillJson(ENTRY_WEIGHTS));
    await openBeforeInfoTab(page);

    const weightRow = rowByLabel(page, "当日体重");
    await expect(weightRow).toBeVisible({ timeout: 20000 });
    // 1号艇は出走表（51.0）ではなく直前情報（51.5）の値
    await expect(weightRow.locator("td.drt-cell").first()).toHaveText("51.5kg");
    await expect(rowByLabel(page, "チルト")).toContainText("-0.5");
    await expect(page.getByTestId("rbi-pre-exhibition-note")).toHaveCount(0);
  });

  // BOA-497: 展示前の途中の結果をキャッシュしない。以前は当日分30分・過去分7日、
  // localStorage に残り、展示後に値が入っても再訪問・リロードで「—」のまま出た
  const maintenanceRow = (n, exhibited) => ({
    boat_number: n,
    exhibition_time: exhibited ? 6.7 : null,
    tilt: exhibited ? -0.5 : null,
    adjustment_weight: 0,
    propeller_change: null,
    parts_changed: null,
    today_weight: 50 + n,
    prev_race_no: null,
    prev_entry_course: null,
    prev_start_timing: null,
    prev_finish_rank: null,
    exhibition_course: exhibited ? n : null,
    is_absent: false,
    updated_at: "2026-09-21T07:12:56Z",
  });
  const tiltCells = (page) => rowByLabel(page, "チルト").locator("td.drt-cell");

  test("展示前（体重だけの行）に開いた後、展示後に開き直すとチルトが出る", async ({
    page,
  }) => {
    let exhibited = false;
    let requests = 0;
    await page.route(isMaintenance, (route) => {
      requests += 1;
      return fulfillJson(
        [1, 2, 3, 4, 5, 6].map((n) => maintenanceRow(n, exhibited)),
      )(route);
    });
    await openBeforeInfoTab(page);
    await expect(tiltCells(page).first()).toHaveText("—", { timeout: 20000 });

    exhibited = true;
    await openBeforeInfoTab(page);
    await expect(tiltCells(page).first()).toContainText("-0.5", {
      timeout: 20000,
    });
    expect(requests).toBeGreaterThanOrEqual(2);
  });

  test("一部の艇だけ展示タイムが入った途中の結果もキャッシュせず、揃った後はキャッシュする", async ({
    page,
  }) => {
    let stage = "partial";
    let requests = 0;
    await page.route(isMaintenance, (route) => {
      requests += 1;
      return fulfillJson(
        [1, 2, 3, 4, 5, 6].map((n) =>
          maintenanceRow(n, stage === "complete" || n <= 3),
        ),
      )(route);
    });
    await openBeforeInfoTab(page);
    await expect(tiltCells(page).nth(3)).toHaveText("—", { timeout: 20000 });

    stage = "complete";
    await openBeforeInfoTab(page);
    await expect(tiltCells(page).nth(3)).toContainText("-0.5", {
      timeout: 20000,
    });

    // 揃った結果は保存される: 応答を途中の状態へ戻しても、開き直しで値が残り、取り直さない
    const afterComplete = requests;
    stage = "partial";
    await openBeforeInfoTab(page);
    await expect(tiltCells(page).nth(3)).toContainText("-0.5", {
      timeout: 20000,
    });
    expect(requests).toBe(afterComplete);
  });

  test("出走表の体重の取得に失敗したら、未公開と区別して取得失敗を出す", async ({
    page,
  }) => {
    await routeUnfinished(page);
    await page.route(isMaintenance, fulfillJson([]));
    await page.route(
      isEntryWeights,
      fulfillJson({ code: "57014", message: "canceling statement" }, 500),
    );
    await openBeforeInfoTab(page);

    await expect(
      page.locator(".inline-fetch-error", {
        hasText: "出走表の体重を取得できませんでした",
      }),
    ).toBeVisible({ timeout: 20000 });
    // 値が無いので展示前の注記は出さない
    await expect(page.getByTestId("rbi-pre-exhibition-note")).toHaveCount(0);
  });

  test("体重が未公開（出走表・直前情報とも空）なら注記も取得失敗も出さない", async ({
    page,
  }) => {
    await routeUnfinished(page);
    await page.route(isMaintenance, fulfillJson([]));
    await page.route(
      isEntryWeights,
      fulfillJson(ENTRY_WEIGHTS.map((r) => ({ ...r, weight_kg: null }))),
    );
    await openBeforeInfoTab(page);

    const weightRow = rowByLabel(page, "当日体重");
    await expect(weightRow).toBeVisible({ timeout: 20000 });
    await expect(weightRow.locator("td.drt-cell").first()).toHaveText("—");
    await expect(page.getByTestId("rbi-pre-exhibition-note")).toHaveCount(0);
    await expect(
      page.locator(".inline-fetch-error", {
        hasText: "出走表の体重を取得できませんでした",
      }),
    ).toHaveCount(0);
  });

  // --- ここから /code-review の指摘に対する再現テスト（2026-09-28） ---

  test("当日体重は基本情報タブ（データ出走表）にも残る（直前情報タブへ移さない）", async ({
    page,
  }) => {
    const maintenance = [1, 2, 3, 4, 5, 6].map((n) => ({
      boat_number: n,
      tilt: 0,
      adjustment_weight: 0,
      propeller_change: null,
      parts_changed: null,
      today_weight: 50 + n,
      prev_race_no: null,
      prev_entry_course: null,
      prev_start_timing: null,
      prev_finish_rank: null,
    }));
    await page.route(isMaintenance, fulfillJson(maintenance));
    await page.goto(RACE);
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    const basicRow = page
      .locator(".data-race-table .drt-table tbody tr")
      .filter({
        has: page.locator(".drt-label-full", { hasText: /^当日体重$/ }),
      });
    await expect(basicRow).toBeVisible({ timeout: 20000 });
    await expect(basicRow.locator("td.drt-cell").first()).toHaveText("51.0kg");
  });

  test("直前情報の設定値の取得に失敗したときは、取得失敗を「チルト未公開」の注記に化けさせない", async ({
    page,
  }) => {
    await routeUnfinished(page);
    await page.route(
      isMaintenance,
      fulfillJson({ code: "57014", message: "canceling statement" }, 500),
    );
    await page.route(isEntryWeights, fulfillJson(ENTRY_WEIGHTS));
    await openBeforeInfoTab(page);

    // 体重は出走表の値で出る
    await expect(
      rowByLabel(page, "当日体重").locator("td.drt-cell").first(),
    ).toHaveText("51.0kg", { timeout: 20000 });
    await expect(page.locator(".inline-fetch-error").first()).toBeVisible();
    await expect(page.getByTestId("rbi-pre-exhibition-note")).toHaveCount(0);
  });

  test("確定済みのレースでは、直前情報が入らなかったときも展示前の注記を出さない", async ({
    page,
  }) => {
    // routeUnfinished を使わない＝結果ありの確定済みレース
    await page.route(isMaintenance, fulfillJson([]));
    await page.route(isEntryWeights, fulfillJson(ENTRY_WEIGHTS));
    await openBeforeInfoTab(page);

    await expect(
      rowByLabel(page, "当日体重").locator("td.drt-cell").first(),
    ).toHaveText("51.0kg", { timeout: 20000 });
    await expect(page.getByTestId("rbi-pre-exhibition-note")).toHaveCount(0);
  });

  test("全艇に直前情報の体重があれば、出走表の体重の取得失敗は出さない（表示に影響しない）", async ({
    page,
  }) => {
    const maintenance = [1, 2, 3, 4, 5, 6].map((n) => ({
      boat_number: n,
      tilt: 0,
      adjustment_weight: 0,
      propeller_change: null,
      parts_changed: null,
      today_weight: 50 + n,
      prev_race_no: null,
      prev_entry_course: null,
      prev_start_timing: null,
      prev_finish_rank: null,
    }));
    await page.route(isMaintenance, fulfillJson(maintenance));
    await page.route(
      isEntryWeights,
      fulfillJson({ code: "57014", message: "canceling statement" }, 500),
    );
    await openBeforeInfoTab(page);

    await expect(
      rowByLabel(page, "当日体重").locator("td.drt-cell").first(),
    ).toHaveText("51.0kg", { timeout: 20000 });
    await expect(
      page.locator(".inline-fetch-error", {
        hasText: "出走表の体重を取得できませんでした",
      }),
    ).toHaveCount(0);
  });
});
