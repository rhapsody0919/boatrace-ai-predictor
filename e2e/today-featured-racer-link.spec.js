import { test, expect } from "./fixtures.js";

const DATE = "2026-09-22";
const RACE_ID = "202609221605";

async function openDigest(page, racerId) {
  await page.route("**/rest/v1/morning_digest_days*", (route) =>
    route.fulfill({
      json: {
        digest_date: DATE,
        generated_at: `${DATE}T00:00:00Z`,
        flying_data_complete: true,
        suppressed_venues: [],
      },
    }),
  );
  await page.route("**/rest/v1/morning_digest_rows*", (route) =>
    route.fulfill({
      json: [{
        section: "featured", rank: 1, racer_id: racerId,
        racer_name: "池田浩二", venue_code: 16, race_id: RACE_ID,
        race_number: 5, boat_number: 1, grade: "A1", course: 1,
        metric_value: 80, sample_size: 40, metric_venue_baseline: 55,
        volatility_percentile: 20, detail: { from: "nige" },
      }],
    }),
  );
  await page.goto(`/today?date=${DATE}`);
  return page.getByRole("region", { name: "今日の注目レース", exact: true });
}

test("/today: 注目レースの選手名から選手ページへ移動する", async ({ page }) => {
  const section = await openDigest(page, 3941);
  await expect(section).toBeVisible();
  const raceLink = section.getByRole("link", { name: "このレースの詳細を見る" });
  await expect(raceLink).toHaveAttribute("href", `/race/${RACE_ID}`);
  await expect(section.locator('a[href^="/race/"]')).toHaveCount(1);
  const link = section.getByRole("link", { name: "池田浩二", exact: true });
  await expect(link).toHaveAttribute("href", "/racer/3941");
  await expect(link).toHaveAttribute("translate", "no");
  await expect(section.locator(".featured-race__racer-name")).toHaveAttribute("translate", "no");
  await expect(link).toHaveCSS("text-decoration-line", "none");
  await link.hover();
  await expect(link).toHaveCSS("text-decoration-line", "underline");
  await link.click();
  await expect(page).toHaveURL(/\/racer\/3941$/);
});

test("/today: 注目レースの登録番号がない選手名は文字だけ表示する", async ({ page }) => {
  const section = await openDigest(page, null);
  const name = section.locator(".featured-race__racer-name");
  await expect(name).toHaveText("池田浩二");
  await expect(name).toHaveAttribute("translate", "no");
  await expect(name.locator("a")).toHaveCount(0);
  await expect(section.locator("a")).toHaveCount(1);
  await expect(section.getByRole("link", { name: "このレースの詳細を見る" }))
    .toHaveAttribute("href", `/race/${RACE_ID}`);
});
