import { test, expect } from "./fixtures.js";

/**
 * サイト全体のご意見ボックス（src/components/siteFeedback/、設計 docs/design/site-feedback-box/spec.md）。
 * 右下のボタン → 入力パネル → site_feedback への送信までと、既存の固定表示（Cookie の確認・
 * レースの下部ナビ・ブログの「先頭へ戻る」）と重ならないことを固定する。
 *
 * 送信は必ずここで受け止める（録画に無い /rest/v1/* は本番へ素通しされるので、本番の表に書かないため）。
 */
const RACE_PATH = "/race/2026-09-24-01-03";
const BLOG_PATH = "/blog/odds-expected-value-guide";

/** site_feedback への POST を受け止め、送られた行を集める。status を変えると失敗を再現できる */
async function captureFeedbackPosts(page, { status = 201 } = {}) {
  const rows = [];
  await page.route("**/rest/v1/site_feedback*", async (route) => {
    rows.push(route.request().postDataJSON());
    if (status >= 400)
      return route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ code: "P0001", message: "too many overall" }),
      });
    return route.fulfill({ status, body: "" });
  });
  return rows;
}

const button = (page) => page.getByTestId("site-feedback-button");
const panel = (page) => page.getByTestId("site-feedback-panel");

/** 2つの要素の箱が重なっていないこと */
async function expectNoOverlap(a, b) {
  const [x, y] = [await a.boundingBox(), await b.boundingBox()];
  expect(x && y, "両方の要素が画面にある").toBeTruthy();
  const apart =
    x.x + x.width <= y.x ||
    y.x + y.width <= x.x ||
    x.y + x.height <= y.y ||
    y.y + y.height <= x.y;
  expect(apart, `重なっている: ${JSON.stringify({ x, y })}`).toBe(true);
}

test.describe("パソコンの幅（1280px）", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("右下のボタンから開き、内容・種類・満足度を送るとお礼が出て、決まりどおりの1行が送られる", async ({
    page,
  }) => {
    const rows = await captureFeedbackPosts(page);
    await page.goto("/");
    await expect(button(page)).toBeVisible({ timeout: 25000 });
    await expect(button(page)).toHaveText("ご意見");
    // 右下に置く（右端・下端から 16px）
    const box = await button(page).boundingBox();
    expect(Math.round(1280 - (box.x + box.width))).toBe(16);
    expect(Math.round(800 - (box.y + box.height))).toBe(16);

    await button(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).toHaveAttribute("role", "dialog");
    await expect(button(page)).toHaveCount(0);
    // 開いたら入力欄にフォーカスがある
    const text = panel(page).locator("textarea");
    await expect(text).toBeFocused();

    // 空のまま送ると、送らずに理由を出す
    await panel(page).getByRole("button", { name: "送る" }).click();
    await expect(panel(page).getByText("内容を書いてください")).toBeVisible();
    expect(rows).toHaveLength(0);

    await text.fill("  出走表にモーターの直近の成績も並べてほしい  ");
    await expect(panel(page).getByText("内容を書いてください")).toHaveCount(0);
    await panel(page).getByText("欲しい機能", { exact: true }).click();
    // 星はラベル（見えている星）を押して選ぶ。押した星までが塗られる
    await panel(page).locator(".site-fb-star").nth(3).click();
    await expect(
      panel(page).getByRole("radio", { name: "5段階の4（満足）" }),
    ).toBeChecked();
    await expect(panel(page).locator(".site-fb-star.is-on")).toHaveCount(4);
    await panel(page).getByRole("button", { name: "送る" }).click();

    await expect(panel(page).getByText("受け取りました")).toBeVisible();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      kind: "feature",
      comment: "出走表にモーターの直近の成績も並べてほしい",
      rating: 4,
      page_type: "home",
      lang: "ja",
      client_key: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
    });

    // 閉じるとボタンが戻り、フォーカスもボタンに戻る。次に開くと空から始まる
    await panel(page).getByRole("button", { name: "閉じる" }).last().click();
    await expect(panel(page)).toHaveCount(0);
    await expect(button(page)).toBeFocused();
    await button(page).click();
    await expect(panel(page).locator("textarea")).toHaveValue("");
    await expect(panel(page).locator("input:checked")).toHaveCount(0);
  });

  test("種類と満足度を選ばなくても送れる（null で送る）。選んだものはもう一度押すと外れる", async ({
    page,
  }) => {
    const rows = await captureFeedbackPosts(page);
    await page.goto("/today");
    await button(page).click();
    const chip = panel(page).getByText("その他", { exact: true });
    await chip.click();
    await expect(
      panel(page).locator(".site-fb-chip input:checked"),
    ).toHaveCount(1);
    await chip.click();
    await expect(
      panel(page).locator(".site-fb-chip input:checked"),
    ).toHaveCount(0);
    await panel(page).locator("textarea").fill("使いやすいです");
    await panel(page).getByRole("button", { name: "送る" }).click();
    await expect(panel(page).getByText("受け取りました")).toBeVisible();
    expect(rows[0]).toMatchObject({
      kind: null,
      rating: null,
      comment: "使いやすいです",
      page_type: "today",
    });
  });

  test("送れなかったら理由を出し、書いた内容は残る。もう一度押すと送れる", async ({
    page,
  }) => {
    let fail = true;
    const rows = [];
    await page.route("**/rest/v1/site_feedback*", async (route) => {
      rows.push(route.request().postDataJSON());
      if (fail)
        return route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ code: "P0001", message: "too many overall" }),
        });
      return route.fulfill({ status: 201, body: "" });
    });
    await page.goto("/");
    await button(page).click();
    await panel(page).locator("textarea").fill("レース一覧が見づらい");
    await panel(page).getByRole("button", { name: "送る" }).click();
    await expect(
      panel(page).getByText(
        "送れませんでした。時間をおいてもう一度押してください",
      ),
    ).toBeVisible();
    await expect(panel(page).locator("textarea")).toHaveValue(
      "レース一覧が見づらい",
    );
    fail = false;
    await panel(page).getByRole("button", { name: "送る" }).click();
    await expect(panel(page).getByText("受け取りました")).toBeVisible();
    expect(rows).toHaveLength(2);
  });

  test("Esc と背景のクリックで閉じ、書きかけは残る。Tab はパネルの外へ出ない", async ({
    page,
  }) => {
    await captureFeedbackPosts(page);
    await page.goto("/");
    await button(page).click();
    await panel(page).locator("textarea").fill("書きかけ");
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
    await expect(button(page)).toBeFocused();

    await button(page).click();
    await expect(panel(page).locator("textarea")).toHaveValue("書きかけ");
    // 最後の操作できる部品（送る）から Tab すると先頭（閉じる ×）へ戻る
    await panel(page).getByRole("button", { name: "送る" }).focus();
    await page.keyboard.press("Tab");
    await expect(panel(page).locator(".site-fb-x")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      panel(page).getByRole("button", { name: "送る" }),
    ).toBeFocused();

    await page
      .getByTestId("site-feedback-scrim")
      .click({ position: { x: 10, y: 10 } });
    await expect(panel(page)).toHaveCount(0);
  });

  test("広い幅の小窓では後ろのページのスクロールを止めない（スクロールバーが消えて本文が横にずれない）", async ({
    page,
  }) => {
    await page.goto("/");
    const state = () =>
      page.evaluate(() => ({
        overflow: document.body.style.overflow,
        width: document.documentElement.clientWidth,
      }));
    const before = await state();
    await button(page).click();
    await expect(panel(page)).toBeVisible();
    expect(await state()).toEqual(before);
  });

  // 画面の中の移動（ページを読み込み直さない）で確かめる。読み込み直すと状態ごと消えて、何も確かめられない
  const ANALYSIS_LINK = 'header a[href="/winning-technique"]';

  test("戻る→進むで同じ画面へ戻っても、パネルは勝手に開き直さない。書きかけは残る", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(button(page)).toBeVisible({ timeout: 25000 });
    await page.locator(ANALYSIS_LINK).first().click();
    await expect(page).toHaveURL(/\/winning-technique$/);
    await button(page).click();
    await panel(page).locator("textarea").fill("書きかけ");
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(panel(page)).toHaveCount(0);
    await page.goForward();
    await expect(page).toHaveURL(/\/winning-technique$/);
    await expect(button(page)).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    // 画面を移って閉じたときは、右下のボタンへフォーカスを移さない（移った先のフォーカスを横取りしない）
    await expect(button(page)).not.toBeFocused();
    await button(page).click();
    await expect(panel(page).locator("textarea")).toHaveValue("書きかけ");
  });

  test("送った後に画面を移って閉じても、次に開くと空の入力から始まる", async ({
    page,
  }) => {
    await captureFeedbackPosts(page);
    await page.goto("/");
    await expect(button(page)).toBeVisible({ timeout: 25000 });
    await page.locator(ANALYSIS_LINK).first().click();
    await expect(page).toHaveURL(/\/winning-technique$/);
    await button(page).click();
    await panel(page).locator("textarea").fill("送ってから戻る");
    await panel(page).getByRole("button", { name: "送る" }).click();
    await expect(panel(page).getByText("受け取りました")).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(panel(page)).toHaveCount(0);
    await button(page).click();
    await expect(panel(page).getByText("受け取りました")).toHaveCount(0);
    await expect(panel(page).locator("textarea")).toHaveValue("");
  });

  test("送っている間にもう一度押しても2件は送らない。フォーカスはパネルの中に残り、Esc で閉じられる", async ({
    page,
  }) => {
    const rows = [];
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    await page.route("**/rest/v1/site_feedback*", async (route) => {
      rows.push(route.request().postDataJSON());
      await held;
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ code: "P0001", message: "too many overall" }),
      });
    });
    await page.goto("/");
    await button(page).click();
    await panel(page).locator("textarea").fill("二度押し");
    const send = panel(page).locator(".site-fb-send");
    await send.click();
    await expect(send).toHaveText("送っています…");
    await expect(send).toHaveAttribute("aria-disabled", "true");
    // フォーカスは「送る」に残っている。もう一度（Enter で）押しても2件目は送らない
    await expect(send).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(send).toBeFocused();
    release();
    await expect(
      panel(page).getByText(
        "送れませんでした。時間をおいてもう一度押してください",
      ),
    ).toBeVisible();
    expect(rows).toHaveLength(1);
    // 失敗の後もフォーカスはパネルの中にあり、Esc が効く
    await expect(send).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
  });

  test("種類と満足度はキーボードで選べる（選んだ組の Tab は1か所、矢印で動き、Space で外れる）", async ({
    page,
  }) => {
    await page.goto("/");
    await button(page).click();
    await expect(panel(page).locator("textarea")).toBeFocused();
    await page.keyboard.press("Tab");
    const kinds = panel(page).locator(".site-fb-chip input");
    const stars = panel(page).locator(".site-fb-star input");
    await expect(kinds.first()).toBeFocused();
    await page.keyboard.press("Space");
    await expect(kinds.first()).toBeChecked();
    await page.keyboard.press("ArrowRight");
    await expect(kinds.nth(1)).toBeChecked();
    // 次の Tab は星へ（種類の残りには止まらない）
    await page.keyboard.press("Tab");
    await expect(stars.first()).toBeFocused();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(stars.nth(2)).toBeChecked();
    await expect(panel(page).locator(".site-fb-star.is-on")).toHaveCount(3);
    await expect(panel(page).locator(".site-fb-star-cap")).toHaveText(
      "どちらでもない",
    );
    // 選んである物で Space を押すと外れる
    await page.keyboard.press("Space");
    await expect(panel(page).locator(".site-fb-star.is-on")).toHaveCount(0);
    await expect(
      panel(page).locator(".site-fb-star input:checked"),
    ).toHaveCount(0);
    await kinds.nth(1).focus();
    await page.keyboard.press("Space");
    await expect(
      panel(page).locator(".site-fb-chip input:checked"),
    ).toHaveCount(0);
  });

  test("空のまま「送る」を押すと、入力欄へフォーカスが移る", async ({
    page,
  }) => {
    await page.goto("/");
    await button(page).click();
    await panel(page).locator(".site-fb-x").focus();
    await panel(page).getByRole("button", { name: "送る" }).click();
    await expect(panel(page).getByText("内容を書いてください")).toBeVisible();
    await expect(panel(page).locator("textarea")).toBeFocused();
    await expect(panel(page).locator("textarea")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

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
    // 読み込みの揺れ（数px の上下）では戻さず、はっきり上へ戻したときだけ戻す
    await page.mouse.wheel(0, -10);
    await expect(button(page)).toHaveClass(/is-mini/);
    await page.mouse.wheel(0, -300);
    await expect(button(page)).not.toHaveClass(/is-mini/);
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

  // 出さない画面。先にその画面に固有の物が見えるのを待つ（白い画面のまま「無い」で通さない）
  for (const [path, own] of [
    [`${RACE_PATH}/assist`, ".ta-header-row"],
    ["/share/today-sheet", "[class^='today-sheet']"],
  ]) {
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
