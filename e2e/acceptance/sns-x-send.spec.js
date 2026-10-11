import { test, expect } from "@playwright/test";
let status;
let sent;
test.beforeEach(async ({ page }) => {
  status = {
    connected: false,
    job: null,
    control: {
      paused: true,
      budget_microusd: 10000000,
      reserved_microusd: 300000,
    },
  };
  sent = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (url.pathname.startsWith("/api/")) {
      if (route.request().method() === "POST") {
        sent.push({ path: url.pathname, body: route.request().postDataJSON() });
        if (url.pathname.endsWith("x-send-stop")) status.control.paused = true;
        else
          status.job = {
            state: "queued",
            scheduled_at: sent.at(-1).body.scheduledAt,
          };
      }
      return route.fulfill({ json: { data: status } });
    }
    return route.continue();
  });
});
for (const theme of ["light", "dark"]) {
  test(`${theme}: 未接続表示・停止操作・予約承認・公開不可`, async ({
    page,
  }) => {
    await page.goto("/__x_send_test");
    await page.evaluate(
      (t) => document.documentElement.setAttribute("data-theme", t),
      theme,
    );
    await expect(
      page.getByText("接続準備中。公開・予約送信はまだ利用できません。"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "承認して公開", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "X送信を停止" }).click();
    expect(sent[0].path).toContain("x-send-stop");
    status.connected = true;
    status.control.paused = false;
    await page.reload();
    await page.getByLabel("X予約日時").fill("2099-10-07T12:30");
    await page
      .getByRole("button", { name: "承認して予約", exact: true })
      .click();
    await expect(page.getByText("X送信: 予約・待機中")).toBeVisible();
    expect(sent.at(-1).body.approverId).toBe(
      "22222222-2222-2222-2222-222222222222",
    );
    expect(sent.at(-1).body.scheduledAt).toContain("2099-10-07");
    await page.goto("/__x_send_test?blocked");
    await expect(
      page.getByRole("button", { name: "承認して公開", exact: true }),
    ).toBeDisabled();
  });
  test(`${theme}: 要照合で再送不可`, async ({ page }) => {
    status.connected = true;
    status.control.paused = false;
    status.job = { state: "reconcile" };
    await page.goto("/__x_send_test");
    await page.evaluate(
      (t) => document.documentElement.setAttribute("data-theme", t),
      theme,
    );
    await expect(page.getByText("X送信: 要照合（再送禁止）")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "承認して公開", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText("手動投稿も照合が済むまで停止してください。"),
    ).toBeVisible();
    await page.screenshot({
      path: `../out/reports/2026-10-07-task-03-qa/${theme}-reconcile.png`,
    });
  });
}

for (const failure of ["post-response-lost", "get-after-post-failed"]) {
  test(`${failure}: 操作開始から確定応答まで手動投稿と再承認を閉じる`, async ({
    page,
  }) => {
    status.connected = true;
    status.control.paused = false;
    // パネルは10秒ごとに状態を取り直す。回復の確認を実時間の待ちに頼ると、
    // 負荷の高いマシンで間に合わず落ちる（2026-10-08、負荷平均500超で再現）ので仮想の時計で進める
    await page.clock.install();
    await page.goto("/__x_send_test");
    await expect(
      page.getByRole("button", { name: "手動投稿", exact: true }),
    ).toBeVisible();
    let releasePost;
    const postGate = new Promise((resolve) => {
      releasePost = resolve;
    });
    let started;
    const postStarted = new Promise((resolve) => {
      started = resolve;
    });
    let failed = false;
    await page.route("**/api/**/x-send", async (route) => {
      if (route.request().method() === "POST") {
        status.job = { state: "queued" };
        started();
        await postGate;
        failed = true;
        if (failure === "post-response-lost") return route.abort();
        return route.fulfill({ json: { data: status } });
      }
      if (failed)
        return route.fulfill({ status: 500, json: { error: "状態取得失敗" } });
      return route.fulfill({ json: { data: status } });
    });
    await page
      .getByRole("button", { name: "承認して公開", exact: true })
      .click();
    await postStarted;
    await expect(page.getByText("X送信: 要照合（状態未確定）")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "手動投稿", exact: true }),
    ).toHaveCount(0);
    releasePost();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "手動投稿", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "承認して公開", exact: true }),
    ).toBeDisabled();
    failed = false;
    await page.clock.runFor(10_000);
    await expect(page.getByText("X送信: 予約・待機中")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "手動投稿", exact: true }),
    ).toHaveCount(0);
  });
}

test("操作前のpoll応答でunknownを解除しない・取消確定後だけ手動に戻す", async ({
  page,
}) => {
  status.connected = true;
  status.control.paused = false;
  status.job = { state: "queued" };
  await page.clock.install();
  await page.goto("/__x_send_test");
  await expect(page.getByText("X送信: 予約・待機中")).toBeVisible();
  let releaseGet, releasePost, started;
  const getGate = new Promise((resolve) => {
    releaseGet = resolve;
  });
  const postGate = new Promise((resolve) => {
    releasePost = resolve;
  });
  const getStarted = new Promise((resolve) => {
    started = resolve;
  });
  let stale = true;
  await page.route("**/api/**/x-send", async (route) => {
    if (route.request().method() === "POST") {
      await postGate;
      status.job = { state: "cancelled" };
      return route.fulfill({ json: { data: status } });
    }
    if (stale) {
      stale = false;
      started();
      await getGate;
      return route.fulfill({ json: { data: { ...status, job: null } } });
    }
    return route.fulfill({ json: { data: status } });
  });
  await page.clock.fastForward(10000);
  await getStarted;
  await page
    .getByRole("button", { name: "X予約・待機を取消", exact: true })
    .click();
  releaseGet();
  await expect(page.getByText("X送信: 要照合（状態未確定）")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "手動投稿", exact: true }),
  ).toHaveCount(0);
  releasePost();
  await expect(page.getByText("X送信: 承認失効・取消済み")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "手動投稿", exact: true }),
  ).toBeVisible();
});
