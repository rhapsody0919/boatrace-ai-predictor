/**
 * サイト全体のご意見ボックスの E2E の共通部品（site-feedback.spec.js・site-feedback-placement.spec.js）。
 * 送信は必ず captureFeedbackPosts で受け止める（録画に無い /rest/v1/* は本番へ素通しされるので、本番の表に書かないため）。
 */
import { expect } from "./fixtures.js";

export const RACE_PATH = "/race/2026-09-24-01-03";
export const BLOG_PATH = "/blog/odds-expected-value-guide";

/** site_feedback への POST を受け止め、送られた行を集める。status を変えると失敗を再現できる */
export async function captureFeedbackPosts(page, { status = 201 } = {}) {
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

export const button = (page) => page.getByTestId("site-feedback-button");
export const panel = (page) => page.getByTestId("site-feedback-panel");

/** 2つの要素の箱が重なっていないこと */
export async function expectNoOverlap(a, b) {
  const [x, y] = [await a.boundingBox(), await b.boundingBox()];
  expect(x && y, "両方の要素が画面にある").toBeTruthy();
  const apart =
    x.x + x.width <= y.x ||
    y.x + y.width <= x.x ||
    x.y + x.height <= y.y ||
    y.y + y.height <= x.y;
  expect(apart, `重なっている: ${JSON.stringify({ x, y })}`).toBe(true);
}

/**
 * GA4 に送ったイベントを集める。Cookie は既定で「拒否」なので gtag は読み込まれず、ここで置いた物がそのまま残る
 * （trackEvent は window.gtag があるときだけ送る）
 */
export async function captureGaEvents(page) {
  await page.addInitScript(() => {
    window.__siteFeedbackEvents = [];
    window.gtag = (...args) => window.__siteFeedbackEvents.push(args);
  });
  return () =>
    page.evaluate(() =>
      window.__siteFeedbackEvents
        .filter((a) => a[0] === "event")
        .map((a) => ({ name: a[1], params: a[2] })),
    );
}
