import { test, expect } from "../fixtures.js";

// オリジナル展示（一周・半周ラップ・まわり足・直線、BOA-452 / phase a FR-4b）
// 本番の匿名公開（マイグレーション096）は画面実装の後に適用するため、DBの状態に
// 依存しないよう race_original_exhibition / _values の2エンドポイントだけを
// page.routeで差し替える（ピットレポートのテストと同じやり方）
test.describe("レース詳細の直前情報タブ: オリジナル展示", () => {
  const RACE = "/race/2026-09-21-05-12";

  const VALUES = [
    { boat_number: 1, kind: "一周", value: 36.91 },
    { boat_number: 1, kind: "まわり足", value: 5.66 },
    { boat_number: 1, kind: "直線", value: 7.04 },
    { boat_number: 2, kind: "一周", value: 37.27 },
    { boat_number: 2, kind: "まわり足", value: 5.5 },
    { boat_number: 2, kind: "直線", value: 6.93 },
    { boat_number: 3, kind: "一周", value: 37.13 },
    { boat_number: 3, kind: "まわり足", value: 5.53 },
    { boat_number: 3, kind: "直線", value: 6.97 },
    { boat_number: 4, kind: "一周", value: 37.63 },
    { boat_number: 4, kind: "まわり足", value: 5.67 },
    { boat_number: 4, kind: "直線", value: 7.13 },
    { boat_number: 5, kind: "一周", value: 37.09 },
    { boat_number: 5, kind: "まわり足", value: 5.4 },
    { boat_number: 5, kind: "直線", value: 7.07 },
    { boat_number: 6, kind: "一周", value: 37.44 },
    { boat_number: 6, kind: "まわり足", value: 5.13 },
    { boat_number: 6, kind: "直線", value: 7.07 },
  ];

  const routeOriginalExhibition = async (page, { header, values }) => {
    await page.route("**/rest/v1/race_original_exhibition?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(header),
      }),
    );
    await page.route("**/rest/v1/race_original_exhibition_values*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(values),
      }),
    );
  };

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

  test("値があるレースで、一周・まわり足・直線の行と出典・取得時刻・再配布しない旨が出る", async ({
    page,
  }) => {
    await routeOriginalExhibition(page, {
      header: {
        item_labels: "一周|まわり足|直線",
        measure_status: 1,
        updated_at: "2026-09-21T06:42:00Z",
      },
      values: VALUES,
    });
    await openBeforeInfoTab(page);

    // 行が出て、値がスタブと一致する
    await expect(rowByLabel(page, "一周")).toBeVisible({ timeout: 20000 });
    await expect(rowByLabel(page, "一周")).toContainText("36.91");
    await expect(rowByLabel(page, "まわり足")).toContainText("5.66");
    await expect(rowByLabel(page, "直線")).toContainText("7.04");
    // 一番速い艇（最小値）に印が付く: まわり足は6号艇の5.13
    await expect(
      rowByLabel(page, "まわり足").locator("td.drt-best"),
    ).toHaveText("5.13");

    // ADR-0067が求める3点（出典・取得時刻・再配布しない旨）
    const source = page.locator(".rbi-source");
    await expect(source).toBeVisible();
    await expect(source).toContainText("BOATCAST");
    await expect(source).toContainText("9/21 15:42");
    await expect(source).toContainText("再配布はしていません");
  });

  test("計測項目が少ない会場では、その項目の行だけ出す（直線が無い会場で直線の行を出さない）", async ({
    page,
  }) => {
    await routeOriginalExhibition(page, {
      header: {
        item_labels: "一周|まわり足",
        measure_status: 1,
        updated_at: "2026-09-21T06:42:00Z",
      },
      values: VALUES.filter((v) => v.kind !== "直線"),
    });
    await openBeforeInfoTab(page);

    await expect(rowByLabel(page, "一周")).toBeVisible({ timeout: 20000 });
    await expect(rowByLabel(page, "まわり足")).toBeVisible();
    await expect(rowByLabel(page, "直線")).toHaveCount(0);
  });

  test("匿名に権限が無い場合（096未適用）は行も出典も出さない", async ({
    page,
  }) => {
    const denied = (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          code: "42501",
          message: "permission denied for table race_original_exhibition",
        }),
      });
    await page.route("**/rest/v1/race_original_exhibition?*", denied);
    await page.route("**/rest/v1/race_original_exhibition_values*", denied);
    await openBeforeInfoTab(page);

    // 直前情報タブ自体は出たうえで、オリジナル展示の行と出典だけが出ない
    await expect(page.locator(".drt-table")).toBeVisible({ timeout: 20000 });
    await expect(rowByLabel(page, "一周")).toHaveCount(0);
    await expect(rowByLabel(page, "まわり足")).toHaveCount(0);
    await expect(rowByLabel(page, "直線")).toHaveCount(0);
    // 展示進入（BOA-485）の出典は同じブロックに出うるので、BOATCASTの出典に絞って見る
    await expect(
      page.locator(".rbi-source", { hasText: "BOATCAST" }),
    ).toHaveCount(0);
  });

  test("まだ計測されていないレースでは行も出典も出さない（「—」を並べない）", async ({
    page,
  }) => {
    await routeOriginalExhibition(page, { header: null, values: [] });
    await openBeforeInfoTab(page);

    await expect(page.locator(".drt-table")).toBeVisible({ timeout: 20000 });
    await expect(rowByLabel(page, "一周")).toHaveCount(0);
    // 展示進入（BOA-485）の出典は同じブロックに出うるので、BOATCASTの出典に絞って見る
    await expect(
      page.locator(".rbi-source", { hasText: "BOATCAST" }),
    ).toHaveCount(0);
  });

  // --- ここから /code-review の指摘に対する再現テスト（2026-09-28） ---

  test("096未適用で一度開いた後に権限が付いたら、リロード無しの再訪でも行が出る（forbiddenをキャッシュしない）", async ({
    page,
  }) => {
    // 1回目: 権限が無い（096未適用）
    const denied = (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          code: "42501",
          message: "permission denied for table race_original_exhibition",
        }),
      });
    await page.route("**/rest/v1/race_original_exhibition?*", denied);
    await page.route("**/rest/v1/race_original_exhibition_values*", denied);
    await openBeforeInfoTab(page);
    await expect(rowByLabel(page, "一周")).toHaveCount(0);

    // 2回目: 096を適用した後を模して200を返す。forbiddenがキャッシュされていると、
    // 過去レースのキーは7日TTLなのでここで行が出ない
    //
    // denied は unroute せず、上から200のハンドラを重ねる（後から登録した page.route が
    // 先に評価され、fulfill すれば denied には回らない）。unroute で page のルートが
    // 一度0件になると、Playwright はそのとき処理中の要求を context 側（録画の再生）へ
    // 送り直す。同じ要求がクライアント側の page→context の経路でも処理され、
    // 「Route is already handled!」で落ちた（BOA-661、CIの trace で実測）
    await routeOriginalExhibition(page, {
      header: {
        item_labels: "一周|まわり足|直線",
        updated_at: "2026-09-21T06:42:00Z",
      },
      values: VALUES,
    });
    await page.goto("/");
    await openBeforeInfoTab(page);
    await expect(rowByLabel(page, "一周")).toBeVisible({ timeout: 20000 });
    await expect(rowByLabel(page, "一周")).toContainText("36.91");
  });

  test("全艇が欠測（value=null）の項目は、行だけでなく出典の項目名にも出さない", async ({
    page,
  }) => {
    // 津・三国の一周のように、ファイルが `--.--` を返す項目は value=NULL で入る
    // （マイグレーション091のコメント）。行が出ないのに出典だけが名乗ると、
    // 出していない値の出典を表示することになる
    await routeOriginalExhibition(page, {
      header: {
        item_labels: "一周|まわり足|直線",
        updated_at: "2026-09-21T06:42:00Z",
      },
      values: VALUES.map((v) =>
        v.kind === "一周" ? { ...v, value: null } : v,
      ),
    });
    await openBeforeInfoTab(page);

    await expect(rowByLabel(page, "まわり足")).toBeVisible({ timeout: 20000 });
    await expect(rowByLabel(page, "一周")).toHaveCount(0);
    const source = page.locator(".rbi-source");
    await expect(source).toBeVisible();
    await expect(source).toContainText("まわり足");
    await expect(source).not.toContainText("一周");
  });

  test("全項目が欠測なら行も出典も出さない", async ({ page }) => {
    await routeOriginalExhibition(page, {
      header: {
        item_labels: "一周|まわり足|直線",
        updated_at: "2026-09-21T06:42:00Z",
      },
      values: VALUES.map((v) => ({ ...v, value: null })),
    });
    await openBeforeInfoTab(page);

    await expect(page.locator(".drt-table")).toBeVisible({ timeout: 20000 });
    await expect(rowByLabel(page, "一周")).toHaveCount(0);
    // 展示進入（BOA-485）の出典は同じブロックに出うるので、BOATCASTの出典に絞って見る
    await expect(
      page.locator(".rbi-source", { hasText: "BOATCAST" }),
    ).toHaveCount(0);
  });

  // **「別のレースへ移っても前のレースの値が残らない」はE2Eにしていない。**
  // raceIdとセットで持つ修正（RaceBeforeInfoTab）は入れてあるが、この不具合が
  // 顕在化するのは「未確定のレース同士を行き来する」ときだけ。確定済みの
  // レース同士だと defaultTabId が result のまま→basic→result と揺れて
  // RaceTabs がタブをリセットし、RaceBeforeInfoTab が作り直されるため、
  // 修正の有無で結果が変わらない（実測、2026-09-28）。未確定のレースを
  // 2つ用意するには「当日の未発走レース」が要り、実行時刻とDBの状態に
  // 依存してフレークになるため、テストは置かない（BOA-452のPRコメントに記録）
});

// 展示進入（スタート展示のコース、BOA-485）。exhibition_data の列は
// getRaceMotorMaintenanceBreakdown の1回の取得に足している（クエリ本数を増やさない）。
// DBの状態に依存しないよう、そのリクエスト（select に exhibition_course を含むもの）
// だけを page.route で差し替える
test.describe("レース詳細の直前情報タブ: 展示進入", () => {
  const RACE = "/race/2026-09-21-05-12";
  // 取得開始（2026-09-21）より前のレース。展示進入の値は1つも入っていない
  const RACE_BEFORE_START = "/race/2026-09-18-05-01";

  const row = (boat, course, extra = {}) => ({
    boat_number: boat,
    tilt: -0.5,
    adjustment_weight: 0,
    propeller_change: null,
    parts_changed: null,
    today_weight: 52.0,
    prev_race_no: null,
    prev_entry_course: null,
    prev_start_timing: null,
    prev_finish_rank: null,
    exhibition_course: course,
    is_absent: false,
    updated_at: "2026-09-21T07:12:56Z",
    ...extra,
  });

  const routeMaintenance = async (page, fulfill) => {
    await page.route("**/rest/v1/exhibition_data?*", (route) => {
      if (!route.request().url().includes("exhibition_course"))
        return route.fallback();
      return fulfill(route);
    });
  };

  const stubRows = (rows) => (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(rows),
    });

  const openBeforeInfoTab = async (page, url = RACE) => {
    await page.goto(url);
    await page.click('[role="tab"]:has-text("直前情報")');
    await expect(page.locator(".race-before-info-tab")).toBeVisible({
      timeout: 20000,
    });
  };

  const courseRow = (page) =>
    page.locator(".drt-table tbody tr").filter({
      has: page.locator(".drt-label-full", { hasText: /^展示進入$/ }),
    });

  test("枠番と違うコースに入った艇だけ強調し、内へ/外へを添え、出典を表の下に1回出す", async ({
    page,
  }) => {
    // 3号艇が5コース、4号艇が3コース、5号艇が4コース（2026-09-26 徳山7Rの実データと同じ並び）
    await routeMaintenance(
      page,
      stubRows([
        row(1, 1),
        row(2, 2),
        row(3, 5),
        row(4, 3),
        row(5, 4),
        row(6, 6),
      ]),
    );
    await openBeforeInfoTab(page);

    const cells = courseRow(page).locator("td.drt-cell");
    await expect(cells).toHaveCount(6, { timeout: 20000 });
    await expect(cells.nth(0)).toHaveText("1コース");
    await expect(cells.nth(0)).not.toHaveClass(/drt-entry-moved/);
    await expect(cells.nth(2)).toContainText("5コース");
    await expect(cells.nth(2)).toContainText("外へ");
    await expect(cells.nth(2)).toHaveClass(/drt-entry-moved/);
    await expect(cells.nth(3)).toContainText("3コース");
    await expect(cells.nth(3)).toContainText("内へ");
    await expect(page.locator(".drt-entry-moved")).toHaveCount(3);

    // ADR-0067の3点（出典・取得時刻・再配布しない旨）が1ブロックだけ
    const source = page.locator(".rbi-source");
    await expect(source).toHaveCount(1);
    await expect(source).toContainText("BOAT RACE オフィシャルウェブサイト");
    await expect(source).toContainText("9/21 16:12");
    await expect(source).toContainText("再配布はしていません");
    await expect(
      page.getByTestId("exhibition-course-out-of-range"),
    ).toHaveCount(0);
  });

  test("欠場艇は「欠場」と出し、コースの「—」と区別する", async ({ page }) => {
    await routeMaintenance(
      page,
      stubRows([
        row(1, 1),
        row(2, 2),
        row(3, 3),
        row(4, 4),
        row(5, null, { is_absent: true }),
        row(6, 5),
      ]),
    );
    await openBeforeInfoTab(page);

    const cells = courseRow(page).locator("td.drt-cell");
    await expect(cells.nth(4)).toHaveText("欠場", { timeout: 20000 });
    await expect(cells.nth(5)).toContainText("5コース");
  });

  test("取得開始前のレースでは行を出さず、表示対象外である旨を注記する", async ({
    page,
  }) => {
    await openBeforeInfoTab(page, RACE_BEFORE_START);

    await expect(page.locator(".drt-table")).toBeVisible({ timeout: 20000 });
    await expect(
      page.getByTestId("exhibition-course-out-of-range"),
    ).toBeVisible();
    await expect(courseRow(page)).toHaveCount(0);
    await expect(
      page.locator(".rbi-source", {
        hasText: "BOAT RACE オフィシャルウェブサイト",
      }),
    ).toHaveCount(0);
  });

  test("取得に失敗したら「データなし」に化けさせず、失敗を表示する", async ({
    page,
  }) => {
    await routeMaintenance(page, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "stub failure" }),
      }),
    );
    await openBeforeInfoTab(page);

    await expect(page.locator(".inline-fetch-error")).toBeVisible({
      timeout: 20000,
    });
    // 行は残る（対象期間のレース）。値は出さない
    await expect(courseRow(page)).toHaveCount(1);
    await expect(
      page.locator(".rbi-source", { hasText: "BOAT RACE" }),
    ).toHaveCount(0);
  });
});
