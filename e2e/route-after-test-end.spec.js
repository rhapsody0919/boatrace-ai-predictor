import { createServer } from "node:http";
import { test, expect, isRouteAfterEndError } from "./fixtures.js";

/**
 * テストが終わった時に page.route のハンドラの route.fetch が途中でも、実行を失敗にしないことの固定
 * （fixtures.js の guardRoutes）。
 *
 * 画面はテストの終わりの後にも要求を出す。そのハンドラの route.fetch が応答を待っている間に
 * context が閉じると、route.fetch は「route.fetch: Test ended.」で投げる。Playwright はそれを
 * worker の unhandled rejection として、その時に同じ worker で走っているテストを失敗にする
 * （#2281・#2283 の e2e-shard 5/5。race-detail-period-fallback.spec.js の racer_period_stats で
 * 投げ、race-detail-period-note-style.spec.js の 1440px が落ちた）。
 * CI では応答の遅れ方でたまにしか出ないので、ここでは応答を返さないサーバーで毎回同じ状況を作る。
 * guardRoutes を外すと、下の1つ目が後始末（context を閉じる所）で
 * 「while running route callback」で落ちる（手元で20回中20回）。
 */

/** 受け付けるが応答を返さないサーバー（route.fetch をテストの終わりまで待たせる） */
let server;
let lateUrl;

test.beforeAll(async () => {
  // ホストを省いて IPv4・IPv6 の両方で受ける（localhost がどちらに引かれても届く）。
  // URL を localhost にするのは、record モードの外部通信の一覧（fixtures.js の isLocal）に載せないため
  server = createServer(() => {});
  await new Promise((resolve) => server.listen(0, resolve));
  lateUrl = `http://localhost:${server.address().port}/late`;
});

test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

test("テストが終わった時に途中の route.fetch の失敗は捨てる", async ({
  page,
}) => {
  let fetchStarted;
  const started = new Promise((resolve) => {
    fetchStarted = resolve;
  });
  await page.route(lateUrl, async (route) => {
    fetchStarted();
    // 応答が来ないまま、テストの終わりで context が閉じ「Test ended」で投げる
    await route.fetch();
  });
  // ブラウザ側の fetch の応答は待たない（page が閉じると evaluate も失敗するが、ここでは見ない）
  page.evaluate((url) => fetch(url).catch(() => {}), lateUrl).catch(() => {});
  await started;
});

test("テストの終わりの後の失敗だけを捨てる対象にする（ほかの失敗は投げ直す）", () => {
  expect(isRouteAfterEndError(new Error("route.fetch: Test ended."))).toBe(
    true,
  );
  expect(
    isRouteAfterEndError(
      new Error("route.fetch: Test timeout of 180000ms exceeded."),
    ),
  ).toBe(true);
  expect(
    isRouteAfterEndError(
      new Error(
        "route.fulfill: Target page, context or browser has been closed",
      ),
    ),
  ).toBe(true);
  expect(isRouteAfterEndError(new Error("Target closed"))).toBe(true);
  expect(
    isRouteAfterEndError(
      new Error("録画に無いリクエストです（E2E_REPLAY_STRICT=1）"),
    ),
  ).toBe(false);
  expect(isRouteAfterEndError(new Error("Route is already handled!"))).toBe(
    false,
  );
});
