import { test, expect } from "./fixtures.js";

// /races の月の見出しは新しい月から並ぶ。「2026年10月」を文字列で並べると「9月」より後ろに来ていた
// （2026-10-08、本番で「9月・8月・7月・10月」の順だった）
test("過去のレース一覧の月は新しい順に並び、最新月が開いている", async ({
  page,
}) => {
  const day = (date) => ({
    date,
    totalRaces: 12,
    finishedRaces: 12,
    turnRaces: 12,
    turnHitRate: 50,
  });
  await page.route("**/api/race-history/summary**", (route) =>
    route.fulfill({
      json: {
        days: [
          day("2026-10-02"),
          day("2026-10-01"),
          day("2026-09-30"),
          day("2026-08-15"),
          day("2025-12-31"),
        ],
      },
    }),
  );
  await page.goto("/races");
  const titles = page.locator(".month-group h2");
  await expect(titles).toHaveText([
    /2026年10月/,
    /2026年9月/,
    /2026年8月/,
    /2025年12月/,
  ]);
  // 開いているのは最新月だけ（10月の 2 日分が見える）
  await expect(page.locator(".month-group").first()).toContainText("2日分");
  await expect(page.locator(".month-group .expand-icon").first()).toHaveText(
    "▼",
  );
  await expect(page.locator(".month-group .expand-icon").nth(1)).toHaveText(
    "▶",
  );
});
