import { test, expect } from "../fixtures.js";

// ピットレポート（選手コメント）セクション（BOA-379）
// 本番の匿名公開（マイグレーション086）は画面実装の後に適用するため、DBの状態に
// 依存しないよう race_pit_reports / race_pit_comments の2エンドポイントだけを
// page.routeで差し替える（他のリクエストはそのまま通す）
test.describe("レース詳細の直前情報タブ: ピットレポート", () => {
  const G1_RACE = "/race/2026-09-21-05-12"; // 多摩川G1 12R（対象レース）
  const IPPAN_RACE = "/race/2026-08-11-01-01"; // 桐生 一般戦 1R（対象外）

  const routePitReport = async (page, { report, comments }) => {
    await page.route("**/rest/v1/race_pit_reports*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(report),
      }),
    );
    await page.route("**/rest/v1/race_pit_comments*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(comments),
      }),
    );
  };

  const openBeforeInfoTab = async (page, path) => {
    await page.goto(path);
    await page.click('[role="tab"]:has-text("直前情報")');
  };

  test("コメントがあるレースで、出典・公式リンク・コメント・★が表示される", async ({
    page,
  }) => {
    await routePitReport(page, {
      report: [
        {
          status: "published",
          target_from: 7,
          target_to: 12,
          reporter_name: "テスト レポーター",
          comment_count: 2,
          created_at: "2026-09-21T06:42:00Z",
          updated_at: null,
        },
      ],
      comments: [
        {
          boat_number: 1,
          racer_id: 4371,
          comment_text: "整備をしたけど、前半レースは良くなかった。",
          confidence_stars: 1,
          previous_race_number: 7,
        },
        {
          boat_number: 3,
          racer_id: 4573,
          comment_text: "【取材者寸評】連日の部品交換で少しずつ上向き。",
          confidence_stars: null,
          previous_race_number: null,
        },
      ],
    });
    await openBeforeInfoTab(page, G1_RACE);

    const section = page.locator(".rpr-card");
    await expect(section).toBeVisible({ timeout: 20000 });
    await expect(section).toContainText(
      "出典: BOAT RACE オフィシャルウェブサイト ピットレポート",
    );
    // レポーター名は表示しない（2026-09-23のモック承認で決定）
    await expect(section).not.toContainText("テスト レポーター");
    await expect(section.locator(".rpr-source-link")).toHaveAttribute(
      "href",
      "https://www.boatrace.jp/owpc/pc/race/pitreport?rno=12&jcd=05&hd=20260921",
    );
    await expect(section).toContainText("取得: 9/21 15:42");

    // コメントのある艇だけが並ぶ（2号艇等は行ごと出さない）
    await expect(section.locator(".rpr-comment")).toHaveCount(2);
    await expect(section).toContainText(
      "整備をしたけど、前半レースは良くなかった。",
    );
    // 自信度が付かないコメント（【取材者寸評】）では★の行を出さない
    await expect(section.locator(".rpr-confidence")).toHaveCount(1);
    await expect(section.locator(".rpr-stars-filled").first()).toHaveText("★");
    await expect(section.locator(".rpr-stars-empty").first()).toHaveText("☆☆");
  });

  test("行が無いレースでは「公開待ち」カードを出す", async ({ page }) => {
    await routePitReport(page, { report: [], comments: [] });
    await openBeforeInfoTab(page, G1_RACE);

    const section = page.locator(".rpr-card");
    await expect(section).toBeVisible({ timeout: 20000 });
    await expect(section).toContainText("まだ公開されていません");
    await expect(section.locator(".rpr-comment")).toHaveCount(0);
  });

  test("匿名に権限が無い場合（086未適用）はセクションごと出さない", async ({
    page,
  }) => {
    await page.route("**/rest/v1/race_pit_reports*", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          code: "42501",
          message: "permission denied for table race_pit_reports",
        }),
      }),
    );
    await page.route("**/rest/v1/race_pit_comments*", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          code: "42501",
          message: "permission denied for table race_pit_comments",
        }),
      }),
    );
    await openBeforeInfoTab(page, G1_RACE);

    // 直前情報タブ自体は表示されたうえで、ピットレポートだけが出ない
    await expect(page.locator(".race-before-info-tab")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator(".rpr-card")).toHaveCount(0);
  });

  test("取得エラーは「未公開」「対象外」に化けさせず再読み込みを出す", async ({
    page,
  }) => {
    await page.route("**/rest/v1/race_pit_reports*", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          message: "canceling statement due to statement timeout",
        }),
      }),
    );
    await page.route("**/rest/v1/race_pit_comments*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      }),
    );
    await openBeforeInfoTab(page, G1_RACE);

    const section = page.locator(".rpr-card");
    await expect(section).toBeVisible({ timeout: 20000 });
    await expect(section).toContainText("ピットレポートを読み込めませんでした");
    await expect(section.locator(".rpr-retry")).toBeVisible();
    await expect(section).not.toContainText("まだ公開されていません");
  });

  test("対象外のグレード（一般戦）では取得もセクションの描画もしない", async ({
    page,
  }) => {
    const pitRequests = [];
    page.on("request", (req) => {
      if (req.url().includes("race_pit_")) pitRequests.push(req.url());
    });
    await openBeforeInfoTab(page, IPPAN_RACE);

    await expect(page.locator(".race-before-info-tab")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator(".rpr-card")).toHaveCount(0);
    expect(pitRequests).toEqual([]);
  });
});

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

// この枠からの進入コース（BOA-485 案A）。旧「平均進入順」（全枠を混ぜた平均で、
// 1号艇でも3.16になっていた）を置き換えた。題材はユーザー指摘の実レース
// 2026-09-26-08-02。集計はこのレースより前に絞るので、後のレースが増えても値は動かない
test.describe("レース詳細の直前情報タブ: この枠からの進入コース", () => {
  const RACE = "/race/2026-09-26-08-02";

  const openBeforeInfoTab = async (page) => {
    await page.goto(RACE);
    await page.click('[role="tab"]:has-text("直前情報")');
    await expect(page.locator(".race-before-info-tab")).toBeVisible({
      timeout: 20000,
    });
  };

  test("艇ごとに同じ枠からの進入の横棒と枠なり%・走数を出し、平均進入順の行は出さない", async ({
    page,
  }) => {
    await openBeforeInfoTab(page);

    const card = page.getByTestId("entry-course-dist");
    await expect(card).toBeVisible({ timeout: 20000 });
    // 1号艇は1枠から常に1コース（前づけされていない）
    const boat1 = page.getByTestId("entry-course-dist-1");
    await expect(boat1).toContainText("枠なり 100%", { timeout: 30000 });
    await expect(boat1).toContainText(/1枠で\d+走/);
    await expect(boat1.locator(".ecd-seg")).toHaveCount(1);
    // 4号艇は4枠から内（2・3コース）に入ったことがある＝前づけ%が出る
    const boat4 = page.getByTestId("entry-course-dist-4");
    await expect(boat4).toContainText(/前づけ \d+%/);
    expect(await boat4.locator(".ecd-seg").count()).toBeGreaterThan(1);

    // 旧行は表から消えている
    await expect(
      page.locator(".drt-table .drt-label-full", { hasText: "平均進入順" }),
    ).toHaveCount(0);
    // 注記は集計期間の実態（2025年12月以降）を書く。「過去2年間の集計」とは言わない
    await expect(card).toContainText("2025年12月以降");
    await expect(page.locator(".rbi-note").first()).not.toContainText(
      "過去2年間の集計",
    );
  });

  test("選手の出走履歴の取得に失敗したら「出走なし」に化けさせず、再読み込みを出す", async ({
    page,
  }) => {
    // getRacerScopedRaceStats の race_results 取得（actual_course を含む）だけを落とす
    await page.route("**/rest/v1/race_results?*", (route) => {
      const url = decodeURIComponent(route.request().url());
      if (!url.includes("actual_course_1") || !url.includes("payout_win"))
        return route.fallback();
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "stub failure" }),
      });
    });
    await openBeforeInfoTab(page);

    const card = page.getByTestId("entry-course-dist");
    await expect(card.locator(".inline-fetch-error")).toBeVisible({
      timeout: 30000,
    });
    await expect(card).not.toContainText("この枠での出走なし");
    await expect(card.locator(".ecd-seg")).toHaveCount(0);
  });

  // /code-review の指摘の再現テスト（2026-09-28）。読み込み中の判定に
  // レース単位の failed を混ぜていたため、1艇が先に失敗すると、まだ取得中の
  // 他艇まで「—」になり、失敗・データなしと見分けがつかなかった
  test("1艇だけ取得に失敗しても、まだ取得中の他艇は読み込み中のまま表示する", async ({
    page,
  }) => {
    // 1号艇（登番3833）の出走履歴だけ即失敗、他の艇は応答を遅らせる
    await page.route("**/rest/v1/race_entries?*", async (route) => {
      const url = decodeURIComponent(route.request().url());
      if (!url.includes("f_count")) return route.fallback();
      if (url.includes("racer_id=eq.3833"))
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "stub failure" }),
        });
      await new Promise((resolve) => setTimeout(resolve, 15000));
      return route.fallback().catch(() => {});
    });
    await openBeforeInfoTab(page);

    const card = page.getByTestId("entry-course-dist");
    await expect(card.locator(".inline-fetch-error")).toBeVisible({
      timeout: 30000,
    });
    // 失敗した1号艇は「—」、取得中の2号艇はスケルトン
    await expect(
      page.getByTestId("entry-course-dist-1").locator(".ecd-bar-empty"),
    ).toHaveText("—");
    const skeleton = page
      .getByTestId("entry-course-dist-2")
      .locator(".drt-skeleton");
    await expect(skeleton).toBeVisible();
    // スケルトンは棒と同じ幅を占める（表セル用の2.5em固定のままだと40pxの
    // 小さな塊になり、読み込み後に行の見た目が大きく変わる）
    expect((await skeleton.boundingBox()).width).toBeGreaterThan(120);
  });
});

// 今節展示情報のオリジナル展示（BOA-473）と、連対率の桁（BOA-474）
//
// 「展示情報」表のオリジナル展示（BOA-452）は `race_id=eq.<id>` で1レース分を引き、
// 「今節展示情報」（BOA-473）は `race_id=in.(...)` で節ぶんをまとめて引く。
// 同じテーブルなのでクエリ文字列で振り分けてスタブする
test.describe("レース詳細の直前情報タブ: 今節のオリジナル展示", () => {
  const RACE = "/race/2026-09-21-05-12";

  // **要求された race_id から値を組み立てる**。選手の実際の節は実データ次第なので、
  // 固定のレースIDを返すと画面側のlookup（`${raceId}-${boatNumber}`）が空振りする。
  // 種別ごとに定数を返すので、前走も節平均も同じ値になる
  const KIND_VALUE = { 一周: 37.0, まわり足: 5.8, 直線: 7.2 };
  const meetBodyFor = (url) => {
    const ids = (decodeURIComponent(url).match(/race_id=in\.\(([^)]*)\)/) ??
      [])[1];
    if (!ids) return [];
    return ids
      .split(",")
      .map((id) => id.replace(/^"|"$/g, ""))
      .flatMap((raceId) =>
        [1, 2, 3, 4, 5, 6].flatMap((boat) =>
          Object.entries(KIND_VALUE).map(([kind, value]) => ({
            race_id: raceId,
            boat_number: boat,
            kind,
            value,
          })),
        ),
      );
  };

  const routeValues = async (page, { meet, single }) => {
    await page.route("**/rest/v1/race_original_exhibition_values*", (route) => {
      const url = route.request().url();
      const isMeet = decodeURIComponent(url).includes("race_id=in.");
      const spec = isMeet ? meet : single;
      if (spec === "forbidden") {
        return route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({
            code: "42501",
            message: "permission denied for table",
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(spec === "derive" ? meetBodyFor(url) : spec),
      });
    });
    await page.route("**/rest/v1/race_original_exhibition?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          item_labels: "一周|まわり足|直線",
          updated_at: "2026-09-21T06:42:00Z",
        }),
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

  test("節に値があると、今節一周・今節まわり足・今節直線の行が前走と平均で出る", async ({
    page,
  }) => {
    await routeValues(page, { meet: "derive", single: [] });
    await openBeforeInfoTab(page);

    // 種別ごとに定数を返しているので、前走も節平均も同じ値になる
    await expect(rowByLabel(page, "今節一周")).toBeVisible({ timeout: 30000 });
    await expect(rowByLabel(page, "今節一周")).toContainText("37.00");
    await expect(rowByLabel(page, "今節まわり足")).toContainText("5.80");
    await expect(rowByLabel(page, "今節直線")).toContainText("7.20");
    // 節に値が無い種別（半周ラップ）の行は作らない
    await expect(rowByLabel(page, "今節半周ラップ")).toHaveCount(0);
  });

  test("節に値が無ければ今節の行を出さない（「—」を並べない）", async ({
    page,
  }) => {
    await routeValues(page, { meet: [], single: [] });
    await openBeforeInfoTab(page);

    await expect(page.locator(".drt-table")).toBeVisible({ timeout: 20000 });
    await expect(rowByLabel(page, "今節一周")).toHaveCount(0);
    await expect(rowByLabel(page, "今節まわり足")).toHaveCount(0);
    await expect(rowByLabel(page, "今節直線")).toHaveCount(0);
  });

  test("匿名に権限が無い場合（096未適用）は今節の行も出さない", async ({
    page,
  }) => {
    await routeValues(page, { meet: "forbidden", single: "forbidden" });
    await openBeforeInfoTab(page);

    await expect(page.locator(".drt-table")).toBeVisible({ timeout: 20000 });
    await expect(rowByLabel(page, "今節一周")).toHaveCount(0);
    // 「展示情報」表のオリジナル展示（BOA-452）も出ない
    await expect(rowByLabel(page, "一周")).toHaveCount(0);
  });

  test("節ぶんの取得は、6選手が出揃ってから1通りのID集合でしか走らない", async ({
    page,
  }) => {
    const meetRequests = [];
    await page.route("**/rest/v1/race_original_exhibition_values*", (route) => {
      const url = decodeURIComponent(route.request().url());
      if (url.includes("race_id=in.")) meetRequests.push(url);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          url.includes("race_id=in.") ? meetBodyFor(url) : [],
        ),
      });
    });
    await openBeforeInfoTab(page);
    await expect(rowByLabel(page, "今節一周")).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(3000);

    // **HTTPの本数ではなく「要求したID集合が何通りあるか」を見る**。
    // fetchAllByIn は1000行ごとに .range() でページングするので、長い節
    // （12R×7日＝最大84レース → 84×6艇×3項目＝1,512行）では正当に2本以上になる。
    // 守りたいのは「選手ごとに投げていない」「集合が育つたびに投げ直していない」
    // ことなので、race_id=in.(...) の中身の種類が1通りであることを見る
    const distinctIdSets = new Set(
      meetRequests.map(
        (u) => (u.match(/race_id=in\.\(([^)]*)\)/) ?? [])[1] ?? "",
      ),
    );
    expect(distinctIdSets.size).toBe(1);
  });
});
