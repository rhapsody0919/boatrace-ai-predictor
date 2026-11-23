import { test, expect } from "./fixtures.js";
import {
  button,
  panel,
  captureFeedbackPosts,
  captureGaEvents,
} from "./site-feedback-helpers.js";

/**
 * サイト全体のご意見ボックス（src/components/siteFeedback/、設計 docs/design/site-feedback-box/spec.md）の
 * 入力・送信・閉じ方・キーボード。置き場所・出さない画面・スマホは site-feedback-placement.spec.js。
 */
test.describe("パソコンの幅（1280px）", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("右下のボタンから開き、内容・種類・満足度を送るとお礼が出て、決まりどおりの1行が送られる", async ({
    page,
  }) => {
    const rows = await captureFeedbackPosts(page);
    const events = await captureGaEvents(page);
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
    expect(
      (await events()).filter((e) => e.name === "site_feedback_open"),
    ).toEqual([
      {
        name: "site_feedback_open",
        params: { feedback_entry: "button", feedback_page_type: "home" },
      },
    ]);
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
    // 送った計測は種類・満足度の有無・ページの種類だけ。書いた内容は送らない
    expect(
      (await events()).filter((e) => e.name === "site_feedback_send"),
    ).toEqual([
      {
        name: "site_feedback_send",
        params: {
          feedback_kind: "feature",
          feedback_rated: true,
          feedback_page_type: "home",
        },
      },
    ]);
    expect(JSON.stringify(await events())).not.toContain("モーターの直近");

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

  test("送れなかったら理由を出し、書いた内容は残る。失敗の種類だけを計測に送る。もう一度押すと送れる", async ({
    page,
  }) => {
    const events = await captureGaEvents(page);
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
    // 失敗の種類（DB のエラーのコード）とページの種類だけ。書いた内容は送らない
    const failed = (await events()).filter(
      (e) => e.name === "site_feedback_send_failed",
    );
    expect(failed).toEqual([
      {
        name: "site_feedback_send_failed",
        params: { error_code: "P0001", feedback_page_type: "home" },
      },
    ]);
    expect(JSON.stringify(await events())).not.toContain("レース一覧");
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
    const rows = await captureFeedbackPosts(page);
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

    // 内容を書いた後でも、ラジオの上の Enter では送らない（選んだつもりの Enter で誤って送らない）
    await panel(page).locator("textarea").fill("Enter で送られないこと");
    await kinds.first().focus();
    await page.keyboard.press("Enter");
    await stars.first().focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    expect(rows).toHaveLength(0);
    await expect(panel(page).getByText("受け取りました")).toHaveCount(0);
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
});
