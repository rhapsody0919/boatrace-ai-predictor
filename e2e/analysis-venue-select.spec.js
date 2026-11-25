import { test, expect } from "./fixtures.js";

// 分析タブの会場の選び（AnalysisVenueSelect）。7つのチャートに同じ24会場の表が字のまま並んでいたのを部品にした（2026-11-25）。
// 値（"01"〜"24"）と表示名が前と同じで、選ぶと見出しの会場が替わること
const venueOf = (url) => new URL(url).searchParams.get("venue_code")?.replace(/^eq\./, "") ?? "01";
const boats = [1, 2, 3, 4, 5, 6];
const topStartRows = (venue) =>
  boats.map((b) => ({
    venue_code: venue, boat_number: b, race_count: 100, top_start_count: 20,
    top_start_rate: 20, win_rate_when_top_start: 50, last_updated: "2026-11-24",
  }));
const losingRows = (venue) =>
  boats.map((b) => ({
    venue_code: venue, boat_number: b, losing_technique: "逃げ", count_90days: 10,
    total_losses_90days: 20, percentage: 50, last_updated: "2026-11-24",
  }));
const CASES = [
  { tab: "topstart", id: "#top-start-venue-select", table: "top_start_stats", rows: topStartRows },
  { tab: "losing", id: "#losing-venue-select", table: "losing_technique_stats", rows: losingRows },
];

for (const { tab, id, table, rows } of CASES) {
  test(`${tab} の会場の選びは24会場を "01"〜"24" で出し、選ぶと見出しが替わる`, async ({ page }) => {
    // 集計の表は日次のバッチの値で録画に無いので、行を差し替える（会場は問い合わせの venue_code のまま返す）
    await page.route(`**/rest/v1/${table}*`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows(venueOf(route.request().url()))) }),
    );
    await page.goto(`/winning-technique?tab=${tab}`);
    const select = page.locator(id);
    await expect(select).toBeVisible();
    const options = select.locator("option");
    await expect(options).toHaveCount(24);
    const values = await options.evaluateAll((els) => els.map((e) => e.value));
    expect(values).toEqual(Array.from({ length: 24 }, (_, i) => String(i + 1).padStart(2, "0")));
    await expect(options.first()).toHaveText("桐生");
    await expect(options.nth(11)).toHaveText("住之江");
    await expect(options.last()).toHaveText("大村");
    await expect(page.locator(`label[for="${id.slice(1)}"]`)).toBeVisible();

    await select.selectOption("12");
    await expect(select).toHaveValue("12");
    await expect(page.locator(".summary-info strong").first()).toHaveText("住之江");
  });
}
