import { test, expect } from "./fixtures.js";

// BOA-1369: 英語の枠番の表記を Lane にそろえる。
const VENUE = 2;

const outcome = {
  venue_code: VENUE,
  venue_name: "戸田",
  total_races: 40,
  last_updated: "2026-10-01",
  data: {
    1: [{ second_boat: 2, third_boat: 3, count: 20, probability: 50 }],
    3: [
      { second_boat: 1, third_boat: 2, count: 10, probability: 24.96 },
      { second_boat: 4, third_boat: 5, count: 10, probability: 24.96 },
    ],
  },
};

const techniqueRows = [
  {
    boat_number: 1,
    winning_technique: "逃げ",
    count_90days: 2,
    total_races: 2,
    percentage: 100,
  },
  {
    boat_number: 3,
    winning_technique: "まくり",
    count_90days: 1,
    total_races: 2,
    percentage: 50,
  },
  {
    boat_number: 3,
    winning_technique: "まくり差し",
    count_90days: 1,
    total_races: 2,
    percentage: 50,
  },
].map((r) => ({
  id: 1,
  venue_code: VENUE,
  last_updated: "2026-10-01",
  created_at: null,
  ...r,
}));

test.beforeEach(async ({ page }) => {
  await page.route("**/api/outcome-distribution*", (route) =>
    route.fulfill({ json: outcome }),
  );
  await page.route("**/rest/v1/winning_technique_stats*", (route) =>
    route.fulfill({ json: techniqueRows }),
  );
});

// 発走前のレースがある日は会場カードごと折りたたまれる（BOA-546）ので、そのときは先に開く
async function openDetails(page, path) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  const details = page.getByTestId("venue-details");
  await details.waitFor({ state: "attached", timeout: 30000 });
  const cardFold = page.locator(
    ".venue-characteristics-card .collapsible-section",
  );
  if (
    (await cardFold.count()) > 0 &&
    !(await cardFold.evaluate((el) => el.open))
  ) {
    await cardFold.locator("summary").first().click();
  }
  return details;
}

test("英語のもっと詳しくでは枠番を Lane で統一する（BOA-1369）", async ({ page }) => {
  const details = await openDetails(page, `/en/venue/${VENUE}`);
  await details.locator("summary").click();

  await expect(details.locator("thead th").first()).toHaveText("Lane");
  await expect(details).not.toContainText("boat number");
  await expect(details).not.toContainText(/\bBoat\b/);
  await expect(details).toContainText("each lane won");
  await expect(details).toContainText("lanes with few wins");

  await expect(details).toContainText("Top 2");
  await expect(page.getByTestId("venue-details-technique-3")).toContainText(
    "2 wins",
  );
  await expect(details.getByRole("link")).toHaveAttribute(
    "href",
    `/en/winning-technique?venue_code=${VENUE}&tab=outcome`,
  );
});
