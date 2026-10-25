import { test, expect } from "./fixtures.js";

// レースの日付（日本の暦日）は、閲覧者の端末のタイムゾーンでなく Asia/Tokyo で出す（BOA-1092）。
// JST より西の端末（英語・海外の利用者）で、/races の日付カードが1日前（リンク先 /races/2026-10-24 に
// 「10/23(金)」）になり、会場の傾向パネルの集計基準日も前日になっていた。
// 端末のタイムゾーンを日付変更線の西側（UTC・ロサンゼルス）にして、日本の暦日のまま出ることを見る
for (const timezoneId of ["UTC", "America/Los_Angeles"]) {
  test.describe(`端末のタイムゾーンが ${timezoneId}`, () => {
    test.use({ timezoneId });

    test("過去のレース一覧の日付カードと月の見出しは日本の暦日で出る", async ({
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
          json: { days: [day("2026-10-25"), day("2026-10-01")] },
        }),
      );
      await page.goto("/races");
      // 端末のタイムゾーンが本当に効いていること（効いていなければこの試験は何も見ていない）
      expect(
        await page.evaluate(
          () => new Date("2026-10-25T00:00:00+09:00").getDate(),
        ),
      ).toBe(24);
      const month = page.locator(".month-group").first();
      // 月の1日が前月に化けて、10月の中に「9/30」が出ていた
      await expect(month.locator("h2")).toHaveText(/2026年10月/);
      await expect(month.locator(".date-card h3")).toHaveText([
        "10/25(日)",
        "10/1(木)",
      ]);
      await expect(month.locator(".date-card").first()).toHaveAttribute(
        "href",
        "/races/2026-10-25",
      );
      await expect(page.locator(".month-group")).toHaveCount(1);
    });

    test("開催日の会場一覧の見出し・title は日本の暦日で出る", async ({
      page,
    }) => {
      // /races/:date の h1・title・パンくずは URL の日付を formatDate で出す。端末が JST より西だと前日になっていた
      await page.goto("/races/2026-09-18");
      await expect(page).toHaveTitle(/^2026年9月18日\(金\)のAI予想データ/);
      await expect(
        page.locator("h1", { hasText: "2026年9月18日(金)" }),
      ).toBeVisible();
    });

    test("レース詳細の会場の傾向パネルの集計基準日は日本の暦日で出る", async ({
      page,
    }) => {
      // JST 2026-10-25 00:30 は UTC・ロサンゼルスでは 10/24
      await page.route("**/rest/v1/winning_technique_stats**", (route) =>
        route.fulfill({
          json: [
            {
              venue_code: 2,
              boat_number: 1,
              winning_technique: "逃げ",
              count_90days: 10,
              percentage: 50,
              total_races: 20,
              last_updated: "2026-10-25T00:30:00+09:00",
            },
          ],
        }),
      );
      await page.addInitScript(() =>
        localStorage.setItem("boatai-language", "ja"),
      );
      await page.goto("/race/2026-09-18-02-08");
      await page
        .locator(".race-tabs-btn", { hasText: "基本情報" })
        .click({ timeout: 20000 });
      await expect(
        page.locator(".venue-tendency-panel .vtp-updated"),
      ).toContainText("2026/10/25", { timeout: 15000 });
    });
  });
}

// BOA-1101: 同じ取得時刻を端末の時差・表示言語によらず日本時間で表示する。
for (const timezoneId of ["America/Los_Angeles", "Asia/Tokyo"]) {
  test.describe(`更新時刻: ${timezoneId}`, () => {
    test.use({ timezoneId });
    for (const lang of ["ja", "en"]) {
      test(`${lang} の更新時刻と相対表示`, async ({ page }) => {
        await page.clock.setFixedTime(new Date("2026-10-25T00:05:00Z"));
        await page.addInitScript((language) => {
          localStorage.setItem("boatai-language", language);
        }, lang);
        await page.route("**/rest/v1/**", (route) =>
          route.fulfill({ json: [] }),
        );
        await page.route("**/api/races/today", (route) =>
          route.fulfill({
            json: {
              success: true,
              data: [],
              scrapedAt: "2026-10-25T00:00:00Z",
            },
          }),
        );
        await page.goto(lang === "ja" ? "/" : "/en/");
        expect(await page.evaluate(() =>
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        )).toBe(timezoneId);
        const status = page.locator(".update-text");
        await expect(status).toContainText(
          lang === "ja" ? "10/25 09:00" : "10/25 09:00 JST",
        );
        if (lang === "ja") await expect(status).not.toContainText("JST");
        await expect(status.locator(".update-relative")).toContainText(
          lang === "ja" ? "5分前" : "Updated 5 min ago",
        );
      });
    }
  });
}
