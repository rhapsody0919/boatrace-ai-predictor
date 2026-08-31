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

    // 再クリックで反対のテーマに戻ることを確認
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
    await page.goto("/en/venues");
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
    await page.locator(".language-switcher-trigger").click();
    const zhBtn = page.locator(
      '.language-switcher-option:has-text("繁體中文")',
    );
    await zhBtn.click();
    await expect(page).toHaveURL(/\/zh-TW\/venues$/);

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
    await expect(page.locator(".recharts-wrapper")).toBeVisible({
      timeout: 10000,
    });
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

  test("本日の会場ランキングタブが表示される（BOA-171）", async ({ page }) => {
    await page.goto("/winning-technique");
    await page.click('.analysis-tab-btn:text-is("🏟️ 会場ランキング")');
    await expect(page.locator(".motor-condition-container")).toBeVisible({
      timeout: 10000,
    });
    // 本日開催中のレースが無い、または結果確定レースが無い環境でも空状態を許容する
    await expect(
      page.locator(".empty-state, .motor-ranking-row").first(),
    ).toBeVisible({
      timeout: 15000,
    });
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
    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 15000,
    });

    // 同じURLを直接開いても表示される（ディープリンク）
    const url = page.url();
    await page.goto(url);
    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 15000,
    });
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

test.describe("レースページ再設計（BOA-168）", () => {
  test("トップページでレース選択→データ出走表とAIデータ分析（デフォルト展開）が表示される", async ({
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

    // データ出走表が主役として表示される
    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 15000,
    });

    // AIデータ分析はデフォルト展開（2026-08-14: 新AIモデル開発を今後行わない方針のため
    // 分析パネルを控えめにする必要が無くなった）。クリック無しで中身が見える
    const aiHeader = page.locator(".ai-analysis-header");
    await expect(aiHeader).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".ai-analysis-body")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.locator(".ai-analysis-body .prediction-result"),
    ).toBeVisible({ timeout: 10000 });

    // ヘッダクリックで折りたたむこともできる
    await aiHeader.click();
    await expect(page.locator(".ai-analysis-body")).toHaveCount(0);
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

  test("分析ツール7コンポーネントの埋め込みセクションがデフォルト閉で並び、開くと会場/レース選択プルダウン無しで実データが表示される（race-detail-analysis-integration FR-3〜9）", async ({
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

    const sections = page.locator(".embedded-analysis-section");
    await expect(sections).toHaveCount(7);

    const expectedTitles = [
      "モーター調子",
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

  test("過去日・結果確定済みレースの埋め込みセクションが、無関係な「本日開催」レースにフォールバックせず当該レースのデータを表示する（race-detail-analysis-integration 回帰確認）", async ({
    page,
  }) => {
    // 過去日は「本日開催中の会場」一覧に含まれないため、embedded対応前は
    // getVenuesWithTodaysRaces()のフォールバック（list[0]）により無関係なレースの
    // データが無警告表示されていた。DataRaceTableの選手名と、埋め込みセクション
    // （モーター調子）が表示する選手名が一致することを確認する
    await page.goto("/races/2026-08-11");
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();
    await expect(page).toHaveURL(/\/race\/2026-08-11-\d{2}-\d{2}$/);

    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 15000,
    });
    const expectedNames = (
      await page.locator(".drt-name-th").allTextContents()
    ).map((n) => n.trim());
    expect(expectedNames.length).toBe(6);

    const motorSection = page
      .locator(".embedded-analysis-section")
      .filter({ hasText: "モーター調子" });
    await motorSection.locator(".eas-header").click();
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

  test("過去日付ページで結果確定レースを選ぶと「データで振り返る」が表示される", async ({
    page,
  }) => {
    // unifiedモデル運用開始日（2026-08-11〜）以降の日付を使う。
    // それより前の日付はAI予想（topPick）が存在せず.race-resultが出ない仕様のため
    await page.goto("/races/2026-08-11");
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();

    // データ出走表は過去日付でも表示される
    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 15000,
    });

    // 的中判定（複勝的中/展開予測的中）はレース結果パネルに一本化されている
    // （2026-08-14: 従来はAI検証ブロックと重複表示していたのを整理・統合）
    await expect(page.locator(".race-result")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator(".turn-pattern-list")).toBeVisible({
      timeout: 20000,
    });

    // 結果確定済みレースなので振り返りセクションが表示される
    await expect(page.locator(".race-review")).toBeVisible({
      timeout: 20000,
    });
    // 照合完了後、全艇サマリーが表示される
    await expect(page.locator(".race-review-all-table")).toBeVisible({
      timeout: 20000,
    });
    // 全艇サマリーは6艇分の行を持つ
    await expect(page.locator(".race-review-all-table tbody tr")).toHaveCount(
      6,
    );
    // 全艇の言語化ブロックも6艇分表示される
    await expect(page.locator(".race-review-boat-block")).toHaveCount(6);
    // AI検証ブロックはレース結果パネルと重複するため廃止済み
    await expect(page.locator(".race-review-ai")).toHaveCount(0);
    // 結果確定済みレースでは未来志向のAIデータ分析（展開予測/イン崩れ）を表示しない
    await expect(page.locator(".ai-analysis-header")).toHaveCount(0);
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
    await expect(resultPanel).not.toContainText("複勝");
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

  const upcomingVenue = page
    .locator(".venue-grid-card--open")
    .filter({ has: page.locator(".venue-grid-card__next-race") })
    .first();
  if ((await upcomingVenue.count()) === 0) {
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
// 結果確定済みレースは.ai-analysis-header自体が描画されないため、
// 描画待ちのタイムアウトで判別して次の候補へ進む
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
      // AI分析は非同期で完了まで数秒〜十数秒かかるため描画を待つ。
      // 結果確定済みレースはai-analysis-headerが出ないためタイムアウトで次へ
      try {
        await page
          .locator(".ai-analysis-header")
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
