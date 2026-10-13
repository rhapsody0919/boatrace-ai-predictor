import { test, expect } from "./fixtures.js";

/**
 * 予選中の今節タブに、公式の得点率一覧の前夜の減点と途中帰郷だけを足す（BOA-782）。
 *
 * 予選中の得点率・順位は当社計算のまま（当日の走を数える）。当社は減点と公式の備考を
 * 持たず、三国G1 10/6 に白井英治（公式14位・減点10）を2位と出し、公式で途中帰郷の選手を
 * 順位に残した。オーナー決定（2026-10-13）で、この2つだけを前夜の公式の表から借りる。
 *
 * 桐生 2026-09-20〜 の節は公式の得点率一覧が無い（一般戦）ので、前夜（9/21 22:00 JST）に
 * 取得した表を差し込む。表示するのは 9/22 3R（予選中）:
 * - 1号艇 中村駿平（6着・5着 = 4点 / 2走 = 2.00）に減点2 → 1.00
 * - 2号艇 奈須啓太が公式の備考で途中帰郷
 */

const RACE_ID = "2026-09-22-01-03";

function officialRows(scrapedAt) {
  return [
    {
      racer_id: 5061,
      remarks: null,
      placements: "６　５",
      total_points: 4,
      penalty_points: 2,
      scraped_at: scrapedAt,
    },
    {
      racer_id: 4330,
      remarks: "途中帰郷",
      placements: "３",
      total_points: 7,
      penalty_points: 0,
      scraped_at: scrapedAt,
    },
  ];
}

async function openMeetTab(page, scrapedAt) {
  await page.route(/\/rest\/v1\/racer_series_points/, (route) =>
    route.fulfill({ json: officialRows(scrapedAt) }),
  );
  await page.goto(`/race/${RACE_ID}`);
  await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
  await expect(page.locator(".rmt-compare tbody tr").first()).toBeVisible({
    timeout: 30000,
  });
}

test("前夜の公式の表があれば、減点を引き、途中帰郷を順位から外し、時点を注記する", async ({
  page,
}) => {
  await openMeetTab(page, "2026-09-21T13:00:00+00:00");
  await expect(page.locator(".rmt-rank-note")).toContainText(
    "公式の得点率一覧（9/21終了時点）",
  );
  const nasu = page.locator(".rmt-compare tbody tr", { hasText: "奈須" });
  await expect(nasu.locator(".rmt-rank")).toContainText("対象外");
  // 当社計算の 2.00（4点 / 2走）から減点2を引いて 1.00
  const nakamura = page.locator(".rmt-compare tbody tr", { hasText: "中村" });
  await expect(nakamura).toContainText("1.00");
});

test("表の時点が表示中のレースの日と同じ（後出しになる）なら使わない", async ({
  page,
}) => {
  await openMeetTab(page, "2026-09-22T13:00:00+00:00");
  await expect(page.locator(".rmt-rank-note")).not.toContainText(
    "公式の得点率一覧（",
  );
  const nasu = page.locator(".rmt-compare tbody tr", { hasText: "奈須" });
  await expect(nasu.locator(".rmt-rank")).not.toContainText("対象外");
  const nakamura = page.locator(".rmt-compare tbody tr", { hasText: "中村" });
  await expect(nakamura).toContainText("2.00");
});
