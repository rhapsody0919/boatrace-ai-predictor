import { test, expect } from "@playwright/test";

test.describe("ホーム・基本ナビゲーション", () => {
  test("トップページが表示され、主要ナビが機能する", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-header")).toBeVisible();
    await expect(page.locator(".logo h1")).toHaveText("龍神レーダー");
  });

  test("ThemeToggleでライト/ダークを切替でき、リロード後も永続化される（BOA-201）", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("ryujin-radar-theme"));
    await page.reload();

    // ThemeToggleは2026-09-08〜ハンバーガーメニュー内に移設（常時表示のnavには
    // 検索・データ分析ツールのみを残し、モバイル幅でのアイコン折り返しを防ぐため）
    await page.click(".menu-btn");
    const toggle = page.locator(".theme-toggle");
    await expect(toggle).toBeVisible();

    await toggle.click();
    const themeAfterClick = await page.evaluate(
      () => document.documentElement.dataset.theme,
    );
    expect(["light", "dark"]).toContain(themeAfterClick);

    // リロード後もFOUC防止スクリプトにより同じテーマが即座に反映される
    await page.reload();
    const themeAfterReload = await page.evaluate(
      () => document.documentElement.dataset.theme,
    );
    expect(themeAfterReload).toBe(themeAfterClick);

    // 再クリックで反対のテーマに戻ることを確認（リロードでメニューが閉じるため再度開く）
    await page.click(".menu-btn");
    await page.locator(".theme-toggle").click();
    const themeAfterSecondClick = await page.evaluate(
      () => document.documentElement.dataset.theme,
    );
    expect(themeAfterSecondClick).not.toBe(themeAfterClick);

    await page.evaluate(() => localStorage.removeItem("ryujin-radar-theme"));
  });

  test("日本語(ja)のハンバーガーメニューには会場ガイドが表示されない", async ({
    page,
  }) => {
    await page.goto("/");
    await page.click(".menu-btn");
    await expect(page.locator(".submenu")).toBeVisible();
    await expect(
      page.locator('a.submenu-item:has-text("会場ガイド")'),
    ).toHaveCount(0);
  });
});

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
    // Cookie同意バナー（position:fixed、z-index:9999）がページ下部の
    // ページネーションと重なりクリックを阻害するため、既定済みとして進める
    await page.addInitScript(() => {
      localStorage.setItem("boatai:cookie-consent", "accepted");
    });
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
});

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

test.describe("言語切替 (回帰: 対応外言語クリックでホームに飛ばされない)", () => {
  test("/en/venues で対応外言語(日本語)ボタンは無効化され、クリックしても遷移しない", async ({
    page,
  }) => {
    // 会場ガイドはja非対応（en/zh-TW/koの3言語フルセット、2026-08-11時点）
    // LanguageSwitcherは2026-09-08〜ハンバーガーメニュー内に移設
    await page.goto("/en/venues");
    await page.click(".menu-btn");
    await page.locator(".language-switcher-trigger").click();
    const jaBtn = page.locator('.language-switcher-option:has-text("日本語")');
    await expect(jaBtn).toBeVisible();
    await expect(jaBtn).toHaveAttribute("aria-disabled", "true");
    await expect(jaBtn).toHaveClass(/unavailable/);
    // aria-disabled はネイティブ disabled と異なりクリック自体は可能なため force で実クリックを再現
    await jaBtn.click({ force: true });
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/\/en\/venues$/);
  });

  test("/en/venues で対応言語(繁體中文・韓国語)ボタンは正しく遷移する", async ({
    page,
  }) => {
    await page.goto("/en/venues");
    await page.click(".menu-btn");
    await page.locator(".language-switcher-trigger").click();
    const zhBtn = page.locator(
      '.language-switcher-option:has-text("繁體中文")',
    );
    await zhBtn.click();
    await expect(page).toHaveURL(/\/zh-TW\/venues$/);

    // 言語切替のページ遷移でハンバーガーメニューが閉じるため再度開く
    await page.click(".menu-btn");
    await page.locator(".language-switcher-trigger").click();
    const koBtn = page.locator('.language-switcher-option:has-text("한국어")');
    await koBtn.click();
    await expect(page).toHaveURL(/\/ko\/venues$/);
  });
});

test.describe("多言語: 未翻訳パスのjaリダイレクト", () => {
  test("未翻訳ページ（/en/faq等）はja版へリダイレクトされlang=jaで配信される", async ({
    page,
  }) => {
    await page.goto("/en/faq");
    await expect(page).toHaveURL(/\/faq$/);
    // lang属性はLanguageSyncのeffectで非同期に同期されるためポーリングで待つ
    await expect
      .poll(() => page.evaluate(() => document.documentElement.lang))
      .toBe("ja");
  });

  test("翻訳済みページ（/en/guide）はリダイレクトされずlang=enで配信される", async ({
    page,
  }) => {
    await page.goto("/en/guide");
    await expect(page).toHaveURL(/\/en\/guide$/);
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang).toBe("en");
  });
});

test.describe("ブログ英語版（部分翻訳、blog-i18n）", () => {
  test("/en/blog は英語版が存在する記事のみ一覧表示される（ja版全件より少ない件数）", async ({
    page,
  }) => {
    await page.goto("/en/blog");
    await expect(page).toHaveURL(/\/en\/blog$/);
    const enCards = page.locator(".blog-card");
    await expect(enCards.first()).toBeVisible();
    const enCount = await enCards.count();
    expect(enCount).toBeGreaterThan(0);

    await page.goto("/blog");
    const jaCount = await page.locator(".blog-card").count();
    // フィルタが機能していれば英語版件数はja版全件より必ず少ない
    // （全件一致は「フィルタが効いていない」回帰を示す）
    expect(enCount).toBeLessThan(jaCount);
  });

  test("英語版がある記事は/en/blog/{id}でリダイレクトされずに表示される", async ({
    page,
  }) => {
    await page.goto("/en/blog/odds-expected-value-guide");
    await expect(page).toHaveURL(/\/en\/blog\/odds-expected-value-guide$/);
    await expect(page.locator(".blog-post-header h1")).toContainText(
      "How Odds Work",
    );
  });

  test("英語版が無い記事は/en/blog/{id}でja版へリダイレクトされる", async ({
    page,
  }) => {
    await page.goto("/en/blog/why-you-lose");
    await expect(page).toHaveURL(/\/blog\/why-you-lose$/);
    await expect(page).not.toHaveURL(/^\/en\//);
  });
});

test.describe("その他の主要ページ", () => {
  test("ブログ一覧が表示される", async ({ page }) => {
    await page.goto("/blog");
    await expect(page.locator(".app-header")).toBeVisible();
  });

  test("存在しないパスはトップページにリダイレクトされる", async ({ page }) => {
    await page.goto("/this-path-does-not-exist");
    await expect(page).toHaveURL("/");
  });
});

test.describe("データ分析ツール（BOA-150/151/152）", () => {
  test("ハンバーガーメニューからデータ分析ツールへ遷移できる", async ({
    page,
  }) => {
    // ブラウザのロケール検出でenへリダイレクトされるのを防ぎ、jaを固定する
    await page.addInitScript(() =>
      localStorage.setItem("boatai-language", "ja"),
    );
    await page.goto("/");
    await page.click(".menu-btn");
    const link = page.locator('a.submenu-item:has-text("データ分析ツール")');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/winning-technique");
    await link.click();
    await expect(page).toHaveURL(/\/winning-technique$/);
  });

  test("/winning-technique が表示される（データ未投入でも空状態を表示）", async ({
    page,
  }) => {
    await page.goto("/winning-technique");
    await expect(page.locator(".app-header")).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: /データ分析ツール/ }),
    ).toBeVisible();
  });

  test("出目分布タブが表示される（BOA-152: 旧/outcome-distributionを統合）", async ({
    page,
  }) => {
    await page.goto("/winning-technique");
    await page.click('.analysis-tab-btn:has-text("出目分布")');
    await expect(page.locator(".outcome-distribution-container")).toBeVisible({
      timeout: 10000,
    });
  });

  test("旧/outcome-distributionは会場指定を保ったままデータ分析ツールへリダイレクトされる（BOA-152）", async ({
    page,
  }) => {
    await page.goto("/outcome-distribution?venue_code=4");
    await expect(page).toHaveURL(
      /\/winning-technique\?venue_code=4&tab=outcome/,
    );
    await expect(
      page.locator('.analysis-tab-btn:has-text("出目分布")'),
    ).toHaveClass(/active/);
    await expect(page.locator(".outcome-distribution-container")).toBeVisible({
      timeout: 10000,
    });
  });

  test("モーター調子タブで本日のレースの枠番別モーター調子→クリックで推移グラフに切り替わる（BOA-151）", async ({
    page,
  }) => {
    await page.goto("/winning-technique");
    await page.click('.analysis-tab-btn:has-text("モーター調子")');
    const breakdown = page.locator(".motor-ranking-row");
    await expect(breakdown.first()).toBeVisible({ timeout: 10000 });
    await expect(breakdown).toHaveCount(6); // 6艇分
    await breakdown.first().click();
    await expect(page.locator(".back-to-ranking-btn")).toBeVisible();
    // BOA-265で展示タイム推移・使用履歴グラフが追加され2連率/3連率グラフと合わせて
    // 最大3つになりうるが、使用履歴・展示タイムは実データの有無で0〜2個の幅がある
    // ため、固定数ではなく「最低限2連率/3連率グラフは出る」の下限のみ検証する
    await expect(async () => {
      expect(
        await page.locator(".recharts-wrapper").count(),
      ).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 10000 });
  });

  test("選手調子タブで本日のレースの枠番別勝率変化→クリックで推移グラフに切り替わる（BOA-152）", async ({
    page,
  }) => {
    await page.goto("/winning-technique");
    await page.click('.analysis-tab-btn:has-text("選手調子")');
    const rows = page.locator(".motor-ranking-row");
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    await expect(rows).toHaveCount(6);
    await rows.first().click();
    await expect(page.locator(".back-to-ranking-btn")).toBeVisible();
    await expect(page.locator(".recharts-wrapper")).toBeVisible({
      timeout: 10000,
    });
  });

  test("STのズレタブで本日のレースの枠番別ズレ実績→クリックで推移グラフに切り替わる（BOA-153）", async ({
    page,
  }) => {
    await page.goto("/winning-technique");
    await page.click('.analysis-tab-btn:has-text("STのズレ")');
    const rows = page.locator(".motor-ranking-row");
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    await expect(rows).toHaveCount(6);
    await rows.first().click();
    await expect(page.locator(".back-to-ranking-btn")).toBeVisible();
    await expect(page.locator(".recharts-wrapper")).toBeVisible({
      timeout: 10000,
    });
  });

  test("トップスタートタブが表示される（BOA-154: データ未投入でも空状態を表示）", async ({
    page,
  }) => {
    await page.goto("/winning-technique");
    await page.click('.analysis-tab-btn:has-text("トップスタート")');
    await expect(page.locator(".winning-technique-container")).toBeVisible({
      timeout: 10000,
    });
    // マイグレーション未適用の場合は空状態、適用済みならテーブルが表示される
    await expect(
      page.locator(".empty-state, .winning-technique-table"),
    ).toBeVisible({ timeout: 10000 });
  });

  test("負け決まり手タブが表示される（BOA-157: データ未投入でも空状態を表示）", async ({
    page,
  }) => {
    await page.goto("/winning-technique");
    await page.click('.analysis-tab-btn:has-text("負け決まり手")');
    await expect(page.locator(".winning-technique-container")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.locator(".empty-state, .winning-technique-table"),
    ).toBeVisible({ timeout: 10000 });
  });

  test("逃げ成功時分布タブが表示される（BOA-158: データ未投入でも空状態を表示）", async ({
    page,
  }) => {
    await page.goto("/winning-technique");
    await page.click('.analysis-tab-btn:has-text("逃げ成功時分布")');
    await expect(page.locator(".outcome-distribution-container")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator(".empty-state, .top-patterns-table")).toBeVisible(
      { timeout: 10000 },
    );
  });

  test("展示タイムタブが表示される（BOA-160: データ未投入でも空状態を表示）", async ({
    page,
  }) => {
    await page.goto("/winning-technique");
    await page.click('.analysis-tab-btn:text-is("⏲️ 展示タイム")');
    await expect(page.locator(".winning-technique-container")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.locator(".empty-state, .winning-technique-table"),
    ).toBeVisible({ timeout: 10000 });
  });

  test("選手別展示タイム推移タブで本日のレースの推移一覧→クリックで推移グラフに切り替わる（BOA-164）", async ({
    page,
  }) => {
    await page.goto("/winning-technique");
    await page.click('.analysis-tab-btn:text-is("📈 展示タイム推移")');
    await expect(page.locator(".motor-condition-container")).toBeVisible({
      timeout: 10000,
    });
    // マイグレーション不要のためデータは常に存在するはずだが、
    // 本日開催中のレースが無い環境でも空状態を許容する
    await expect(
      page.locator(".empty-state, .motor-ranking-row").first(),
    ).toBeVisible({
      timeout: 15000,
    });

    const rowCount = await page.locator(".motor-ranking-row").count();
    if (rowCount > 0) {
      await page.locator(".motor-ranking-row").first().click();
      await expect(page.locator(".selected-motor-heading")).toBeVisible({
        timeout: 10000,
      });
    }
  });

  test("選手別決まり手傾向タブが表示される（BOA-165）", async ({ page }) => {
    await page.goto("/winning-technique");
    await page.click('.analysis-tab-btn:text-is("🏆 選手別決まり手傾向")');
    await expect(page.locator(".motor-condition-container")).toBeVisible({
      timeout: 10000,
    });
    // 本日開催中のレースが無い環境でも空状態を許容する
    await expect(
      page.locator(".empty-state, .motor-ranking-row").first(),
    ).toBeVisible({
      timeout: 15000,
    });
  });

  test("本日の好調・不調選手ランキングタブが表示される（BOA-166）", async ({
    page,
  }) => {
    await page.goto("/winning-technique");
    await page.click(
      '.analysis-tab-btn:text-is("🔥 好調・不調選手ランキング")',
    );
    await expect(page.locator(".motor-condition-container")).toBeVisible({
      timeout: 10000,
    });
    // 本日開催中のレースが無い環境でも空状態を許容する
    await expect(
      page.locator(".empty-state, .motor-ranking-row").first(),
    ).toBeVisible({
      timeout: 15000,
    });
  });

  test("選手×艇番別 回収率分析タブが表示される（BOA-167）", async ({
    page,
  }) => {
    await page.goto("/winning-technique");
    await page.click('.analysis-tab-btn:text-is("💰 回収率分析")');
    await expect(page.locator(".motor-condition-container")).toBeVisible({
      timeout: 10000,
    });
    // 本日開催中のレースが無い環境でも空状態を許容する
    await expect(
      page.locator(".empty-state, .motor-ranking-row").first(),
    ).toBeVisible({
      timeout: 15000,
    });
  });

  test("会場ランキングタブが表示される（BOA-171/BOA-267）", async ({
    page,
  }) => {
    await page.goto("/winning-technique");
    await page.click('.analysis-tab-btn:text-is("🏟️ 会場ランキング")');
    await expect(page.locator(".motor-condition-container")).toBeVisible({
      timeout: 10000,
    });
    // 本日開催中のレースが無い、または結果確定レースが無い環境でも空状態を許容する。
    // 集計に複数クエリを要し、日本国内からの実測は約4秒だがCI(海外ランナー→本番DB)では
    // 15秒を超えて失敗したため、この待ちだけ長めにする
    await expect(
      page.locator(".empty-state, .motor-ranking-row").first(),
    ).toBeVisible({
      timeout: 30000,
    });
  });

  test("会場×グレード分析タブが表示される（BOA-263）", async ({ page }) => {
    await page.goto("/winning-technique");
    await page.click('.analysis-tab-btn:text-is("📊 会場×グレード分析")');
    await expect(page.locator(".motor-condition-container")).toBeVisible({
      timeout: 10000,
    });
    // 会場・指標のセレクタが表示される
    await expect(page.locator("#venue-grade-venue-select")).toBeVisible();
    await expect(page.locator("#venue-grade-metric-select")).toBeVisible();
    // venue_grade_boat_stats未集計（マイグレーション未適用）の環境では
    // エラー状態になる（getVenueGradeBoatStatsはエラーを握りつぶさずthrowする
    // 設計のため）。マイグレーション適用後は空状態またはデータ表示になるため、
    // いずれの環境でも通るよう3状態を許容する
    await expect(
      page.locator(".empty-state, .motor-ranking-table, .error-state").first(),
    ).toBeVisible({ timeout: 15000 });
    // 指標を切り替えてもクラッシュしない
    await page.selectOption("#venue-grade-metric-select", "manshuRate");
    await expect(
      page.locator(".empty-state, .motor-ranking-table, .error-state").first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test("会場・レース・タブ指定のディープリンクで直接開ける（BOA-152）", async ({
    page,
  }) => {
    await page.goto(
      "/winning-technique?venue_code=4&race_id=2026-07-30-04-01&tab=racer",
    );
    await expect(
      page.locator('.analysis-tab-btn:has-text("選手調子")'),
    ).toHaveClass(/active/);
    await expect(page.locator(".motor-ranking-row").first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("トップページ（開催場一覧）からデータ分析ツールへの導線がある（BOA-152）", async ({
    page,
  }) => {
    // venue-list-redesign: / は開催場一覧 → 会場別レース一覧 → /race/:raceId の3階層
    await page.goto("/");
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();
    await expect(page).toHaveURL(/\/race\//);
    const link = page.locator(".analysis-tools-link");
    await expect(link).toBeVisible({ timeout: 10000 });
    await link.click();
    await expect(page).toHaveURL(/\/winning-technique\?/);
    await expect(page.locator(".motor-ranking-row").first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("過去アーカイブ（/races/）にはデータ分析ツールへの導線が無い（本日開催中の会場のみ対応のため）", async ({
    page,
  }) => {
    await page.goto("/races/2026-07-13");
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();
    await expect(page).toHaveURL(/\/race\//);
    // 結果確定済みレースは「結果」タブがデフォルト表示され、データ出走表は
    // 結果タブ表示中は隠れる（フィードバック#7）ため、基本情報タブへ切り替える
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator(".analysis-tools-link-section")).toHaveCount(0);
  });

  test("/races/{本日}には導線がある（本日開催中のレースのため機能する）", async ({
    page,
  }) => {
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    await page.goto(`/races/${today}`);
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();
    const link = page.locator(".analysis-tools-link");
    await expect(link).toBeVisible({ timeout: 10000 });
    await link.click();
    await expect(page).toHaveURL(/\/winning-technique\?/);
    await expect(page.locator(".motor-ranking-row").first()).toBeVisible({
      timeout: 10000,
    });
  });
});

test.describe("開催場一覧ページ（venue-list-redesign）", () => {
  test("トップページに24会場のグリッドが固定表示される", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".venue-grid")).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".venue-grid-card")).toHaveCount(24);
  });

  test("会場一覧→レース一覧→レース詳細と遷移し、URLがディープリンク可能", async ({
    page,
  }) => {
    await page.goto("/races/2026-08-11");
    await expect(page.locator(".venue-grid-card")).toHaveCount(24);

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
    // BOA-304で部品交換の行を追加したため16→17行になる
    // （直前情報タブへの分離はDataRaceTable専用のbuildBasicIndicatorRows経由のみで、
    // このカードは従来通りbuildIndicatorRows＝全指標を使うため件数は変わらず増える）
    expect(expandedLabels.length).toBe(17);
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
  const todayJST = () =>
    new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split("T")[0];

  const predictionCacheKeys = (page) =>
    page.evaluate(() =>
      Object.keys(localStorage).filter((k) =>
        k.startsWith("boatai:predictions-"),
      ),
    );

  const mockEdgeRaces = (date) => ({
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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

test.describe("レースページ再設計（BOA-168）", () => {
  test("トップページでレース選択→データ出走表と「AI予想」タブ（展開予測/イン崩れ）が表示される（BOA-346）", async ({
    page,
  }) => {
    // ブラウザのロケール検出でenへリダイレクトされるのを防ぎ、jaを固定する
    // （「⏱️ 終了」フィルタは日本語文言依存のため、ja固定が無いと終了済みレースが
    // 誤って選ばれうる。2026-08-14: 実行時刻経過で1Rが結果確定した際に顕在化）
    await page.addInitScript(() =>
      localStorage.setItem("boatai-language", "ja"),
    );
    // AIデータ分析（展開予測/イン崩れ）は未来志向のUIのため結果確定済みレースでは
    // 表示しない仕様（2026-08-14）。開催場一覧の「次 XR」表示がある会場＝未消化レースが
    // 残っている会場の最終レース（12R側）を選ぶことで未終了レースを確実に引く
    const found = await selectUpcomingRace(page);
    test.skip(
      !found,
      "本日開催中の未終了レースが見つからないため検証をスキップ",
    );

    // データ出走表が主役として表示される（基本情報タブがデフォルト）
    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 15000,
    });

    // AIデータ分析（展開予測/イン崩れ/出現パターン）はBOA-346で独立タブ「AI予想」に
    // 格上げされた（旧AiAnalysisSectionの折りたたみは廃止、タブ選択自体が開閉を兼ねる）
    await page.locator(".race-tabs-btn", { hasText: "AI予想" }).click();
    await expect(page.locator(".prediction-result")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator(".ai-analysis-header")).toHaveCount(0);
  });

  test("この会場の枠番別傾向パネルがデフォルト展開で表示され、折りたたみ操作ができる（race-detail-analysis-integration）", async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem("boatai-language", "ja"),
    );
    const found = await selectUpcomingRace(page);
    test.skip(
      !found,
      "本日開催中の未終了レースが見つからないため検証をスキップ",
    );

    const panel = page.locator(".venue-tendency-panel");
    await expect(panel).toBeVisible({ timeout: 15000 });

    // デフォルト展開: 4行（決まり手/トップスタート率/負け決まり手/展示最速転換率）×6艇
    const content = panel.locator(".vtp-content");
    await expect(content).toBeVisible({ timeout: 10000 });
    await expect(panel.locator(".vtp-table tbody tr")).toHaveCount(4);
    await expect(panel.locator(".vtp-table thead th.vtp-boat-th")).toHaveCount(
      6,
    );

    // ヘッダクリックで折りたたみ、再クリックで再展開できる
    await panel.locator(".vtp-header").click();
    await expect(content).toHaveCount(0);
    await panel.locator(".vtp-header").click();
    await expect(panel.locator(".vtp-content")).toBeVisible({
      timeout: 10000,
    });
  });

  test("分析ツール6コンポーネントの埋め込みセクションがデフォルト閉で並び、開くと会場/レース選択プルダウン無しで実データが表示される（race-detail-analysis-integration FR-3〜9）", async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem("boatai-language", "ja"),
    );
    const found = await selectUpcomingRace(page);
    test.skip(
      !found,
      "本日開催中の未終了レースが見つからないため検証をスキップ",
    );

    // 「モーター調子」はBOA-308でアコーディオンからモータ情報タブへ昇格し、
    // 重複表示を避けてアコーディオン版が撤去された（PredictionPanel.jsx冒頭の
    // コメント参照）。テストが7個のまま取り残されていたが、selectUpcomingRaceが
    // 常にfalseを返して無言でskipしていたため検知できていなかった
    const sections = page.locator(".embedded-analysis-section");
    await expect(sections).toHaveCount(6);

    const expectedTitles = [
      "選手調子",
      "STのズレ",
      "展示タイム推移",
      "選手別決まり手傾向",
      "回収率分析",
      "超展開データ",
    ];
    for (const title of expectedTitles) {
      await expect(sections.filter({ hasText: title })).toHaveCount(1);
    }

    // デフォルトは全セクション閉（中身は一切マウントされない）
    await expect(page.locator(".eas-content")).toHaveCount(0);

    // 1つずつ開いて、会場/レース選択プルダウンが無いこと・中身が表示されることを確認し、
    // 閉じたら再びアンマウントされることを確認する
    const count = await sections.count();
    for (let i = 0; i < count; i++) {
      const section = sections.nth(i);
      await section.locator(".eas-header").click();
      const content = section.locator(".eas-content");
      await expect(content).toBeVisible({ timeout: 15000 });
      await expect(content.locator(".controls-section")).toHaveCount(0);
      await expect(content.locator("h2")).toHaveCount(0);
      await section.locator(".eas-header").click();
      await expect(content).toHaveCount(0);
    }
  });

  test("過去日・結果確定済みレースのモータ情報タブが、無関係な「本日開催」レースにフォールバックせず当該レースのデータを表示する（race-detail-analysis-integration 回帰確認）", async ({
    page,
  }) => {
    // 過去日は「本日開催中の会場」一覧に含まれないため、embedded対応前は
    // getVenuesWithTodaysRaces()のフォールバック（list[0]）により無関係なレースの
    // データが無警告表示されていた。DataRaceTableの選手名と、モータ情報タブ
    // （BOA-308、既存のMotorConditionChartをタブ化したもの）が表示する
    // 選手名が一致することを確認する
    await page.goto("/races/2026-08-11");
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();
    await expect(page).toHaveURL(/\/race\/2026-08-11-\d{2}-\d{2}$/);

    // 結果確定済みレースはタブ構成（BOA-305〜312）で「結果」タブがデフォルト
    // 表示される。DataRaceTable等の分析ツール群は結果タブ表示中は隠れる
    // （フィードバック#7）ため、基本情報タブへ切り替えてから確認する
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 15000,
    });
    const expectedNames = (
      await page.locator(".drt-name-th").allTextContents()
    ).map((n) => n.trim());
    expect(expectedNames.length).toBe(6);

    // モータ情報タブはアコーディオンではなく独立タブのため、クリックで
    // 直接切り替わる（BOA-308でEmbeddedAnalysisSectionのアコーディオン版は撤去済み）
    await page.locator(".race-tabs-btn", { hasText: "モータ情報" }).click();
    const motorSection = page.locator(".race-tabs-panel");
    await expect(motorSection.locator(".motor-ranking-row")).toHaveCount(6, {
      timeout: 15000,
    });
    const actualNames = (
      await motorSection
        .locator(".motor-ranking-row td:nth-child(2)")
        .allTextContents()
    ).map((n) => n.trim());
    expect(new Set(actualNames)).toEqual(new Set(expectedNames));
  });

  test("出現パターンプレビューの出現率が、本命艇が1着だった場合を分母にした値になっている（回帰確認）", async ({
    page,
  }) => {
    // 修正前は会場全体のレース数を分母にしており、本命艇の勝率が高い会場ほど
    // 実際より小さい数値になっていた（例: 勝率55%の艇なら実際の約半分）。
    // 各行の「出現回数 ÷ (出現率/100)」で逆算した分母が、同じ艇の行同士で
    // ほぼ一致することを確認する（全行が同じ分母＝該当艇の1着回数を使っている証拠）
    const found = await selectUpcomingRace(page);
    test.skip(
      !found,
      "本日開催中の未終了レースが見つからないため検証をスキップ",
    );

    // AI予想タブ（本命艇の予想確定後に描画される、BOA-346で独立タブ化）の読み込みを待つ
    const aiPredictionTabBtn = page.locator(".race-tabs-btn", {
      hasText: "AI予想",
    });
    try {
      await aiPredictionTabBtn.waitFor({ timeout: 15000 });
      await aiPredictionTabBtn.click();
      await page.locator(".prediction-result").waitFor({ timeout: 15000 });
    } catch {
      test.skip(true, "AI予想タブが表示されないレースのため検証をスキップ");
      return;
    }

    const previewButton = page.locator(".expand-button", {
      hasText: "コースが1着の場合の出現パターン",
    });
    if ((await previewButton.count()) === 0) {
      test.skip(true, "このレースには出現パターンプレビューが表示されない");
      return;
    }
    await previewButton.click();

    const rows = page.locator(".pattern-table tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 15000 });
    const rowCount = await rows.count();
    test.skip(rowCount < 2, "比較に十分な行数が無いため検証をスキップ");

    const impliedDenominators = [];
    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const count = Number(
        (await row.locator("td.count").textContent()).trim(),
      );
      const rateText = (
        await row.locator("td.probability").textContent()
      ).trim();
      const rate = Number(rateText.replace("%", ""));
      expect(rate).toBeGreaterThan(0);
      impliedDenominators.push(count / (rate / 100));
    }

    const maxDenom = Math.max(...impliedDenominators);
    const minDenom = Math.min(...impliedDenominators);
    // 丸め誤差を許容しつつ、全行が同じ分母を使っていることを確認する
    expect(maxDenom - minDenom).toBeLessThan(maxDenom * 0.05);
  });

  test("過去日付ページで結果確定レースを選ぶと結果タブに着順・配当・決まり手が表示され、展開予測検証はAI予想タブに表示される（BOA-312/BOA-346）", async ({
    page,
  }) => {
    // unifiedモデル運用開始日（2026-08-11〜）以降の日付を使う。
    // それより前の日付はAI予想（topPick）が存在せず.race-resultが出ない仕様のため
    await page.goto("/races/2026-08-11");
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();

    // 結果確定済みレースはタブ構成（BOA-305〜312）で「結果」タブがデフォルト表示される。
    // BOA-346で展開予測検証・イン崩れ指数の答え合わせは「AI予想」タブへ移設されたため、
    // 結果タブ（RaceResult）は着順・配当・決まり手のみのシンプルな内容になった
    await expect(
      page.locator(".race-tabs-btn.is-active", { hasText: "結果" }),
    ).toBeVisible({ timeout: 20000 });
    await expect(page.locator(".race-result")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator(".race-result .turn-pattern-list")).toHaveCount(
      0,
    );

    // データ出走表等の分析ツール群は結果タブ表示中は隠れる（フィードバック#7）が、
    // 基本情報タブに切り替えれば過去日付でも表示されることを確認する
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 15000,
    });

    // 展開予測検証（実測精度）・イン崩れ指数の答え合わせはAI予想タブに移設されている（BOA-346）
    await page.locator(".race-tabs-btn", { hasText: "AI予想" }).click();
    await expect(page.locator(".turn-pattern-list")).toBeVisible({
      timeout: 20000,
    });

    // 「データで振り返る」（RaceReview）はBOA-312で撤去済み。的中/不的中の検証は
    // 上記のAI予想タブ（RaceAiPredictionTab）に統合されている
    await expect(page.locator(".race-review")).toHaveCount(0);
    // 旧AiAnalysisSection（折りたたみ）はBOA-346で独立タブ化に伴い撤去済み
    await expect(page.locator(".ai-analysis-header")).toHaveCount(0);
  });

  test("この日の水面傾向が結果タブ（払戻の下）と会場ページに出て、直前情報タブからは消えている（BOA-222 / phase a T4-1〜T4-4）", async ({
    page,
  }) => {
    await page.goto("/races/2026-08-11");
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();

    // 結果確定済みレースは「結果」タブが既定で開く
    await expect(page.locator(".vds-card")).toBeVisible({ timeout: 25000 });
    // 見出し・注記は開催日基準（過去日のレースで「本日」と書かない）
    await expect(page.locator(".vds-heading")).not.toContainText("本日");
    await expect(page.locator(".vds-note")).not.toContainText("本日");
    // ラベルは実装（艇番基準）に合わせた「1号艇の逃げ率」。「イン逃げ率」ではない
    await expect(page.locator(".vds-stat-label")).toHaveCount(3);
    await expect(page.locator(".vds-card")).toContainText("1号艇の逃げ率");
    await expect(page.locator(".vds-card")).not.toContainText("イン逃げ率");

    // 払戻より後ろ（結果タブの最下部）に置かれている
    const cardAfterPayout = await page.evaluate(() => {
      const root = document.querySelector(".race-result");
      const payout = root?.querySelector(".rr-payout-table");
      const card = root?.querySelector(".vds-card");
      if (!payout || !card) return null;
      return Boolean(
        payout.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
    expect(cardAfterPayout).toBe(true);

    // 内訳は折りたたみ。開くと決まり手別・進入コース別が出る
    await expect(page.locator(".vds-detail")).toHaveCount(0);
    await page.locator(".vds-detail-toggle").click();
    await expect(page.locator(".vds-detail")).toBeVisible();
    expect(await page.locator(".vds-badge").count()).toBeGreaterThan(0);

    // 直前情報タブからは消えている（移設元のクラスも残っていない）
    await page.locator(".race-tabs-btn", { hasText: "直前情報" }).click();
    await expect(page.locator(".rbi-card").first()).toBeVisible({
      timeout: 25000,
    });
    await expect(page.locator(".vds-card")).toHaveCount(0);
    await expect(page.locator(".rbi-stat-grid")).toHaveCount(0);

    // 会場ページ（過去日）にも出る。こちらは「このレース」の節を出さない
    await page.goto("/races/2026-08-11/5");
    await expect(page.locator(".vds-card")).toBeVisible({ timeout: 25000 });
    await expect(page.locator(".vds-lede")).not.toContainText("このレース");
  });

  test("枠別情報タブの既定ビューが今日の想定コース×3指標で、全コース比較は折りたたみから開ける（BOA-307 / phase a T3-1）", async ({
    page,
  }) => {
    await page.goto("/races/2026-08-11");
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();

    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();

    // 他のタブ同様、枠別情報タブ表示中はデータ出走表等の分析ツール群を隠す
    await expect(page.locator(".data-race-table")).toHaveCount(0);

    await expect(page.locator(".rwit-boat-chip")).toHaveCount(6);

    // 既定ビュー: 今日の想定コース1本 × 1着率/2連対率/3連対率 + 走数
    await expect(page.locator(".rwit-today-row")).toHaveCount(6, {
      timeout: 20000,
    });
    await expect(page.locator(".rwit-today-metric-th")).toHaveCount(3);
    await expect(page.locator(".rwit-today-course")).toContainText("1コース");
    // 枠なり進入の仮定であることを明記する（進入は本番まで確定しない）
    await expect(page.locator(".rwit-today-assumption")).toContainText(
      "枠なり",
    );

    // 指標チップは既定では出さない（既定ビューは3指標を同時に出すため不要）。
    // toBeHidden()は要素が存在しない場合も通るため、存在することも確かめる
    await expect(page.locator(".rwit-metric-row")).toHaveCount(1);
    await expect(page.locator(".rwit-metric-row")).toBeHidden();

    // 行をタップすると直近10走の帯（RecentRunsBar）が開く
    await page.locator(".rwit-today-label-button").first().click();
    await expect(page.locator(".rwit-expanded")).toBeVisible();
    await expect(page.locator(".rrb-item").first()).toBeVisible({
      timeout: 20000,
    });
    expect(await page.locator(".rrb-item").count()).toBeLessThanOrEqual(10);
    // ST順位を「(N位)」形式で併記する（phase a T3-4）
    await expect(page.locator(".rrb-st-rank").first()).toBeVisible();

    // もう一度タップすると閉じる
    await page.locator(".rwit-today-label-button").first().click();
    await expect(page.locator(".rwit-expanded")).toHaveCount(0);

    // 選手を切り替えると想定コースも移る
    await page.locator(".rwit-boat-chip").nth(2).click();
    await expect(page.locator(".rwit-today-course")).toContainText("3コース", {
      timeout: 20000,
    });
    // 履歴の取得を待つ（新人等で0件だと以降のセレクタが消え、原因の分からない
    // タイムアウトになるため、ここで表の存在を確かめて切り分けを効かせる）
    await expect(page.locator(".rwit-today-table")).toBeVisible({
      timeout: 20000,
    });

    // 全コース比較は既定で閉じており、折りたたみを開くと6×6のグリッドが出る
    await expect(page.locator(".rwit-grid")).toHaveCount(1);
    await expect(page.locator(".rwit-grid")).toBeHidden();
    await page.locator(".rwit-fold-summary").click();
    await expect(page.locator(".rwit-grid")).toBeVisible();
    await expect(page.locator(".rwit-grid tbody tr")).toHaveCount(6);
    await expect(
      page.locator(".rwit-grid thead th.rwit-grid-course-th"),
    ).toHaveCount(6);
    // 指標チップは折りたたみの中にあり、切り替えてもグリッドの形は維持される
    await expect(page.locator(".rwit-metric-row")).toBeVisible();
    await page.locator(".rwit-chip", { hasText: "3連対率" }).click();
    await expect(page.locator(".rwit-grid tbody tr")).toHaveCount(6);

    // 決まり手傾向カード（会場全体の全艇合算）が表示される
    await expect(page.locator(".rwit-tech-row").first()).toBeVisible({
      timeout: 20000,
    });

    // ページ全体は横スクロールしない（横スクロールはグリッド内だけに閉じる）
    const docOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(docOverflow).toBeLessThanOrEqual(1);
  });

  // 枠別情報タブはデータ出走表を隠すため、上のテストだけでは
  // 「タブ切替ストリップ・データ出走表がページ全体をはみ出させない」ことを
  // 検証できていなかった。最小幅の320pxで基本情報タブも押さえる
  test("基本情報タブでも320px幅でページ全体が横スクロールしない（横スクロールはコンテナ内に閉じる）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    // 320px幅ではCookie同意バナーが画面下部の操作を遮るため、同意済みで開始する
    await page.addInitScript(() =>
      localStorage.setItem("boatai:cookie-consent", "accepted"),
    );
    await page.goto("/races/2026-08-11");
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();

    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 20000,
    });

    // タブストリップ・データ出走表は自前のスクロールコンテナの中で横スクロールする
    for (const selector of [".race-tabs-bar", ".drt-table-wrapper"]) {
      const overflowX = await page
        .locator(selector)
        .first()
        .evaluate((el) => getComputedStyle(el).overflowX);
      expect(["auto", "scroll"]).toContain(overflowX);
    }

    const docOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(docOverflow).toBeLessThanOrEqual(1);
  });

  // 結果未確定レースだけに出るAI用コピーバナーは、320px幅で
  // 「コピーボタン + キャッチコピーバッジ」が横一列に収まらずページ全体を
  // 16pxはみ出させていた（AiCopyBanner.jsx）。上の確定済みレースのテストでは
  // バナーが描画されないため、未確定レース側も押さえる
  test("基本情報タブの結果未確定レース（AI用コピーバナーあり）でも320px幅でページ全体が横スクロールしない", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    // バナー背後のpingリングはCSS transformでスクロール可能領域に寄与するため、
    // 任意のアニメーションフレームで計測しないよう止める
    // （AiCopyBannerはuseReducedMotionを見てリング自体を描画しない）
    await page.emulateMedia({ reducedMotion: "reduce" });
    // 320px幅ではCookie同意バナーが画面下部の操作を遮るため、同意済みで開始する
    await page.addInitScript(() =>
      localStorage.setItem("boatai:cookie-consent", "accepted"),
    );

    const found = await selectUpcomingRace(page);
    test.skip(
      !found,
      "本日開催中の未終了レースが見つからないため検証をスキップ",
    );

    // 未終了レースを開けた以上バナーは必ず出る。出ない場合は退行なので
    // スキップにせず失敗させる（バナーが消えると本検証が無言で骨抜きになるため）
    await expect(page.locator(".ai-copy-banner")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator(".race-tabs-btn.is-active")).toHaveText(
      "基本情報",
    );
    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 20000,
    });

    // バナー自身が親からあふれていないこと（この修正が効いていることの直接確認）
    const bannerOverflow = await page
      .locator(".ai-copy-banner")
      .evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(bannerOverflow).toBeLessThanOrEqual(1);

    const docOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(docOverflow).toBeLessThanOrEqual(1);
  });

  test("枠別情報タブのST考察カードが、同コース・同級別の平均との差つきで表示される（phase a T3-2）", async ({
    page,
  }) => {
    await page.goto("/races/2026-08-11");
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();
    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();

    // 094（st_course_baseline）が未適用の環境ではセクションごと出さない設計なので、
    // カードが出ない場合はこのテストをスキップする（本番・CIは適用済み）
    const card = page.locator(".rsc-card");
    await card.waitFor({ state: "visible", timeout: 25000 });

    // 5行（級別/走数/安定率/抜出/出遅率）× 6艇
    await expect(page.locator(".rsc-grid tbody tr")).toHaveCount(5);
    await expect(page.locator(".rsc-grid thead th.rsc-boat-th")).toHaveCount(6);

    // 集計期間が実測値で表示される（「直近1年」のような固定文言にしない）
    await expect(page.locator(".rsc-window")).toContainText(
      /\d{4}-\d{2}-\d{2}/,
    );

    // 差が表示され、方向（良い/悪い）で色分けされる。
    // どちらの向きが何件出るかは対象レースの選手次第なので、件数の内訳は問わない
    // （本番Supabase直結でDB状態に左右されるため）
    const diffCount = await page.locator(".rsc-diff").count();
    expect(diffCount).toBeGreaterThan(0);
    const colored =
      (await page.locator(".rsc-diff.is-better").count()) +
      (await page.locator(".rsc-diff.is-worse").count());
    expect(colored).toBeGreaterThan(0);

    // 抜出は実回数で出し、率（%）は画面に出さない。1コースは「—」
    const breakoutRow = page.locator(".rsc-grid tbody tr").nth(3);
    await expect(breakoutRow).toContainText("回");
    await expect(breakoutRow).not.toContainText("%");
    await expect(breakoutRow.locator("td").first()).toContainText("内側なし");
  });

  test("基本情報タブのバー展開に「条件別」タブと前期成績が出る（phase a T5-2/T5-2b）", async ({
    page,
  }) => {
    // f_count が埋まっている日（2026-09-21以降）の確定レースを直接開く。
    // 「F持ち時」「F無し時」の行は過去の走のF数に依存するため、
    // 行そのものの存在（9行）だけを見て値は問わない
    await page.goto("/race/2026-09-21-02-05");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
      timeout: 25000,
    });

    // バーをタップすると詳細が開き、タブは3つ（直近10走/得意会場/条件別）。
    // 「今節」は6艇横断が主役になったのでレース単位の独立タブへ移した
    await page.locator(".rbit-bar-row").first().click();
    await expect(page.locator(".rbit-expanded-tab")).toHaveCount(3);

    await page.locator(".rbit-expanded-tab", { hasText: "条件別" }).click();

    // 行は条件ごと（全国/当地/一般戦/SG・G1/初日/最終日/波5cm以上/F持ち/Fなし）。
    // ナイターの行は出さない（開催時間帯を取得していないため）。
    // n=0 の行は畳むので（BOA-432）、この選手は SG・G1 が消えて8行になる。
    // 行数を直に固定するとn=0の有無で壊れるため、ラベルの有無で確かめる
    const rows = page.locator(".rbit-conditions-table tbody tr");
    await expect(rows.first()).toContainText("全国", { timeout: 25000 });
    const table = page.locator(".rbit-conditions-table");
    for (const label of [
      "全国",
      "当地",
      "一般戦",
      "初日",
      "最終日",
      "波5cm以上",
      "F持ち",
      "Fなし",
    ]) {
      await expect(table).toContainText(label);
    }
    // 出走のある条件しか出さない（この選手はSG・G1を走っていない）
    await expect(table).not.toContainText("SG・G1");

    // 上のバー（公式値）と数字が一致しないことを明記する
    await expect(page.locator(".rbit-conditions-note")).toContainText(
      "一致しません",
    );
    // 「前期」は指標の列に混ぜず、算出期間つきの別枠で出す（単位が点のため）
    await expect(page.locator(".rbit-period-heading")).toContainText(
      /\d{4}-\d{2}-\d{2}/,
    );
    await expect(page.locator(".rbit-period-values")).toContainText("勝率");

    // この表が全コース込みであることと、今日の枠での走数を常時出す
    // （ボートレースファンのレビュー指摘A: 外枠専業の選手と枠が均等に回る選手で
    //   同じ数字の意味が正反対になり、素直に読むと今日の枠と逆に評価してしまう）
    await expect(page.locator(".rbit-conditions-caveat").first()).toContainText(
      "全コース込み",
    );
    await expect(page.locator(".rbit-conditions-caveat").first()).toContainText(
      /今日と同じ\d枠での出走は過去\d+走/,
    );

    // F持ち時・F無し時は勝率だけだと「Fを持っている方が走る」と読めるため、
    // 指標が勝率でも平均STを併記する（同レビュー指摘C）
    await expect(page.locator(".rbit-conditions")).toContainText(
      /F持ちの平均ST .+／Fなし/,
    );

    // 毎回は要らない注記（最終日の構造差・母数が違う行）は折りたたむ。
    // 開くまで本文は出ない（同レビュー指摘B）
    // 閉じている <details> の中身はDOMには在るので、テキストではなく
    // 表示状態で見る
    const how = page.locator(".rbit-conditions-how");
    await expect(how).toBeVisible();
    await expect(how.locator("p").first()).toBeHidden();
    await how.locator("summary").click();
    await expect(how.locator("p").first()).toBeVisible();
    await expect(how).toContainText("最終日は優勝戦を含み");
    await expect(how).toContainText("母数が他の行と違います");
  });

  test("勝率が全行1%未満に潰れる選手には3連対率への導線を出す（phase a T5-2、ファン視点レビュー指摘D）", async ({
    page,
  }) => {
    // 2026-09-21 桐生10R の5号艇（登番3352）は直近2年183走のうち5・6枠が178走で
    // 1着率0.5%。勝率で見ると全行1%未満に潰れるが、3連対率にすると全国41.5%と差が出る
    await page.goto("/race/2026-09-21-01-10");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
      timeout: 25000,
    });

    await page.locator(".rbit-bar-row").nth(4).click();
    await page.locator(".rbit-expanded-tab", { hasText: "条件別" }).click();
    // n=0 の行は畳むため行数は選手により変わる（BOA-432）。表が出ることだけ確かめる
    await expect(
      page.locator(".rbit-conditions-table tbody tr").first(),
    ).toContainText("全国", { timeout: 25000 });

    const zero = page.locator(".rbit-conditions-zero");
    await expect(zero).toContainText("1%未満");
    await zero.locator("button").click();

    // 3連対率に切り替わり、値が出て導線自体は消える
    await expect(
      page.locator(".rbit-chip.is-active", { hasText: "3連対率" }),
    ).toBeVisible();
    await expect(page.locator(".rbit-conditions-zero")).toHaveCount(0);
    await expect(
      page.locator(".rbit-conditions-table tbody tr").first(),
    ).not.toContainText("0.0%");
  });

  test("「今節」タブで6艇の勝負駆けと選んだ1艇の走りが出て、節をまたがない（phase a T6-1）", async ({
    page,
  }) => {
    // 2026-09-24 桐生3R。この節は9/20から、登番4872は9/20〜9/23の6走
    await page.goto("/race/2026-09-24-01-03");
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();

    // 1. 6艇横断（レース単位）。勝負駆けは相対でしか読めないので先に出す
    const compare = page.locator(".rmt-compare");
    await expect(compare).toBeVisible({ timeout: 25000 });
    await expect(compare.locator("tbody tr")).toHaveCount(6);
    // 得点率・節内順位・前検順位の3列
    await expect(page.locator(".rmt-compare thead")).toContainText("得点率");
    await expect(page.locator(".rmt-compare thead")).toContainText("節内順位");
    await expect(page.locator(".rmt-compare thead")).toContainText("前検");
    // 得点率の降順に並ぶ
    const rates = await page.locator(".rmt-rate").allInnerTexts();
    const nums = rates.map((v) => Number(v.replace(/[^0-9.]/g, "")));
    expect(nums).toEqual([...nums].sort((a, b) => b - a));
    // 節の規模と準優の目安、公式値の出典
    await expect(page.locator(".rmt-sub")).toContainText("節の出場は48人");
    await expect(page.locator(".rmt-source")).toContainText(
      "前検タイムの出典: BOAT RACE オフィシャルウェブサイト",
    );

    // 級別は前検の行から取る（追加クエリなし）。前検は順位だけでなくタイムを出す
    await expect(compare.locator(".rmt-class").first()).toHaveText(
      /^(A1|A2|B1|B2)$/,
    );
    await expect(compare.locator(".rmt-pretest").first()).toHaveText(
      /^\d\.\d{2}（\d+位）$|^\d\.\d{2}$|^—$/,
    );

    // 行タップで下の詳細がその選手に変わる（チップまで指を動かさせない）
    const scoreLine = page.locator(".rmt-detail-score");
    await expect(scoreLine).toBeVisible({ timeout: 25000 });
    const firstScore = await scoreLine.innerText();
    await compare.locator("tbody tr").nth(2).click();
    await expect(scoreLine).not.toHaveText(firstScore, { timeout: 25000 });

    // 2. 選んだ1艇の詳細。既定は1号艇なので4号艇（登番4872）に切り替える
    await page.locator(".rmt-select-chip").nth(3).click();
    // 予選中は「今節の得点率」、予選終了後は「予選の得点率（確定）」。
    // このレース（2026-09-24 桐生3R）は9/23で予選が終わった後の一般戦
    await expect(page.locator(".rmt-detail-score")).toContainText("の得点率", {
      timeout: 25000,
    });
    // 予選が終わった後のレースでは、早見（今日の着順で得点率がどう動くか）は
    // 出さない。準優はもう終わっていて得点率で争うものが無いため
    await expect(page.locator(".rmt-forecast-table")).toHaveCount(0);
    await expect(page.locator(".rmt-forecast")).toContainText("予選は");

    // ST・展示は走順の折れ線で見せる（数字の羅列はやめた）。
    // 平均・通常値・前検タイムはグラフの見出しに寄せてある
    const sparkHeads = page.locator(".rmt-spark-head");
    await expect(sparkHeads).toHaveCount(2);
    await expect(sparkHeads.first()).toContainText("今節のST");
    await expect(sparkHeads.first()).toContainText("通常");
    await expect(sparkHeads.nth(1)).toContainText("今節の展示");
    await expect(sparkHeads.nth(1)).toContainText("前検");
    await expect(page.locator(".rmt-sparks .meet-sparkline")).toHaveCount(2);

    // 6艇の推移（同じ縦の物差しで並べる）。ST/展示を切り替えられる
    await expect(page.locator(".rmt-trend-row")).toHaveCount(6);
    await page.locator(".rmt-metric-chip", { hasText: "展示" }).click();
    await expect(
      page.locator(".rmt-metric-chip", { hasText: "展示" }),
    ).toHaveAttribute("aria-pressed", "true");

    // 日別の走り。同じ節の走しか並ばない列は省き、展示の列を足すので9列
    const rows = page.locator(".race-meet-tab .race-history-table tbody tr");
    await expect(rows).toHaveCount(6, { timeout: 25000 });
    await expect(
      page.locator(".race-meet-tab .race-history-table thead th"),
    ).toHaveCount(9);
    const cells = rows.first().locator("td");
    // 同じ節の走しか並ばないので日付は月日だけ（年は毎行同じで幅を食う）
    await expect(cells.nth(0)).toHaveText("9/20");
    await expect(cells.nth(1)).toContainText("5R");
    await expect(cells.nth(3)).toHaveText("5");
    // 展示は「タイム(同レース内の順位)」。上向き/下向きの断定はしない
    await expect(cells.nth(4)).toHaveText(/^\d\.\d{2}\(\d\)$|^\d\.\d{2}$|^-$/);
    // STは「タイム(そのレース内のST順位)」。平均STだけでは「毎回相手に
    // 先んじているか」が読めないため順位を併記する
    await expect(cells.nth(5)).toHaveText(/^0\.09(\(\d\))?$/);
    // 展示の推移を「初日→直近」で断定する文言は出さない
    await expect(page.locator(".race-meet-tab")).not.toContainText("展示順位");

    // 予選中のレース（2026-09-22 桐生3R「予選男子」）では、早見を着順ごとに
    // 割って出す（1行のベタ書きだと390pxで折り返して読めない）
    await page.goto("/race/2026-09-22-01-03");
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
    await expect(page.locator(".rmt-detail-score")).toContainText(
      "今節の得点率",
      { timeout: 25000 },
    );
    // 得点率早見は公式と同じ行列（行＝艇・列＝1着〜6着）。
    // ボーダーの目安に届くセルに色が付く
    const forecast = page.locator(".rmt-forecast-table");
    await expect(forecast).toBeVisible();
    // 艇・選手 / 得点率 / 必要得点 / 1着〜6着 の9列
    await expect(forecast.locator("thead th")).toHaveCount(9);
    await expect(forecast.locator("thead")).toContainText("1着");
    await expect(forecast.locator("thead")).toContainText("6着");
    await expect(forecast.locator("thead")).toContainText("必要得点");
    await expect(forecast.locator("tbody tr")).toHaveCount(6);
    // 1着の得点率は6着より必ず高い（同じ艇の行の中で単調に下がる）
    const firstRow = forecast.locator("tbody tr").first();
    const forecastTexts = await firstRow.locator("td").allInnerTexts();
    const forecastCells = forecastTexts.slice(2).map(Number);
    expect(forecastCells).toHaveLength(6);
    expect(forecastCells[0]).toBeGreaterThan(forecastCells[5]);

    // 節の初戦では前節が混ざらず、空状態になる
    await page.goto("/race/2026-09-20-01-05");
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
    await expect(page.locator(".rmt-empty").first()).toContainText(
      "今節はまだ走っていません",
      { timeout: 25000 },
    );
  });

  test("F数バッジが基本情報タブとST考察カードで同じ値になり、f_countが無い過去レースでは出ない（phase a T5-3）", async ({
    page,
  }) => {
    // 2026-09-21 戸田5R: f_count は 1号艇2本・5号艇1本・6号艇1本で固定
    await page.goto("/race/2026-09-21-02-05");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
      timeout: 25000,
    });

    const basicBadges = page.locator(".rbit-bar-row .flying-badge");
    await expect(basicBadges).toHaveCount(3);
    // F2は赤（90日のあっせん停止で意味が違う）、F1は金
    await expect(basicBadges.nth(0)).toHaveText("F2");
    await expect(basicBadges.nth(0)).toHaveClass(/is-f2/);
    await expect(basicBadges.nth(1)).toHaveText("F1");
    await expect(basicBadges.nth(1)).not.toHaveClass(/is-f2/);

    // ST考察カードのバッジも同じ出所（race_entries.f_count）に統一した
    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();
    await page
      .locator(".rsc-card")
      .waitFor({ state: "visible", timeout: 25000 });
    const stBadges = page.locator(".rsc-grid .flying-badge");
    await expect(stBadges).toHaveCount(3);
    await expect(stBadges.nth(0)).toHaveText("F2");
    await expect(stBadges.nth(1)).toHaveText("F1");

    // f_count が無い期間（2026-09-20以前）はバッジも空欄も出さない
    await page.goto("/race/2026-09-10-01-01");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
      timeout: 25000,
    });
    await expect(page.locator(".flying-badge")).toHaveCount(0);
  });

  test("枠別情報タブのST分布・ST履歴が折りたたみで開き、平均と重ねて表示される（phase a T3-3）", async ({
    page,
  }) => {
    await page.goto("/races/2026-08-11");
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();
    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();

    await page
      .locator(".rsc-card")
      .waitFor({ state: "visible", timeout: 25000 });

    // 折りたたみは2つ。初期は閉じている
    await expect(page.locator(".rsc-fold-toggle")).toHaveCount(2);
    await expect(page.locator(".rsc-fold-body")).toHaveCount(0);

    // ST分布: ベースラインと同じ7ビン、選手の棒と平均の棒が各7本
    await page.locator(".rsc-fold-toggle").first().click();
    await expect(page.locator(".rsc-histogram")).toBeVisible();
    await expect(page.locator(".rsc-hist-col")).toHaveCount(7);
    await expect(page.locator(".rsc-hist-own")).toHaveCount(7);
    await expect(page.locator(".rsc-hist-base")).toHaveCount(7);

    // 母数が桁違いなので割合に正規化する（最大が100%になる）
    const maxHeight = await page.evaluate(() =>
      Math.max(
        ...[...document.querySelectorAll(".rsc-hist-own, .rsc-hist-base")].map(
          (el) => parseFloat(el.style.height),
        ),
      ),
    );
    expect(Math.abs(maxHeight - 100)).toBeLessThan(0.01);

    // 艇を選ぶチップが6つあり、切り替えると内容が変わる
    await expect(page.locator(".rsc-detail-chip")).toHaveCount(6);
    const noteBefore = await page.locator(".rsc-fold-note").innerText();
    await page.locator(".rsc-detail-chip").nth(5).click();
    await expect(page.locator(".rsc-fold-note")).not.toHaveText(noteBefore);

    // ST履歴を開くとST分布は閉じる（同時には開かない）
    await page.locator(".rsc-fold-toggle").nth(1).click();
    await expect(page.locator(".rsc-history")).toBeVisible();
    await expect(page.locator(".rsc-histogram")).toHaveCount(0);

    // 列が 日付/会場/ST/ST順/着順 で、新しい順に並ぶ
    await expect(page.locator(".rsc-history thead th")).toHaveCount(5);
    const dates = await page
      .locator(".rsc-history tbody tr td:first-child")
      .allInnerTexts();
    expect(dates.length).toBeGreaterThan(0);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  test("枠別情報タブの逃げシミュレーションで2着率の合計が100%になり、予想ではない旨が出る（phase a T3-5）", async ({
    page,
  }) => {
    await page.goto("/races/2026-08-11");
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();
    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();

    const card = page.locator(".nsc-card");
    await card.waitFor({ state: "visible", timeout: 25000 });

    // 2〜6コースの5行
    await expect(page.locator(".nsc-row")).toHaveCount(5);

    // 2着率の合計が100%（2着は必ず1艇。丸め誤差のみ許容）
    const rates = await page.locator(".nsc-rate").allInnerTexts();
    const sum = rates.reduce((a, r) => a + parseFloat(r), 0);
    expect(Math.abs(sum - 100)).toBeLessThan(0.6);

    // 母数が明記される
    await expect(page.locator(".nsc-sub")).toContainText("レース");

    // 「くわしく見る」で算出方法と「予想ではない」旨が出る
    await page.locator(".nsc-detail-toggle").click();
    await expect(page.locator(".nsc-detail")).toContainText(
      "予想ではありません",
    );
  });

  test("オッズ一覧タブで券種切替・全通り常時表示・推移ドリルダウン・免責文言が表示される（BOA-311）", async ({
    page,
  }) => {
    // 全窓（60/30/15/10/5/0分前）で全券種の全通りオッズが保存された過去レース
    // （FR-4、ADR-0057稼働後の2026-09-18戸田8R）を固定で使う
    await page.goto("/race/2026-09-18-02-08");
    await page.locator(".race-tabs-btn", { hasText: "オッズ一覧" }).click({
      timeout: 20000,
    });

    // 3連単（初期表示）: 1着ごとの6ブロックに全120通りがタップ不要で並ぶ（日和と同じ構造）
    await expect(page.locator(".rol-block")).toHaveCount(6, {
      timeout: 20000,
    });
    await expect(page.locator(".rol-block .rol-odds")).toHaveCount(120);
    await expect(page.locator(".rol-disclaimer")).toContainText("主催者");

    // オッズ一覧タブ専用の内容のため、基本情報系のデータ出走表・枠別傾向・
    // 分析ツールアコーディオンは隠れる（モータ情報タブと同じ方針の再発防止）
    await expect(page.locator(".data-race-table")).toHaveCount(0);
    await expect(page.locator(".venue-tendency-panel")).toHaveCount(0);
    await expect(page.locator(".embedded-analysis-section")).toHaveCount(0);

    // 3連単: オッズをタップするとそのブロック内に推移が表示され、再タップで閉じる
    await page.locator(".rol-odds[class*='rol-heat-']").first().click();
    await expect(page.locator(".rol-trend")).toBeVisible();
    await expect(page.locator(".rol-trend-item").first()).toBeVisible();
    await page.locator(".rol-odds.is-selected").click();
    await expect(page.locator(".rol-trend")).toHaveCount(0);

    // 3連複: 艇番3つの全20通りが一覧で表示される
    await page.locator(".rol-chip", { hasText: "3連複" }).click();
    await expect(page.locator(".rol-two-col-grid > .rol-odds")).toHaveCount(20);
    // 推移パネルは選択した行（先頭の2件=1行目）の直後に全幅で挿入される
    await page.locator(".rol-two-col-grid > .rol-odds").first().click();
    await expect(
      page.locator(".rol-two-col-grid > .rol-odds + .rol-odds + .rol-trend"),
    ).toBeVisible();

    // 2連単: 1着ごとの6ブロック（全30通り）。タップで推移が表示される
    await page.locator(".rol-chip", { hasText: "2連単" }).click();
    await expect(page.locator(".rol-block")).toHaveCount(6);
    await expect(page.locator(".rol-block .rol-odds")).toHaveCount(30);
    await page.locator(".rol-odds[class*='rol-heat-']").first().click();
    await expect(page.locator(".rol-trend")).toBeVisible();

    // 2連複: 小さい艇番ごとの5ブロック（全15通り、最大艇番のブロックは作らない）
    await page.locator(".rol-chip", { hasText: "2連複" }).click();
    await expect(page.locator(".rol-block")).toHaveCount(5);
    await expect(page.locator(".rol-block .rol-odds")).toHaveCount(15);

    // 拡連複（レンジ値）: 推移スパークラインがNaNにならず描画される
    await page.locator(".rol-chip", { hasText: "拡連複" }).click();
    await page.locator(".rol-odds[class*='rol-heat-']").first().click();
    const points = await page
      .locator(".rol-sparkline polyline")
      .getAttribute("points");
    expect(points).not.toContain("NaN");

    // 基本情報タブへ戻ればデータ出走表が再表示される（上の非表示検証が空振りでないことの裏付け）
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 15000,
    });
  });

  test("分析ツールの超展開データタブが表示される（レースAI予想からの外出し）", async ({
    page,
  }) => {
    await page.goto("/winning-technique");
    await page.click('.analysis-tab-btn:text-is("⚔️ 超展開データ")');
    await expect(page.locator(".motor-condition-container")).toBeVisible({
      timeout: 10000,
    });
    // 本日開催中のレースが無い環境でも空状態を許容する
    await expect(page.locator(".empty-state, .ad-section").first()).toBeVisible(
      { timeout: 20000 },
    );
  });

  test("分析ツールの出走表データタブが表示される（レースAI予想からの外出し）", async ({
    page,
  }) => {
    await page.goto("/winning-technique");
    await page.click('.analysis-tab-btn:text-is("📋 出走表データ")');
    await expect(page.locator(".motor-condition-container")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator(".empty-state, .rcd-table").first()).toBeVisible({
      timeout: 20000,
    });
  });
});

test.describe("ホームズ予想（α版・非公開リンク）", () => {
  test("/holmes のアドラータブで順列確率の実測値が表示される", async ({
    page,
  }) => {
    await page.goto("/holmes");
    await page.click('.holmes-tab:has-text("アドラー")');
    await expect(page.locator(".holmes-detective-name")).toHaveText(
      "アドラー予想",
    );
    // モデルJSON（data/adler/model.json）由来の実測値グリッドが描画される
    await expect(page.locator(".adler-stat").first()).toBeVisible();
    // 当日データの有無に依存しないモデル情報（フィットレース数）が数値で出ている
    await expect(page.locator(".adler-stat-value").nth(3)).not.toHaveText("—");
  });

  test("/holmes のワトソンタブでモデル実測値が表示される", async ({ page }) => {
    await page.goto("/holmes");
    await page.click('.holmes-tab:has-text("ワトソン")');
    await expect(page.locator(".holmes-detective-name")).toHaveText(
      "ワトソン予想",
    );
    // モデルJSON（data/watson/model.json）由来の実測値グリッドが描画される
    await expect(page.locator(".watson-stat").first()).toBeVisible();
    // 当日データの有無に依存しないモデル情報（学習レース数）が数値で出ている
    await expect(page.locator(".watson-stat-value").nth(3)).not.toHaveText("—");
  });

  test("/holmes のマイクロフトタブでモデル実測値が表示される", async ({
    page,
  }) => {
    await page.goto("/holmes");
    await page.click('.holmes-tab:has-text("マイクロフト")');
    await expect(page.locator(".holmes-detective-name")).toHaveText(
      "マイクロフト予想",
    );
    // モデルJSON（data/mycroft/model.json）由来の実測値グリッドが描画される
    await expect(page.locator(".mycroft-stat").first()).toBeVisible();
    // 当日データの有無に依存しないモデル情報（学習レース数）が数値で出ている
    await expect(page.locator(".mycroft-stat-value").nth(3)).not.toHaveText(
      "—",
    );
  });
});

test.describe("的中レース一覧のunified一本化（BOA-174）", () => {
  test("/hit-races で展開予測の的中バッジが表示され、旧モデル切替UIが表示されない", async ({
    page,
  }) => {
    await page.goto("/hit-races");
    // 朝の時間帯は「今日の的中」が0件（レース未消化）でも「昨日」に的中があると
    // no-data-containerが出ない正当な状態がある（デフォルトは今日タブのため
    // .race-cardも0枚）。ロード完了はタブ or no-data の表示で判定し、
    // 今日タブが空なら昨日タブに切り替えて検証する
    await expect(
      page
        .locator('button:has-text("昨日"), .no-data-container, .race-card')
        .first(),
    ).toBeVisible({ timeout: 20000 });
    await expect(page.locator(".model-selector")).toHaveCount(0);

    if ((await page.locator(".no-data-container").count()) > 0) {
      return; // 的中レースが1件も無い日は以降の検証対象なし
    }
    if ((await page.locator(".race-card").count()) === 0) {
      await page.locator('button:has-text("昨日")').click();
      await page.waitForTimeout(300);
    }

    const raceCardCount = await page.locator(".race-card").count();
    if (raceCardCount > 0) {
      await expect(page.locator(".hit-badge").first()).toHaveText(
        /展開予測的中/,
      );
      await expect(page.locator(".turn-hit-detail").first()).toBeVisible();
    }
  });
});

test.describe("過去の予想データ一覧のunified一本化（BOA-178）", () => {
  test("/races で日付カードに展開予測的中率が表示され、旧モデル比較表が表示されない", async ({
    page,
  }) => {
    await page.goto("/races");
    await expect(page.locator(".date-card").first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator(".date-card-turn-stat").first()).toBeVisible();
    await expect(page.locator(".mct-wrapper")).toHaveCount(0);
  });
});

test.describe("成績ページのunified一本化（BOA-175）", () => {
  test("/accuracy で展開予測の実測的中率が表示され、旧モデル切替UIが表示されない", async ({
    page,
  }) => {
    await page.goto("/accuracy");
    await expect(page.locator(".turn-accuracy-hero-rate")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator(".turn-accuracy-hero-rate")).toHaveText(/%$/);
    await expect(page.locator(".model-selector")).toHaveCount(0);
  });

  test("/accuracy から旧モデルの月別成績アーカイブへの導線がある", async ({
    page,
  }) => {
    await page.goto("/accuracy");
    const historyLink = page.locator('a.history-link:has-text("アーカイブ")');
    await expect(historyLink).toBeVisible({ timeout: 10000 });
    await historyLink.click();
    await expect(page).toHaveURL(/\/accuracy\/history$/);
  });

  test("/accuracy で展開予測の会場別的中率が表示される", async ({ page }) => {
    await page.goto("/accuracy");
    const details = page.locator(".turn-accuracy-venue-details");
    await expect(details).toBeVisible({ timeout: 10000 });
    await details.locator("summary").click();
    await expect(
      page.locator(".turn-accuracy-venue-table tbody tr").first(),
    ).toBeVisible();
  });
});

test.describe("複勝予想UI撤去の完全性（レース結果パネル）", () => {
  test("結果確定済みレースの「レース結果」パネルに複勝予想の検証が表示されない", async ({
    page,
  }) => {
    await page.goto("/races/2026-08-14");
    await page.locator(".venue-grid-card--open").first().click();
    const button = page.locator(".race-card .predict-btn").first();
    await expect(button).toBeVisible({ timeout: 10000 });
    await button.click();
    const resultPanel = page.locator(".race-result");
    await expect(resultPanel).toBeVisible({ timeout: 10000 });
    // BOA-238で払戻金セクション（単勝/複勝/3連複/3連単等）を追加したため、
    // 「複勝」という文字列自体は払戻金の券種ラベルとして正当に表示されるようになった。
    // ここで再発防止したいのは複勝予想の検証UI（「複勝◯位予想」「的中！」「不的中」）の方なので、
    // 判定もそちらに絞る
    await expect(resultPanel).not.toContainText("複勝予想");
    await expect(resultPanel).not.toContainText("的中！");
    await expect(resultPanel).not.toContainText("不的中");
  });
});

// 本日開催レースは実行時刻次第で全会場終了済み、または（日付が変わった直後など）
// 当日分の予測データが未生成で1件も無い状態になりうる。いずれも本アプリの正常な
// 状態であり検証をスキップする対象のため、未終了レースを探し、無ければfalseを返す。
// venue-list-redesign後の構造: 開催場一覧の「次 XR」表示がある会場＝未消化レースが
// 残っている会場。その会場の最終レース（12R側）は必ず未終了のため、それを開く
async function selectUpcomingRace(page) {
  await page.addInitScript(() => localStorage.setItem("boatai-language", "ja"));
  await page.goto("/");

  try {
    await page.locator(".venue-grid").waitFor({ timeout: 10000 });
  } catch {
    return false;
  }

  // 「次 XR」表示は会場カードの描画より後に入るため、.venue-gridの描画直後に
  // countすると開催中でも常に0件になり、このヘルパーを使うテストが無言で
  // skipし続けていた。表示の出現自体を待ってから絞り込む
  const upcomingVenue = page
    .locator(".venue-grid-card--open")
    .filter({ has: page.locator(".venue-grid-card__next-race") })
    .first();
  try {
    await upcomingVenue.waitFor({ timeout: 15000 });
  } catch {
    return false;
  }

  await upcomingVenue.click();
  const raceCards = page.locator(".race-card .predict-btn");
  try {
    await raceCards.first().waitFor({ timeout: 10000 });
  } catch {
    return false;
  }
  // 最終レース（未終了が保証される側）を選ぶ
  await raceCards.last().click();
  return true;
}

test.describe("AI用にコピー機能（BOA-194: race-ai-copy）", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("結果未確定レースでバナー・インラインのコピーボタンが表示される", async ({
    page,
  }) => {
    const found = await selectUpcomingRace(page);
    test.skip(
      !found,
      "本日開催中の未終了レースが見つからないため検証をスキップ",
    );

    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator(".ai-copy-banner")).toBeVisible();
    await expect(page.locator(".ai-copy-btn-banner")).toBeVisible();
    await expect(page.locator(".ai-copy-btn-inline")).toBeVisible();
  });

  test("結果確定済みレースではコピーボタンが表示されない", async ({ page }) => {
    // unifiedモデル運用開始日（2026-08-11〜）以降の結果確定済み日付
    await page.goto("/races/2026-08-11");
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();
    await expect(page.locator(".race-result")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator(".ai-copy-banner")).toHaveCount(0);
    await expect(page.locator(".ai-copy-btn-inline")).toHaveCount(0);
  });

  test("コピー実行後にトーストが表示され、クリップボードに整形済みMarkdownが入る", async ({
    page,
  }) => {
    const found = await selectUpcomingRace(page);
    test.skip(
      !found,
      "本日開催中の未終了レースが見つからないため検証をスキップ",
    );

    const bannerButton = page.locator(".ai-copy-btn-banner");
    await expect(bannerButton).toBeVisible({ timeout: 15000 });
    await bannerButton.click();

    const toast = page.getByRole("status");
    await expect(toast).toBeVisible();
    await expect(toast).toHaveText("コピーしました");

    const clipboardText = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    // 見出し・表・プロンプト文の3ブロックが揃っており、
    // 値の未解決を示す undefined/NaN が混入していないことを確認する
    expect(clipboardText).toMatch(/^## .+\n\n\|/);
    expect(clipboardText).toContain("| 項目 |");
    expect(clipboardText).not.toContain("undefined");
    expect(clipboardText).not.toContain("NaN");
  });
});

// イン崩れ指数（volatilityPercentile）を持つ結果未確定レースを会場横断で探す。
// レースカード一覧はhigh/lowレベルのレースに「🌪️ イン崩れ確率高」
// 「🎯 本命有利」バッジを直接表示する（RaceCard.jsx、standardは無印）ため、
// これをフィルタして対象レースを直接特定する。
// venue-list-redesign後の構造: 会場別レース一覧（/venue/:code）を会場ごとに
// 開いてバッジ付きカードを探し、クリックで/race/:raceIdへ遷移する。
// AI予想タブ（BOA-346）はVolatilityDisplayをレンダリングしない結果確定済み
// レースでは.volatility-display-*が一切出ないため、レンダリング待ちの
// タイムアウトで判別して次の候補へ進む
async function findRaceWithVolatilityLevel(page) {
  await page.addInitScript(() => localStorage.setItem("boatai-language", "ja"));

  await page.goto("/");
  try {
    await page.locator(".venue-grid").waitFor({ timeout: 10000 });
  } catch {
    return null;
  }
  const venueLinks = await page
    .locator(".venue-grid-card--open")
    .evaluateAll((els) => els.map((el) => el.getAttribute("href")));

  for (const link of venueLinks) {
    if (!link) continue;
    await page.goto(link);
    try {
      await page.locator(".race-card").first().waitFor({ timeout: 10000 });
    } catch {
      continue;
    }

    const badgedCards = page
      .locator(".race-card")
      .filter({ hasText: /イン崩れ確率高|本命有利/ });
    const count = await badgedCards.count();

    for (let i = 0; i < count; i++) {
      await badgedCards.nth(i).locator(".predict-btn").click();
      // AI予想タブ（BOA-346）はレース詳細読み込み後に描画されるため、
      // タブボタン自体の描画をまず待つ
      try {
        await page
          .locator(".race-tabs-btn", { hasText: "AI予想" })
          .first()
          .waitFor({ timeout: 15000 });
      } catch {
        await page.goBack();
        await page.locator(".race-card").first().waitFor({ timeout: 10000 });
        continue;
      }
      await page.locator(".race-tabs-btn", { hasText: "AI予想" }).click();
      // AI分析は非同期で完了まで数秒〜十数秒かかるため描画を待つ。
      // 結果確定済みレースはVolatilityDisplayを描画しないため
      // タイムアウトで次へ（下のvolatility-display-*判定で0件になり自然に次へ進む）
      try {
        await page
          .locator(".prediction-result, .result-verify-section")
          .first()
          .waitFor({ timeout: 15000 });
      } catch {
        await page.goBack();
        await page.locator(".race-card").first().waitFor({ timeout: 10000 });
        continue;
      }
      for (const level of ["high", "low", "standard"]) {
        const el = page.locator(`.volatility-display-${level}`);
        if ((await el.count()) > 0) return level;
      }
      await page.goBack();
      await page.locator(".race-card").first().waitFor({ timeout: 10000 });
    }
  }
  return null;
}

test.describe("レース荒れ度ムード演出（BOA-195: race-open-animation）", () => {
  test("イン崩れバッジが表示されるレースで波紋アニメーションが表示される", async ({
    page,
  }) => {
    // findRaceWithVolatilityLevelは会場ごとにフルリロードして走査するため、
    // 該当レースが見つかりにくい時間帯はデフォルトの30秒を超えうる
    test.setTimeout(60000);
    const level = await findRaceWithVolatilityLevel(page);
    test.skip(
      level === null,
      "本日開催中の全レースにイン崩れ指数（非フォールバック）を持つ未確定レースが無いため検証をスキップ",
    );

    await expect(page.locator(`.volatility-display-${level}`)).toBeVisible();
    await expect(page.locator(".race-mood-effect")).toBeVisible();
    await expect(
      page.locator(".race-mood-effect .race-mood-effect-ring").first(),
    ).toBeAttached();
  });

  test("prefers-reduced-motion環境では波紋アニメーションが表示されない", async ({
    browser,
  }) => {
    test.setTimeout(60000);
    const context = await browser.newContext({ reducedMotion: "reduce" });
    try {
      const page = await context.newPage();
      const level = await findRaceWithVolatilityLevel(page);
      test.skip(
        level === null,
        "本日開催中の全レースにイン崩れ指数（非フォールバック）を持つ未確定レースが無いため検証をスキップ",
      );

      await expect(page.locator(`.volatility-display-${level}`)).toBeVisible();
      await expect(page.locator(".race-mood-effect")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});

test.describe("titleタグの回帰確認（React 19 head-hoistingは<title>の子要素が複数だと空文字になる）", () => {
  test("ブログ記事詳細ページのtitleが空にならない", async ({ page }) => {
    await page.goto("/blog/rough-race-signals");
    await expect(page).toHaveTitle(/.+\| 龍神レーダー$/);
  });

  test("レース詳細ページのtitleが空にならない", async ({ page }) => {
    await page.goto("/races/2026-06-22");
    await expect(page).toHaveTitle(/.+龍神レーダー$/);
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

test.describe("龍神レーダー ブランドトークンのコントラスト（axe-core、ADR 0017）", () => {
  // scripts/maintenance/check-token-contrast.js はトークン単体の組み合わせを検証するが、
  // ここでは実際にレンダリングされたページで色の組み合わせに問題が無いかを検証する。
  // BOA-206でApp.css/RaceDetail.css/About.css/AccuracyDashboard.css等の未トークン化領域を
  // 解消したため、スコープをHeader/Footer/IntroBannerのみからページ全体に拡張した
  // （ページごとにルート要素のクラスが異なる=.app/.race-detail-page/.about-container等の
  // ため.include()では絞り込まず、document全体を対象にする）
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
      test(`${path}（${theme}テーマ）でcolor-contrast違反が無い`, async ({
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
    await page.unroute("**/rest/v1/race_original_exhibition?*");
    await page.unroute("**/rest/v1/race_original_exhibition_values*");
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
        return route.continue();
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
        return route.continue();
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
});

// 前検タイム・公式2連率（節時点）をモータ情報タブに出す（BOA-451 / phase a FR-4a）
test.describe("レース詳細のモータ情報タブ: 前検タイムと公式2連率", () => {
  const RACE = "/race/2026-09-21-05-12";

  const openMotorTab = async (page) => {
    await page.goto(RACE);
    await page.locator(".race-tabs-btn", { hasText: "モータ情報" }).click();
    await expect(page.locator(".motor-ranking-table").first()).toBeVisible({
      timeout: 30000,
    });
  };

  test("前検の行が取れている節では「前検」列に秒数と節内順位が出て、出典が添えられる", async ({
    page,
  }) => {
    let racerIds = [];
    // 表示中レースの出走選手の登番を拾って、その選手ぶんの前検を返す
    await page.route("**/rest/v1/motor_pretest_stats*", async (route) => {
      const url = new URL(route.request().url());
      // 実レスポンスを一度取って登番を得る（節の全選手ぶんが返る）
      const response = await route.fetch();
      const rows = await response.json().catch(() => []);
      racerIds = Array.isArray(rows) ? rows.map((r) => r.racer_id) : [];
      const stub = racerIds.map((racerId, i) => ({
        racer_id: racerId,
        race_date:
          url.searchParams.get("race_date")?.slice(-10) ?? "2026-09-21",
        pretest_time: 6.6 + i * 0.01,
        pretest_rank: i + 1,
        racer_class: "A1",
      }));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(stub),
      });
    });
    await openMotorTab(page);

    const table = page.locator(".motor-ranking-table").first();
    await expect(table.locator("thead")).toContainText("前検");
    await expect(table.locator("thead")).toContainText("公式2連率");
    // 6艇のどれかに前検の秒数（6.60〜6.9x）が出ている
    await expect(table.locator("td.motor-pretest-cell").first()).toHaveText(
      /\d\.\d{2}/,
    );
    await expect(page.locator(".motor-official-source-note")).toContainText(
      "BOAT RACE オフィシャルウェブサイト",
    );
  });

  test("節に前検の行が無い開催では「前検」列ごと出さない（「-」を6つ並べない）", async ({
    page,
  }) => {
    await page.route("**/rest/v1/motor_pretest_stats*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      }),
    );
    await openMotorTab(page);

    const table = page.locator(".motor-ranking-table").first();
    await expect(table.locator("thead")).not.toContainText("前検");
    await expect(table.locator("td.motor-pretest-cell")).toHaveCount(0);
    // 公式2連率は race_entries 由来なので前検が無くても出る
    await expect(table.locator("thead")).toContainText("公式2連率");
  });

  test("旧形状のキャッシュが残っていても「前検」列が出る（キャッシュキーの版を上げている）", async ({
    page,
  }) => {
    // BOA-264 で 1着率・優出数を足したときと同じ事故。返り値に
    // フィールドを足したのにキャッシュキーの版を上げないと、過去レースは
    // 7日TTLの旧キャッシュが新フィールド無しの形で返り、列が消える
    await page.addInitScript(() => {
      const stale = [1, 2, 3, 4, 5, 6].map((n) => ({
        boat_number: n,
        player_name: `旧キャッシュ${n}`,
        motor_number: n,
        motor_2rate: 30,
        motor_3rate: 40,
        power_index: 0,
        final_count: null,
        championship_count: null,
        first_place_count: null,
        race_count: 10,
      }));
      [90, 30].forEach((days) => {
        try {
          window.localStorage.setItem(
            `boatai:race-motor-breakdown-v3-5-${days}-2026-09-21-05-12`,
            JSON.stringify({ data: stale, timestamp: Date.now() }),
          );
        } catch {
          /* private window 等ではスキップ */
        }
      });
    });
    await openMotorTab(page);

    const table = page.locator(".motor-ranking-table").first();
    await expect(table.locator("thead")).toContainText("前検");
    await expect(table).not.toContainText("旧キャッシュ1");
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

test.describe("レース詳細のモータ情報タブ: 連対率の桁（BOA-474）", () => {
  test("2連率・公式2連率・3連率をすべて小数1桁で出す", async ({ page }) => {
    await page.goto("/race/2026-09-21-05-12");
    await page.locator(".race-tabs-btn", { hasText: "モータ情報" }).click();
    const table = page.locator(".motor-ranking-table").first();
    await expect(table).toBeVisible({ timeout: 30000 });

    // 同じ節・同じモーターでも、当日の出走表更新が走る前の行は1桁で入っている。
    // 2桁で出すと同じモーターが 54.80 と 54.84 に見えるため1桁に揃えた
    const officialCells = table.locator("tbody tr td:nth-child(5)");
    const count = await officialCells.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const text = (await officialCells.nth(i).innerText()).trim();
      if (text === "-") continue;
      expect(text).toMatch(/^\d+\.\d$/);
    }
  });
});

test.describe("静的ガイドがレース詳細のタブ構成に追随している（BOA-456フォローアップ）", () => {
  // レース詳細がタブ構成になったあと、/how-to-use だけが追随し /about・/faq は
  // 「結果」タブにしか触れていなかった。同じ取りこぼしを繰り返さないよう、
  // タブの名前と**並び順**が両ページに載っていることを機械的に固定する。
  // 正本は PredictionPanel.jsx の tabs 配列（粒度順。結果は isFinished のときだけ）
  const TABS = [
    "基本情報",
    "AI予想",
    "今節",
    "直前情報",
    "枠別情報",
    "モータ情報",
    "オッズ一覧",
    "結果",
  ];

  test("/about に全タブが実際の並び順で載っている", async ({ page }) => {
    await page.goto("/about");
    const list = page.locator(".about-tab-list");
    await expect(list).toBeVisible();
    await expect(list.locator("li")).toHaveCount(TABS.length);
    // 並べ替え（BOA-454）に追随できていないと、名前が揃っていても順序で落ちる
    for (const [index, tab] of TABS.entries()) {
      await expect(list.locator("li").nth(index)).toContainText(tab);
    }
    // 発走前は7つ・確定すると8つ、という本数の条件も落とさない
    await expect(list.locator("li").last()).toContainText(
      "確定するまでこのタブは出ません",
    );
    // 詳しい手順は使い方ガイドが正本なので、そこへの導線を保つ
    await expect(
      page.locator('.about-section a[href="/how-to-use"]'),
    ).toHaveCount(1);
  });

  test("/faq のタブ説明に全タブが実際の並び順で載っている", async ({
    page,
  }) => {
    await page.goto("/faq");
    const question = page
      .locator(".faq-question")
      .filter({ hasText: "レース詳細ページのタブは何が違うのですか？" });
    await expect(question).toHaveCount(1);
    await question.click();
    const answer = page.locator(".faq-item.open .faq-answer p").first();
    const text = await answer.innerText();
    // 【タブ名】の登場順が実際の並び順と一致していること
    const order = TABS.map((tab) => text.indexOf(`【${tab}】`));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // 発走前7つ・確定で8つ、という本数の条件
    expect(text).toContain("発走前は7つ");
    expect(text).toContain("8つになります");
  });

  test("FAQの回答の改行が段落として表示される（空白に潰れない）", async ({
    page,
  }) => {
    // 回答データは「【展開予測】…改行…【イン崩れ指数】…」と改行で項目を区切るが、
    // .faq-answer p が white-space: normal のままだと改行が空白に潰れ、
    // 項目が1段落に繋がって読めなくなる（2026-09-28に実測で発見）
    await page.goto("/faq");
    const question = page
      .locator(".faq-question")
      .filter({ hasText: "展開予測・イン崩れ指数の違いは何ですか？" });
    await question.click();
    const answer = page.locator(".faq-item.open .faq-answer p").first();
    await expect(answer).toBeVisible();
    const text = await answer.innerText();
    expect(text).toContain("\n");
    expect(text).toContain("【展開予測】");
    expect(text).toContain("【イン崩れ指数】");
  });

  test("旧UIの文言が /faq に残っていない", async ({ page }) => {
    await page.goto("/faq");
    // 全問の回答を集める。アコーディオンは1問ずつしか開かないため、当初は
    // 25問を順にクリックして開閉していたが、アニメーションぶんの待ちが積もって
    // 60秒のテストtimeoutに掛かった（実測38秒→質問追加で超過）。
    // FAQPage の JSON-LD は FAQ.jsx の faqs 配列から機械生成されており
    // 全回答の原文を持っているので、そちらを読めば同じことを決定的に検査できる
    const answers = await page.evaluate(() => {
      const schema = [
        ...document.querySelectorAll('script[type="application/ld+json"]'),
      ]
        .map((node) => {
          try {
            return JSON.parse(node.textContent);
          } catch {
            return null;
          }
        })
        .find((parsed) => parsed && parsed["@type"] === "FAQPage");
      return schema
        ? schema.mainEntity.map((q) => q.acceptedAnswer.text).join("\n")
        : null;
    });
    // schemaが取れないと「文言が無い」を無条件に満たしてしまうので先に押さえる
    expect(answers).not.toBeNull();
    expect(answers).toContain("詳細を見る");
    // ボタンは raceCard.view =「詳細を見る」、的中はヘッダーナビ nav.hits
    expect(answers).not.toContain("データ分析を見る");
    expect(answers).not.toContain("トップページの「的中レース」タブ");
  });
});

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
      const response = await route.fetch();
      const json = stripResults(await response.json());
      await route.fulfill({ response, json });
    };
    await page.route("**/api/predictions/**", handler);
    await page.route("**/rest/v1/rpc/get_predictions*", handler);
  };

  // routeUnfinished の route.fetch は本物の応答を待つため、アサーションが先に終わると
  // テスト終了時にまだ応答待ちのリクエストが残り、「page closed」でテストが失敗扱いになる
  // （2026-09-28実測。アサーションは全て通っていた）。終了時に待ちを捨てる
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
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
