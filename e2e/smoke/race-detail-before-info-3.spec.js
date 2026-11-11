// 旧 e2e/smoke.spec.js から切り出しスクリプトで移した（CI02。題・中身は元のまま、import の相対の字だけ1段深くした）
import { test, expect } from "../fixtures.js";

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
