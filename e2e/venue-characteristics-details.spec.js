import { test, expect } from "./fixtures.js";

/**
 * 会場特徴カードの「もっと詳しく」（BOA-269）。
 * 出目分布（/api/outcome-distribution）と決まり手（winning_technique_stats）を固定値に差し替え、
 * 枠番別の2連率・3連率の合算と、決まり手の全内訳が画面に出ることを確かめる。
 *
 * 固定値（40レース。カードは20レース未満の会場を出さない）:
 *   1-2-3 が20回、3-1-2 が10回、3-4-5 が10回
 *   → 1号艇: 1着50% / 2連75% / 3連75%、3号艇: 1着50% / 2連50% / 3連100%
 */
const VENUE = 2;

const outcome = {
  venue_code: VENUE,
  venue_name: "戸田",
  total_races: 40,
  last_updated: "2026-10-01",
  data: {
    1: [{ second_boat: 2, third_boat: 3, count: 20, probability: 50 }],
    3: [
      { second_boat: 1, third_boat: 2, count: 10, probability: 25 },
      { second_boat: 4, third_boat: 5, count: 10, probability: 25 },
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

test("会場特徴カードの「もっと詳しく」に枠番別の2連率・3連率と決まり手の内訳を出す（BOA-269）", async ({
  page,
}) => {
  const details = await openDetails(page, `/venue/${VENUE}`);

  // 初期は閉じている
  await expect(details).not.toHaveAttribute("open", "");
  await details.locator("summary").click();

  const rows = details.locator("tbody tr");
  await expect(rows).toHaveCount(6);
  await expect(rows.nth(0)).toContainText("50.0%");
  await expect(rows.nth(0).locator("td").nth(2)).toHaveText("75.0%");
  await expect(rows.nth(0).locator("td").nth(3)).toHaveText("75.0%");
  await expect(rows.nth(2).locator("td").nth(2)).toHaveText("50.0%");
  await expect(rows.nth(2).locator("td").nth(3)).toHaveText("100.0%");
  await expect(rows.nth(5).locator("td").nth(3)).toHaveText("0.0%");

  // 3号艇の決まり手は全内訳（最多の1つだけではない）。1着2回は小標本の色
  const boat3 = page.getByTestId("venue-details-technique-3");
  await expect(boat3).toContainText("まくり 50%(1)");
  await expect(boat3).toContainText("まくり差し 50%(1)");
  await expect(boat3.locator(".is-small-sample")).toHaveText("1着2回");

  // 勝ちの無い枠は行を出さない
  await expect(page.getByTestId("venue-details-technique-2")).toHaveCount(0);

  // 出目は分析ツールの出目タブへ
  await expect(details.getByRole("link")).toHaveAttribute(
    "href",
    `/winning-technique?venue_code=${VENUE}&tab=outcome`,
  );
});

test("英語では訳語で出す（BOA-269）", async ({ page }) => {
  const details = await openDetails(page, `/en/venue/${VENUE}`);
  await details.locator("summary").click();
  await expect(details).toContainText("Top 2");
  await expect(details).not.toContainText("2連率");
  await expect(page.getByTestId("venue-details-technique-3")).toContainText(
    "2 wins",
  );
  await expect(details.getByRole("link")).toHaveAttribute(
    "href",
    `/en/winning-technique?venue_code=${VENUE}&tab=outcome`,
  );
});
