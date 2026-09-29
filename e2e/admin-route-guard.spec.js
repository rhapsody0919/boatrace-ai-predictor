import { test, expect } from "./fixtures.js";

// 管理画面は middleware.js の Basic 認証で守る（BOA-555）。Vercel の matcher は生のURLで
// 照合するが、React Router はデコード後・大文字小文字を区別せずに照合するため、
// /admin/rule%73 や /ADMIN/RULES は認証を通らずに index.html が返り、そのまま管理画面を
// 描画できてしまう。AdminRouteGuard が綴り違いをトップへ戻すことを固定する。
// dev サーバーでは middleware が走らないので、ここで見るのはクライアント側の振る舞いだけ。
test.describe("管理画面の綴り違いURL", () => {
  // /admin/rules は表示時に predictions を全件ページングする（ga-pageview.spec.js 参照）。
  // このテストは描画されるかだけを見るので空で返す
  test.beforeEach(async ({ page }) => {
    await page.route(/\/rest\/v1\/predictions\?/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      }),
    );
  });

  const ADMIN_HEADING = "ルール成績ダッシュボード";

  test("正規の /admin/rules は描画する", async ({ page }) => {
    await page.goto("/admin/rules");
    await expect(
      page.getByRole("heading", { name: ADMIN_HEADING }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/rules$/);
  });

  for (const path of [
    "/ADMIN/RULES",
    "/Admin/Rules",
    "/admin/rule%73",
    "/%61dmin/rules",
    "/admin/SNS-HUB",
    "/admin/sns-h%75b",
  ]) {
    test(`${path} は管理画面を描画せずトップへ戻す`, async ({
      page,
      baseURL,
    }) => {
      await page.goto(path);
      await expect(page).toHaveURL(`${baseURL}/`);
      await expect(
        page.getByRole("heading", { name: ADMIN_HEADING }),
      ).toHaveCount(0);
    });
  }
});
