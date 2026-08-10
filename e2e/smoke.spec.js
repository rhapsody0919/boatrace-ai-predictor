import { test, expect } from "@playwright/test";

test.describe("ホーム・基本ナビゲーション", () => {
  test("トップページが表示され、主要ナビが機能する", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-header")).toBeVisible();
    await expect(page.locator(".logo h1")).toHaveText("BoatAI");
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
    const jaBtn = page.locator('.language-switcher-btn:has-text("JA")');
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
    const zhBtn = page.locator('.language-switcher-btn:has-text("中文")');
    await zhBtn.click();
    await expect(page).toHaveURL(/\/zh-TW\/venues$/);

    const koBtn = page.locator('.language-switcher-btn:has-text("한국어")');
    await koBtn.click();
    await expect(page).toHaveURL(/\/ko\/venues$/);
  });
});

test.describe("多言語: 未翻訳パスのjaリダイレクト", () => {
  test("未翻訳ページ（/en/blog等）はja版へリダイレクトされlang=jaで配信される", async ({
    page,
  }) => {
    await page.goto("/en/blog");
    await expect(page).toHaveURL(/\/blog$/);
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

  test("トップページ（本日の予想）からデータ分析ツールへの導線がある（BOA-152）", async ({
    page,
  }) => {
    // /races/ は過去アーカイブのため対象外。実際に予想を見るトップページに導線が必要
    await page.goto("/");
    await page.locator(".predict-btn").first().click();
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
    await page.locator(".predict-btn").first().click();
    await expect(page.locator(".analysis-tools-link-section")).toHaveCount(0);
  });

  test("/races/{本日}には導線がある（本日開催中のレースのため機能する）", async ({
    page,
  }) => {
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    await page.goto(`/races/${today}`);
    await page.locator(".predict-btn").first().click();
    const link = page.locator(".analysis-tools-link");
    await expect(link).toBeVisible({ timeout: 10000 });
    await link.click();
    await expect(page).toHaveURL(/\/winning-technique\?/);
    await expect(page.locator(".motor-ranking-row").first()).toBeVisible({
      timeout: 10000,
    });
  });
});

test.describe("レースページ再設計（BOA-168）", () => {
  test("トップページでレース選択→データ出走表とAIデータ分析（折りたたみ）が表示される", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator(".predict-btn").first().click();

    // データ出走表が主役として表示される
    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 15000,
    });

    // AIデータ分析はデフォルト折りたたみ。ヘッダのみ表示
    const aiHeader = page.locator(".ai-analysis-header");
    await expect(aiHeader).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".ai-analysis-body")).toHaveCount(0);

    // 展開すると既存のAI予想UI（買い目・展開予測等）が表示される
    await aiHeader.click();
    await expect(page.locator(".ai-analysis-body")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.locator(".ai-analysis-body .prediction-result"),
    ).toBeVisible({ timeout: 10000 });
  });

  test("過去日付ページで結果確定レースを選ぶと「データで振り返る」が表示される", async ({
    page,
  }) => {
    await page.goto("/races/2026-07-30");
    await page.locator(".predict-btn").first().click();

    // データ出走表は過去日付でも表示される
    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 15000,
    });

    // 結果確定済みレースなので振り返りセクションが表示される
    await expect(page.locator(".race-review")).toBeVisible({
      timeout: 20000,
    });
    // 照合完了後、全艇サマリーとAI検証ブロックが表示される
    await expect(page.locator(".race-review-all-table")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator(".race-review-ai")).toBeVisible({
      timeout: 20000,
    });
    // 全艇サマリーは6艇分の行を持つ
    await expect(page.locator(".race-review-all-table tbody tr")).toHaveCount(
      6,
    );
    // 全艇の言語化ブロックも6艇分表示される
    await expect(page.locator(".race-review-boat-block")).toHaveCount(6);
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
});

test.describe("titleタグの回帰確認（React 19 head-hoistingは<title>の子要素が複数だと空文字になる）", () => {
  test("ブログ記事詳細ページのtitleが空にならない", async ({ page }) => {
    await page.goto("/blog/rough-race-signals");
    await expect(page).toHaveTitle(/.+\| BoatAI$/);
  });

  test("レース詳細ページのtitleが空にならない", async ({ page }) => {
    await page.goto("/races/2026-06-22");
    await expect(page).toHaveTitle(/.+BoatAI$/);
  });
});
