import { test, expect } from "../fixtures.js";

test.describe("龍神レーダー ブランドトークンのコントラスト（axe-core、ADR 0017）", () => {
  // scripts/maintenance/check-token-contrast.js はトークン単体の組み合わせを検証するが、
  // ここでは実際にレンダリングされたページで色の組み合わせに問題が無いかを検証する。
  // BOA-206でApp.css/RaceDetail.css/About.css/AccuracyDashboard.css等の未トークン化領域を
  // 解消したため、スコープをHeader/Footer/IntroBannerのみからページ全体に拡張した
  // （ページごとにルート要素のクラスが異なる=.app/.race-detail-page/.about-container等の
  // ため.include()では絞り込まず、document全体を対象にする）
  // 記事のページとホーム（最新記事のカードを出す）は題に @blog を付け、記事だけの PR の軽い組でも走らせる（BOA-929）
  const blogTag = (path) =>
    /^\/(blog(\/|$)|((en|ko|zh-TW)\/?)?$)/.test(path) ? " @blog" : "";
  const PAGES = [
    "/",
    "/about",
    "/accuracy",
    "/accuracy/history",
    "/outcome-distribution",
    "/winning-technique",
    "/races",
    "/races/2026-06-22",
    "/responsible-gambling",
    "/hit-races",
    "/privacy",
    "/terms",
    "/contact",
    "/blog",
    "/blog/race-mood-effect-guide",
    "/faq",
    "/how-to-use",
    "/profile",
    "/guide",
    "/poirot",
    "/racer/4320",
    "/racers",
  ];

  for (const path of PAGES) {
    for (const theme of ["light", "dark"]) {
      test(`${path}（${theme}テーマ）でcolor-contrast違反が無い${blogTag(path)}`, async ({
        page,
      }) => {
        const { default: AxeBuilder } = await import("@axe-core/playwright");
        await page.goto(path);
        await page.evaluate(
          (t) => localStorage.setItem("ryujin-radar-theme", t),
          theme,
        );
        await page.reload();
        await expect(page.locator(".app-header")).toBeVisible();
        // ヘッダー表示直後はSupabase由来のバッジ・カード等がまだ描画されておらず、
        // データ読み込みの速さで検査対象が変わり結果が不安定になる。
        // ポーリング等で通信が終わらないページもあるため、タイムアウトに限り検査を続行する
        await page
          .waitForLoadState("networkidle", { timeout: 15000 })
          .catch((error) => {
            if (error.name !== "TimeoutError") throw error;
          });

        const results = await new AxeBuilder({ page })
          .withRules(["color-contrast"])
          .analyze();

        expect(
          results.violations,
          JSON.stringify(results.violations, null, 2),
        ).toEqual([]);
      });
    }
  }
});

test.describe("龍神レーダー Holmesページの全タブでcolor-contrast違反が無い（BOA-208）", () => {
  // /holmesは初期表示がシャーロックタブ固定のため、上のPAGESループでは
  // ワトソン/アドラー/マイクロフト/モリアーティタブがDOMに描画されず未検証だった
  // （axe-coreは可視要素のみスキャンする）。5タブ全てをクリックして検証する
  const HOLMES_TABS = [
    "シャーロック",
    "ワトソン",
    "アドラー",
    "マイクロフト",
    "モリアーティ",
  ];

  for (const tabLabel of HOLMES_TABS) {
    for (const theme of ["light", "dark"]) {
      test(`/holmes ${tabLabel}タブ（${theme}テーマ）でcolor-contrast違反が無い`, async ({
        page,
      }) => {
        const { default: AxeBuilder } = await import("@axe-core/playwright");
        await page.goto("/holmes");
        await page.evaluate(
          (t) => localStorage.setItem("ryujin-radar-theme", t),
          theme,
        );
        await page.reload();
        await expect(page.locator(".app-header")).toBeVisible();

        if (tabLabel !== "シャーロック") {
          await page.click(`.holmes-tab:has-text("${tabLabel}")`);
          // .holmes-tab.activeはtransition-colors(300ms)で色が遷移するため、
          // クリック直後にaxeを実行すると遷移中の中間色を誤検出することがある
          await page.waitForTimeout(400);
        }
        await expect(page.locator(".holmes-detective-name")).toBeVisible();

        const results = await new AxeBuilder({ page })
          .withRules(["color-contrast"])
          .analyze();

        expect(
          results.violations,
          JSON.stringify(results.violations, null, 2),
        ).toEqual([]);
      });
    }
  }
});
