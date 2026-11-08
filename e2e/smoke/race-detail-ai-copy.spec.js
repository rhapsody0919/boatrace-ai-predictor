import {
  test,
  expect,
  applyCookieConsent,
  applyRecording,
} from "../fixtures.js";
import { openFixedRaceBeforeStart } from "./helpers.js";

test.describe("AI用にコピー機能（BOA-194: race-ai-copy）", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("結果未確定レースでバナー・インラインのコピーボタンが表示される", async ({
    page,
  }) => {
    await openFixedRaceBeforeStart(page);

    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator(".ai-copy-banner")).toBeVisible();
    await expect(page.locator(".ai-copy-btn-banner")).toBeVisible();
    await expect(page.locator(".ai-copy-btn-inline")).toBeVisible();
  });

  test("コピー直後のトーストに思考アシストへの1行が付き、6秒は消えず、押すと思考アシストへ移る（BOA-832）", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__events = [];
      window.gtag = (...args) => window.__events.push(args);
    });
    await openFixedRaceBeforeStart(page);
    const bannerButton = page.locator(".ai-copy-btn-banner");
    await expect(bannerButton).toBeVisible({ timeout: 15000 });
    await bannerButton.click();
    const toast = page.getByRole("status");
    await expect(toast).toContainText("コピーしました");
    const action = toast.locator(".app-toast-action");
    await expect(action).toContainText("貼る前に材料を確かめる → 思考アシスト");
    // 以前は2秒で消えた。3秒たっても出ている
    await page.waitForTimeout(3000);
    await expect(action).toBeVisible();
    // 押せる高さ（44px）と、閉じる×
    expect((await action.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await expect(toast.getByRole("button", { name: "閉じる" })).toBeVisible();
    const raceUrl = page.url();
    await action.click();
    await expect(page).toHaveURL(/\/assist$/);
    const events = await page.evaluate(() =>
      window.__events
        .filter((e) => e[0] === "event" && e[1] === "assist_view_switch")
        .map((e) => e[2].assist_entry),
    );
    expect(events).toEqual(["copy_toast"]);
    // 表示の選択は残さない。戻るでレース詳細へ
    expect(
      await page.evaluate(() => localStorage.getItem("boatai-user:race-view")),
    ).toBeNull();
    await page.goBack();
    await expect(page).toHaveURL(raceUrl);
  });

  test("トーストの×で閉じ、マウスを重ねている間は消えない（BOA-832）", async ({
    page,
  }) => {
    await openFixedRaceBeforeStart(page);
    const bannerButton = page.locator(".ai-copy-btn-banner");
    await expect(bannerButton).toBeVisible({ timeout: 15000 });
    await bannerButton.click();
    const toast = page.getByRole("status");
    const action = toast.locator(".app-toast-action");
    await expect(action).toBeVisible();
    await action.hover();
    await page.waitForTimeout(7000);
    await expect(action).toBeVisible();
    await toast.getByRole("button", { name: "閉じる" }).click();
    await expect(page.locator(".app-toast-action")).toHaveCount(0);
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
    await openFixedRaceBeforeStart(page);

    const bannerButton = page.locator(".ai-copy-btn-banner");
    await expect(bannerButton).toBeVisible({ timeout: 15000 });
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await bannerButton.click();

    const toast = page.getByRole("status");
    await expect(toast).toBeVisible();
    // 思考アシストへの1行が続く（BOA-832）ので、文言の始まりで見る
    await expect(toast).toContainText("コピーしました");
    // コピーしても読んでいた位置から動かない（以前はデータ出走表へスクロールしていた。BOA-770）
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

    const clipboardText = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    // 見出し → レースの前提 → 表 → 注記 → 質問文 → 出典（BOA-770）。
    // 値の未解決を示す undefined/NaN が混入していないことを確認する
    expect(clipboardText).toMatch(
      /^## .+\n\n- 日付: \d{4}-\d{2}-\d{2}\n- 締切予定: /,
    );
    expect(clipboardText).toContain("- コピーした時刻: ");
    expect(clipboardText).toContain("| 項目 |");
    expect(clipboardText).toContain("項目の注記:");
    expect(clipboardText).toMatch(
      /\n出典: 龍神レーダー https:\/\/www\.boat-ai\.jp\/race\/\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/,
    );
    expect(clipboardText).not.toContain("undefined");
    expect(clipboardText).not.toContain("NaN");
    expect(clipboardText).not.toContain("競艇");
  });

  test("375px でもコピー後のトーストが下部ナビに隠れない", async ({ page }) => {
    // 以前はトーストの z-index（70）が RaceBottomNav（1500）より低く、スマホでは
    // 「コピーしました」が見えなかった（BOA-770 ファン評価）
    await page.setViewportSize({ width: 375, height: 800 });
    await openFixedRaceBeforeStart(page);
    const bannerButton = page.locator(".ai-copy-btn-banner");
    await expect(bannerButton).toBeVisible({ timeout: 15000 });
    await bannerButton.click();
    const toast = page.getByRole("status");
    // 思考アシストへの1行が続く（BOA-832）ので、文言の始まりで見る
    await expect(toast).toContainText("コピーしました");
    const onTop = await toast.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      return el.contains(hit);
    });
    expect(onTop).toBe(true);
  });

  test("375px のプレビューで、表以外（前提の行・質問文・出典）は折り返して読める", async ({
    page,
  }) => {
    // 以前は全文を1つの <pre>（折り返しなし）で出しており、375px で質問文と
    // 出典が箱の右に切れていた（BOA-770 ファン評価2周目）
    await page.setViewportSize({ width: 375, height: 800 });
    await openFixedRaceBeforeStart(page);
    await expect(page.locator(".ai-copy-btn-banner")).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole("button", { name: "コピーされる全文を見る" }).click();
    const preview = page.getByTestId("ai-copy-preview");
    await expect(preview).toContainText("出典: 龍神レーダー");
    const overflowing = await preview.evaluate((el) =>
      [...el.querySelectorAll("pre")]
        .filter((pre) => !pre.textContent.startsWith("|"))
        .filter((pre) => pre.scrollWidth > pre.clientWidth + 1)
        .map((pre) => pre.textContent.slice(0, 30)),
    );
    expect(overflowing).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(375);
  });

  test("プレビューでコピーされる全文（表と出典を含む）が見られる", async ({
    page,
  }) => {
    await openFixedRaceBeforeStart(page);
    await expect(page.locator(".ai-copy-btn-banner")).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole("button", { name: "コピーされる全文を見る" }).click();
    const preview = page.getByTestId("ai-copy-preview");
    await expect(preview).toContainText("| 項目 |");
    await expect(preview).toContainText("出典: 龍神レーダー");
    // 「データだけ」に切り替えると質問文が差し替わる
    await page.getByRole("radio", { name: "データだけ" }).click();
    await expect(preview).toContainText("このあと質問します。");
    // ページ末尾のボタンに、上で選んだ質問が添えられる（BOA-770 ファン評価）
    await expect(page.locator(".ai-copy-inline")).toContainText(
      "質問「データだけ」付きでコピーします",
    );
  });
});

test.describe("レース荒れ度ムード演出（BOA-195: race-open-animation）", () => {
  // 固定のレース（イン崩れ指数 0.97）は high。発走前の状態で開き、AI予想タブの
  // VolatilityDisplay を見る（当日の未確定レースを会場横断で探していた頃は、
  // 見つからない時間帯に skip していた。BOA-445）
  const LEVEL = "high";

  async function openVolatility(page) {
    await openFixedRaceBeforeStart(page);
    await page
      .locator(".race-tabs-btn", { hasText: "AI予想" })
      .click({ timeout: 20000 });
    await expect(page.locator(`.volatility-display-${LEVEL}`)).toBeVisible({
      timeout: 15000,
    });
  }

  test("イン崩れバッジが表示されるレースで波紋アニメーションが表示される", async ({
    page,
  }) => {
    await openVolatility(page);
    await expect(page.locator(".race-mood-effect")).toBeVisible();
    await expect(
      page.locator(".race-mood-effect .race-mood-effect-ring").first(),
    ).toBeAttached();
  });

  test("prefers-reduced-motion環境では波紋アニメーションが表示されない", async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    try {
      // fixture を通らない context なので、Cookie 同意・録画の再生・時計の固定を明示的に掛ける
      await applyCookieConsent(context, "rejected");
      await applyRecording(context, testInfo);
      const page = await context.newPage();
      await openVolatility(page);
      await expect(page.locator(".race-mood-effect")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
