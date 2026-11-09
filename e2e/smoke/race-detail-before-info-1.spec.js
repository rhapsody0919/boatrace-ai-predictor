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
