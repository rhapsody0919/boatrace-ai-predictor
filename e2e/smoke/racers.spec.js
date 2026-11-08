import { test, expect } from "../fixtures.js";

test.describe("選手一覧ページ (/racers)", () => {
  test("ハンバーガーメニューから選手一覧へ遷移できる", async ({ page }) => {
    await page.goto("/");
    await page.click(".menu-btn");
    await page.click('a.submenu-item:has-text("選手一覧")');
    await expect(page).toHaveURL(/\/racers$/);
    await expect(page.locator(".racers-page-title")).toHaveText("選手一覧");
  });

  test("級別フィルタで絞り込み、ソート・ページネーションが機能する", async ({
    page,
  }) => {
    await page.goto("/racers");
    await expect(page.locator(".racer-table tbody tr").first()).toBeVisible();

    // 級別フィルタ（A1）で絞り込むと件数が減りURLに反映される
    await page.click('.racer-filter-chip:has-text("A1")');
    await expect(page).toHaveURL(/grade=A1/);
    await expect(page.locator(".racer-filter-toolbar-foot")).toContainText(
      "が条件に一致",
    );

    // 身長列ヘッダクリックでソート方向がURLに反映される
    await page.locator(".racer-table th", { hasText: "身長" }).click();
    await expect(page).toHaveURL(/sort=height_cm/);

    // ページネーションで2ページ目に遷移できる
    const page2Btn = page.locator(".racer-pagination-btn", { hasText: "2" });
    if ((await page2Btn.count()) > 0) {
      await page2Btn.click();
      await expect(page).toHaveURL(/page=2/);
    }
  });

  test("選手一覧の行から選手個別ページへ遷移できる", async ({ page }) => {
    await page.goto("/racers");
    const firstRow = page.locator(".racer-table tbody tr").first();
    await firstRow.click();
    await expect(page).toHaveURL(/\/racer\/\d+$/);
  });

  // BOA-470: 仕様（spec.md FR4 の例 ?sort=height）と実装（height_cm）の食い違い。
  // 別名を受け付け、知らないキーは既定（勝率の降順）に戻す
  test("?sort=height（別名）で身長の降順に並ぶ（BOA-470）", async ({
    page,
  }) => {
    await page.goto("/racers?sort=height&dir=desc");
    const cells = page.locator(".racer-table tbody tr td:nth-child(3)");
    await expect(cells.first()).toBeVisible();
    const heights = (await cells.allTextContents())
      .map((t) => parseInt(t, 10))
      .filter((n) => Number.isFinite(n));
    expect(heights.length).toBeGreaterThan(5);
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeLessThanOrEqual(heights[i - 1]);
    }
    // 見出しの並び順の印も身長の列に付く
    await expect(
      page.locator(".racer-table th.is-sorted", { hasText: "身長" }),
    ).toBeVisible();
  });

  // BOA-470: 身長・体重の範囲入力で、上限欄にもアクセシブルネームがある
  test("身長・体重の下限・上限の欄に、それぞれ名前が付いている（BOA-470）", async ({
    page,
  }) => {
    await page.goto("/racers");
    for (const name of [
      "身長の下限（cm）",
      "身長の上限（cm）",
      "体重の下限（kg）",
      "体重の上限（kg）",
    ]) {
      await expect(
        page.getByRole("spinbutton", { name, exact: true }).first(),
      ).toBeAttached();
    }
  });

  // BOA-470: モバイルの行本体は href を持つ本物のリンク（新しいタブで開ける）。
  // ▼ボタンはリンクの中に入れない（操作できる要素の入れ子にしない）
  test("375px: 行本体は選手ページへのリンクで、▼はリンクの外のボタン（BOA-470）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/racers");
    const row = page.locator(".racer-compact-row").first();
    await expect(row).toBeVisible();
    await expect(row.locator("a.racer-compact-row-main")).toHaveAttribute(
      "href",
      /^\/racer\/\d+$/,
    );
    await expect(page.locator(".racer-compact-row a button")).toHaveCount(0);

    // ▼は画面遷移せずに、その行だけ展開する
    await row.locator(".racer-compact-row-chevron").click();
    await expect(page).toHaveURL(/\/racers/);
    await expect(row.locator(".racer-compact-row-detail")).toBeVisible();
    await expect(
      page
        .locator(".racer-compact-row")
        .nth(1)
        .locator(".racer-compact-row-detail"),
    ).toHaveCount(0);

    // 行本体のタップで選手ページへ
    await row.locator("a.racer-compact-row-main").click();
    await expect(page).toHaveURL(/\/racer\/\d+$/);
  });
});

test.describe("選手個別ページ（racer-news-feature）", () => {
  test("ニュース掲載済み選手のページで基本情報・ニュース・noindex解除を確認", async ({
    page,
  }) => {
    await page.goto("/racer/4320");
    await expect(page).toHaveTitle(/峰竜太.+龍神レーダー$/);
    await expect(page.locator(".racer-profile-header h1")).toHaveText("峰竜太");
    await expect(page.locator(".racer-news-item h3").first()).toBeVisible();
    const robots = await page.evaluate(() =>
      document.querySelector('meta[name="robots"]')?.getAttribute("content"),
    );
    expect(robots).not.toContain("noindex");
  });

  test("プロフィール未取得の選手ページで空状態表示・noindexを確認", async ({
    page,
  }) => {
    await page.goto("/racer/3081");
    await expect(page.locator(".racer-profile-card-empty")).toBeVisible();
    await expect(page.locator(".racer-news-list-empty")).toBeVisible();
    const robots = await page.evaluate(() =>
      document.querySelector('meta[name="robots"]')?.getAttribute("content"),
    );
    expect(robots).toContain("noindex");
  });

  test("データ分析ツールの好調・不調選手ランキングから選手ページへ遷移できる", async ({
    page,
  }) => {
    await page.goto("/winning-technique");
    await page.click('button:has-text("好調・不調選手ランキング")');
    // Supabaseからのデータ取得に数秒かかるため、テーブル見出しの表示を先に待つ
    await expect(page.getByRole("heading", { name: /急上昇選手/ })).toBeVisible(
      { timeout: 15000 },
    );
    const firstRacerLink = page.locator('a[href^="/racer/"]').first();
    await expect(firstRacerLink).toBeVisible();
    await firstRacerLink.click();
    await expect(page).toHaveURL(/\/racer\/\d+$/);
    await expect(page.locator(".racer-profile-header h1")).toBeVisible();
  });
});
