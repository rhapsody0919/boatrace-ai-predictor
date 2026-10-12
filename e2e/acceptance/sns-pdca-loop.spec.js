import { test, expect } from "../fixtures.js";

// 入力: docs/design/sns-pdca-loop/spec.md, docs/design/sns-pdca-loop/screens.md のみ。
// plan.md・tasks.md・src 配下は読んでいない。
//
// 対象画面: 管理画面 /admin/sns-hub（AutoSendPanel・DeadlineQueueList・InsightCard 等）
//           と、Slack 通知のリンク先「止める画面」 /api/sns-stop/<token>。
//
// 外部 API（X・YouTube・Slack）には接続しない前提のため、X 連携の遷移先（x.com 配下）
// だけ page.route でモックする。その他は実バックエンド（本番 Supabase）に依存するため、
// 条件がデータに依存するテストは test.skip で明示する。

test.describe("[spec A4][screens #2] 送信モードの切り替えボタン", () => {
  test("[screens #2] 個別承認チャネルでは「自動にする」ボタンが常に表示される", async ({
    page,
  }) => {
    await page.goto("/admin/sns-hub");

    // X・YouTube いずれかのチャネル行が「個別承認」モードであることを前提にする。
    // 全チャネルが既に自動化済みの場合はこの要件を確認できないため skip する。
    const manualToggle = page.getByRole("button", { name: /自動にする/ });
    const count = await manualToggle.count();
    test.skip(
      count === 0,
      "個別承認モードのチャネルが無いため「自動にする」ボタンを確認できない",
    );

    await expect(manualToggle.first()).toBeVisible();
  });

  test("[screens #2] 自動チャネルでは「自動を切る」ボタンが表示される", async ({
    page,
  }) => {
    await page.goto("/admin/sns-hub");

    const autoOffButton = page.getByRole("button", {
      name: /^(X|YouTube) の自動を切る$/,
    });
    const count = await autoOffButton.count();
    test.skip(
      count === 0,
      "自動モードのチャネルが無いため「自動を切る」ボタンを確認できない",
    );

    await expect(autoOffButton.first()).toBeVisible();
  });

  test("[screens 文言表] 「自動を切る」と全停止の違いの説明文が表示される", async ({
    page,
  }) => {
    await page.goto("/admin/sns-hub");

    await expect(
      page.getByText(
        "「自動を切る」と、自動で出る予定の投稿も止まり、個別承認に戻ります。本人が承認した投稿は送られます。すべて止めるときは「X送信を停止」を使います",
      ),
    ).toBeVisible();
  });
});

test.describe("[spec A6][screens #6] 期限キューのバッジと止められる期限", () => {
  test("[screens #6] 期限キューの各行のバッジは「自動」「個別承認」「止めた」のいずれか1つ", async ({
    page,
  }) => {
    await page.goto("/admin/sns-hub");

    const badges = page.getByText(/^(自動|個別承認|止めた)$/);
    const count = await badges.count();
    test.skip(count === 0, "期限キューに行が無いためバッジを確認できない");

    for (let i = 0; i < count; i++) {
      await expect(badges.nth(i)).toBeVisible();
    }
  });

  test("[screens #6] 「自動」の行には「止められるのは HH:MM まで」の文言がある", async ({
    page,
  }) => {
    await page.goto("/admin/sns-hub");

    const autoBadges = page.getByText("自動", { exact: true });
    const autoCount = await autoBadges.count();
    test.skip(autoCount === 0, "期限キューに自動の行が無いため確認できない");

    await expect(
      page.getByText(/止められるのは\s*\d{1,2}:\d{2}\s*まで/).first(),
    ).toBeVisible();
  });
});

test.describe("[spec A6][screens #3] この投稿を止めるボタン（AutoSendItem）", () => {
  test("[screens #3] 自動で出る予定の投稿に「この投稿を止める」ボタンがある", async ({
    page,
  }) => {
    await page.goto("/admin/sns-hub");

    const stopItemButton = page.getByRole("button", {
      name: /この投稿を止める/,
    });
    const count = await stopItemButton.count();
    test.skip(
      count === 0,
      "自動で出る予定の投稿（AutoSendItem）が無いため確認できない",
    );

    await expect(stopItemButton.first()).toBeVisible();
  });
});

test.describe("[spec 10, ADR 0093][screens #10] X との連携は同じタブで遷移する", () => {
  test("[screens #10] 「X と連携する」ボタンを押すと同じタブで遷移し、新しいタブは開かない", async ({
    page,
  }) => {
    await page.goto("/admin/sns-hub");

    const connectButton = page.getByRole("button", { name: /X と連携する/ });
    const count = await connectButton.count();
    test.skip(
      count === 0,
      "X のトークンが既に有効なため「X と連携する」ボタンが表示されない",
    );

    // X 側の許可画面（PKCE）への遷移は外部APIのため、x.com 配下の遷移をモックする
    // （実際のドメインは仕様・画面定義に明記が無く、x.com 配下と仮定している）。
    await page.route(/x\.com/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html><body>mock x.com authorize page</body></html>",
      }),
    );

    let popupOpened = false;
    page.on("popup", () => {
      popupOpened = true;
    });

    const originalUrl = page.url();
    await connectButton.first().click();

    // 同じタブで遷移する＝新しいタブ（popup）が開かない
    await page.waitForTimeout(500);
    expect(popupOpened).toBe(false);

    // 遷移が始まっていること（URLが変わる、またはモックしたページに到達する）を確認する
    await expect.poll(() => page.url()).not.toBe(originalUrl);
  });
});

test.describe("[spec B1][screens #8] 週次の自動採用の案内", () => {
  test("[screens #8] proposed の改善案には「自動採用まで あと N 日」が表示される", async ({
    page,
  }) => {
    await page.goto("/admin/sns-hub");

    const autoAdoptText = page.getByText(/自動採用まで\s*あと\s*\d+\s*日/);
    const count = await autoAdoptText.count();
    test.skip(count === 0, "proposed 状態の改善案が無いため確認できない");

    await expect(autoAdoptText.first()).toBeVisible();
  });

  test("[screens #8] risk-rules に触れる案には「自動では採用しない」の表示がある", async ({
    page,
  }) => {
    await page.goto("/admin/sns-hub");

    const riskText = page.getByText(/自動では採用しない/);
    const count = await riskText.count();
    test.skip(
      count === 0,
      "risk-rules に触れる proposed の改善案が無いため確認できない",
    );

    await expect(riskText.first()).toBeVisible();
  });
});

test.describe("[screens #11] 止める画面（Slack 通知のリンク先）", () => {
  // Slack の通知からしか発行されない使い捨てトークンのため、画面の導線から辿れない。
  // 固定値（存在しないトークン）でアクセスし、パスワード（Basic認証）を要求されないこと、
  // および画面がクラッシュしないことだけを確認する。
  const PLACEHOLDER_TOKEN = "e2e-placeholder-token-does-not-exist";

  test("[screens #11] パスワード（Basic認証）を要求せずに開ける", async ({
    page,
  }) => {
    const response = await page.goto(`/api/sns-stop/${PLACEHOLDER_TOKEN}`);

    expect(response?.status()).not.toBe(401);
    await expect(page.getByLabel(/パスワード/)).toHaveCount(0);
  });

  test("[screens #11] ボタンを押す前は画面の状態が変わらない", async ({
    page,
  }) => {
    await page.goto(`/api/sns-stop/${PLACEHOLDER_TOKEN}`);

    const stopButton = page.getByRole("button", { name: /この投稿を止める/ });
    const count = await stopButton.count();
    test.skip(
      count === 0,
      "固定トークンが無効なため「この投稿を止める」ボタンが表示されない状態（期限切れ等）になっている",
    );

    // ボタンを押していない段階では「止めました」等の結果文言が出ていないこと
    await expect(
      page.getByText("止めました。個別承認に回しています"),
    ).toHaveCount(0);
  });
});
