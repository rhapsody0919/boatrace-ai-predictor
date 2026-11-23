import { test, expect } from "./fixtures.js";
import {
  RACE_PATH,
  BLOG_PATH,
  button,
  panel,
  captureFeedbackPosts,
  expectNoOverlap,
} from "./site-feedback-helpers.js";

/**
 * サイト全体のご意見ボックスの置き場所: フッターの入口・既存の固定表示（Cookie の確認・ブログの「先頭へ戻る」・
 * レースの下部ナビ）と重ならないこと・出さない画面・言語・スマホのシート。入力と送信は site-feedback.spec.js。
 */
test.describe("パソコンの幅（1280px）", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("フッターの入口からも同じパネルが開き、閉じるとフッターの入口へフォーカスが戻る", async ({
    page,
  }) => {
    await page.goto("/contact");
    const entry = page.getByTestId("site-feedback-footer");
    await expect(entry).toHaveText("ご意見・ご要望を送る");
    await entry.click();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(entry).toBeFocused();
  });

  test("ブログ記事では「先頭へ戻る」と重ならず、その上に置く", async ({
    page,
  }) => {
    await page.goto(BLOG_PATH);
    await expect(button(page)).toBeVisible({ timeout: 25000 });
    // 「先頭へ戻る」は 600px を超えてスクロールすると出る
    await page.mouse.wheel(0, 900);
    const top = page.locator(".back-to-top-button");
    await expect(top).toBeVisible();
    // 上へずれる動き（0.2秒）の途中で測らない
    await button(page).evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished)),
    );
    await expectNoOverlap(button(page), top);
    const [b, t] = [await button(page).boundingBox(), await top.boundingBox()];
    expect(Math.round(t.y - (b.y + b.height))).toBe(12);
  });

  test("下へスクロールするとアイコンだけになり、上へ戻すと文字が戻る（名前は読み上げに残る）", async ({
    page,
  }) => {
    await page.goto(BLOG_PATH);
    await expect(button(page)).toBeVisible({ timeout: 25000 });
    await page.mouse.wheel(0, 600);
    await expect(button(page)).toHaveClass(/is-mini/);
    await expect(button(page)).toHaveAttribute(
      "aria-label",
      "ご意見・ご要望を送る",
    );
    await expect
      .poll(async () => (await button(page).boundingBox()).width)
      .toBeLessThanOrEqual(50);
    // 読み込みの揺れ（数px の上下）では戻さず、はっきり上へ戻したときだけ戻す。
    // スクロールの位置が実際に変わり、その scroll の処理が終わってから見る
    const y0 = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => window.scrollBy(0, -10));
    // 読み込みで本文の高さが数px 変わるので、ちょうどの位置ではなく「少しだけ上へ動いた」を待つ
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeLessThan(y0);
    expect(y0 - (await page.evaluate(() => window.scrollY))).toBeLessThan(40);
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50))),
    );
    await expect(button(page)).toHaveClass(/is-mini/);
    await page.mouse.wheel(0, -300);
    await expect(button(page)).not.toHaveClass(/is-mini/);
  });

  test("お礼の中のリンクからお問い合わせページへ移れ、移るとパネルは閉じる", async ({
    page,
  }) => {
    await captureFeedbackPosts(page);
    await page.goto("/en/");
    await button(page).click();
    await panel(page).locator("textarea").fill("Need a reply");
    await panel(page).getByRole("button", { name: "Send" }).click();
    const link = panel(page).getByRole("link", {
      name: "Open the contact page",
    });
    await expect(link).toBeVisible();
    // /contact は ja 専用なので、英語の画面からも接頭辞なしで指す
    await expect(link).toHaveAttribute("href", "/contact");
    await link.click();
    await expect(page).toHaveURL(/\/contact$/);
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByTestId("site-feedback-footer")).toBeVisible();
  });

  test("英語のページでは英語で出て、lang は en で送る", async ({ page }) => {
    const rows = await captureFeedbackPosts(page);
    await page.goto("/en/");
    await expect(button(page)).toHaveText("Feedback", { timeout: 25000 });
    await button(page).click();
    await panel(page).locator("textarea").fill("Great site");
    await panel(page).getByRole("button", { name: "Send" }).click();
    await expect(panel(page).getByText("Received")).toBeVisible();
    expect(rows[0]).toMatchObject({ lang: "en", page_type: "home" });
  });

  // 出さない画面。先にその画面に固有の物が見えるのを待つ（白い画面のまま「無い」で通さない）。
  // 判定の規則（/admin・/share・言語の接頭辞つき）は verify-site-feedback.js が全部見る。ここは描いた画面で1つだけ確かめる
  // （/share/today-sheet は当日のデータが無い時間帯に白い画面になるので使わない）
  for (const [path, own] of [[`${RACE_PATH}/assist`, ".ta-header-row"]]) {
    test(`${path} ではボタンもフッターの入口も出さない`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator(own).first()).toBeVisible({ timeout: 25000 });
      expect(new URL(page.url()).pathname).toBe(path);
      await expect(button(page)).toHaveCount(0);
      await expect(page.getByTestId("site-feedback-footer")).toHaveCount(0);
      await expect(page.locator(".site-fb")).toHaveCount(0);
    });
  }
});

test.describe("Cookie の確認が出ている間（未回答）", () => {
  test.use({ cookieConsent: null, viewport: { width: 1280, height: 800 } });

  test("確認に答えるまでボタンを出さず、答えたら出す", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".cookie-consent")).toBeVisible({
      timeout: 25000,
    });
    await expect(button(page)).toBeHidden();
    await page.locator(".cookie-consent__reject").click();
    await expect(button(page)).toBeVisible();
  });

  test("確認が出ている間はフッターの入口も出さない（開いたパネルの「送る」が帯に隠れる）", async ({
    page,
  }) => {
    await page.goto("/contact");
    await expect(page.locator(".cookie-consent")).toBeVisible({
      timeout: 25000,
    });
    const entry = page.getByTestId("site-feedback-footer");
    await expect(entry).toBeHidden();
    await page.locator(".cookie-consent__reject").click();
    await expect(entry).toBeVisible();
  });
});

test.describe("スマホの幅（375px）", () => {
  test.use({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
  });

  test("レース詳細では下部ナビの上にアイコンだけで置き、下へ読み進めている間は隠す（出走表の右端の数字を隠さない）", async ({
    page,
  }) => {
    await page.goto(RACE_PATH);
    const nav = page.locator(".race-bottom-nav");
    await expect(nav).toBeVisible({ timeout: 25000 });
    await expect(button(page)).toBeVisible();
    await expect(button(page).locator(".site-fb-btn-label")).toBeHidden();
    const [b, n] = [await button(page).boundingBox(), await nav.boundingBox()];
    expect(Math.round(b.width)).toBe(48);
    expect(Math.round(b.height)).toBe(48);
    // 下部ナビの上に 12px 空けて置く
    expect(Math.round(n.y - (b.y + b.height))).toBe(12);

    await page.evaluate(() => window.scrollTo(0, 400));
    await expect(button(page)).toBeHidden();
    await page.evaluate(() => window.scrollTo(0, 300));
    await expect(button(page)).toBeVisible();
  });

  test("パネルは下からのシートで画面の幅に収まり、「送る」まで画面の中にある", async ({
    page,
  }) => {
    const rows = await captureFeedbackPosts(page);
    await page.goto("/");
    await expect(button(page)).toBeVisible({ timeout: 25000 });
    await button(page).tap();
    await expect(panel(page)).toBeVisible();
    // 指で触る端末は、開いた瞬間にキーボードを出さない（入力欄にフォーカスしない）
    await expect(panel(page).locator("textarea")).not.toBeFocused();
    // せり上がり（0.2秒）の途中で測らない
    await panel(page).evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished)),
    );
    const box = await panel(page).boundingBox();
    expect(box.x).toBe(0);
    expect(Math.round(box.width)).toBe(375);
    expect(Math.round(box.y + box.height)).toBe(812);
    expect(box.y).toBeGreaterThanOrEqual(0);
    await expect(
      panel(page).getByRole("button", { name: "送る" }),
    ).toBeInViewport({ ratio: 1 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await panel(page).locator("textarea").fill("スマホから送る");
    await panel(page).getByRole("button", { name: "送る" }).tap();
    await expect(panel(page).getByText("受け取りました")).toBeVisible();
    expect(rows).toHaveLength(1);
  });

  test("シートを開いている間は後ろのページをスクロールさせず、閉じたら元に戻す", async ({
    page,
  }) => {
    await page.goto("/");
    const overflow = () => page.evaluate(() => document.body.style.overflow);
    const before = await overflow();
    await button(page).tap();
    await expect(panel(page)).toBeVisible();
    expect(await overflow()).toBe("hidden");
    await panel(page).locator(".site-fb-x").tap();
    await expect(panel(page)).toHaveCount(0);
    expect(await overflow()).toBe(before);
  });

  test("押せる部品は高さ 44px 以上", async ({ page }) => {
    await page.goto("/");
    await button(page).tap();
    const sizes = await panel(page)
      .locator(".site-fb-x, .site-fb-chip-face, .site-fb-star, .site-fb-send")
      .evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { cls: el.className, h: r.height, w: r.width };
        }),
      );
    expect(sizes.length).toBe(11);
    for (const s of sizes) {
      expect(s.h, JSON.stringify(s)).toBeGreaterThanOrEqual(44);
      expect(s.w, JSON.stringify(s)).toBeGreaterThanOrEqual(44);
    }
  });
});
