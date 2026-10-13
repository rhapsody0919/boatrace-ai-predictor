import { test, expect, fetchRecorded } from "./fixtures.js";

test.describe.configure({ timeout: 180_000 });

const PERIOD_STATS = /\/rest\/v1\/racer_period_stats/;

async function hidePreviousTerm(page) {
  await page.route(PERIOD_STATS, async (route) => {
    const response = await fetchRecorded(route);
    const body = await response.json().catch(() => null);
    if (!Array.isArray(body)) return route.fulfill({ response });
    // 前期（2026年2期）の行を抜く。「前期を取り込んだか」の確認（period_year=eq.2026&period_no=eq.2、
    // racer_id だけを返す）は列で見分けられないので、URL で見分けて空にする
    const url = route.request().url();
    const isLatestCheck =
      url.includes("period_year=eq.2026") && url.includes("period_no=eq.2");
    const json = isLatestCheck
      ? []
      : body.filter((r) => !(r.period_year === 2026 && r.period_no === 2));
    // 書き換えた本文と食い違うので、元の長さ・圧縮のヘッダは渡さない
    const headers = { ...response.headers() };
    delete headers["content-length"];
    delete headers["content-encoding"];
    await route.fulfill({ status: response.status(), headers, json });
  });
}

async function openConditions(page, race) {
  await hidePreviousTerm(page);
  await page.goto(`/race/${race}`);
  await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
  await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
    timeout: 25000,
  });
  await page.locator(".rbit-bar-row").first().click();
  await page.locator(".rbit-expanded-tab", { hasText: "条件別" }).click();
  await expect(page.locator(".rbit-period-recent-counts")).toBeVisible();
}

async function recentGeometry(page) {
  return page.locator(".rbit-period-recent").evaluate((el) => {
    const counts = el.querySelector(".rbit-period-recent-counts");
    const parent = el.getBoundingClientRect();
    const rect = counts.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el.firstChild);
    const text = range.getBoundingClientRect();
    return {
      top: rect.top - parent.top,
      left: rect.left - parent.left,
      gap: rect.left - text.right,
      expectedGap: parseFloat(getComputedStyle(el).fontSize) * 0.25,
      lines:
        rect.height / (parseFloat(getComputedStyle(counts).lineHeight) || 18),
    };
  });
}

test("375pxの回数は折り返して左端にそろう", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await openConditions(page, "2026-05-20-01-12");
  // 375pxで折り返すかはフォントで変わる（CI の Linux では1行に収まった）。範囲の文字と回数の
  // 長い方の幅に絞り、必ず折り返す状態で行頭の余白を見る
  await page.locator(".rbit-period-recent").evaluate((el) => {
    const counts = el.querySelector(".rbit-period-recent-counts");
    const range = document.createRange();
    range.selectNodeContents(el.firstChild);
    const width = Math.max(
      range.getBoundingClientRect().width,
      counts.getBoundingClientRect().width,
    );
    el.style.width = `${Math.ceil(width) + 1}px`;
  });
  const geometry = await recentGeometry(page);
  expect(geometry.top).toBeGreaterThan(5);
  expect(Math.abs(geometry.left)).toBeLessThanOrEqual(0.5);
  expect(geometry.lines).toBeLessThan(1.5);
});

test("1440pxでは範囲と回数の間に0.25emの間隔を残す", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openConditions(page, "2026-05-20-01-12");
  const geometry = await recentGeometry(page);
  expect(Math.abs(geometry.top)).toBeLessThanOrEqual(5);
  expect(Math.abs(geometry.gap - geometry.expectedGap)).toBeLessThanOrEqual(
    0.5,
  );
});

test("差を出さない理由も12pxの本文色で表示する", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openConditions(page, "2026-09-29-13-12");
  const notes = page.locator(".rbit-period-note");
  await expect(notes).toHaveCount(2);
  await expect(notes.first()).toHaveClass(/rbit-period-pending/);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute("data-theme", value),
      theme,
    );
    await expect(notes.first()).toHaveCSS("font-size", "12px");
    await expect(notes.nth(1)).toHaveCSS("font-size", "12px");
    const color = await notes
      .first()
      .evaluate((el) => getComputedStyle(el).color);
    await expect(notes.nth(1)).toHaveCSS("color", color);
  }
});
