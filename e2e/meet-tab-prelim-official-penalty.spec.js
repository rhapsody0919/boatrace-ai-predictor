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
  // 理由まで出す（「対象外」だけだとスマホで理由が読めない。ファン評価3周目）
  await expect(nasu.locator(".rmt-rank")).toHaveText("途中帰郷（公式）");
  // 順位の対象外は表の末尾（目安の点線の下）に回す（ファン評価3周目）
  await expect(page.locator(".rmt-compare tbody tr").last()).toContainText(
    "奈須",
  );
  // 当社計算の 2.00（4点 / 2走）から減点2を引いて 1.00。行に減点の印を出す（ファン評価1周目 指摘3）
  const nakamura = page.locator(".rmt-compare tbody tr", { hasText: "中村" });
  await expect(nakamura).toContainText("1.00");
  await expect(nakamura.locator(".rmt-penalty")).toHaveText("減点2");
  // 選手カードの出典にも公式の減点を書く（「当社計算」だけだと着順の点と合わない。ファン評価3周目）
  await nakamura.click();
  await expect(page.locator(".rmt-detail-score")).toContainText(
    "1.00（2走・当社計算・公式の減点2）",
  );
  // 途中帰郷の選手は早見の必要得点を出さない。「0」と出て目安に届いたように読まれた（指摘1）
  const nasuForecast = page.locator(".rmt-forecast-table tbody tr", {
    hasText: "奈須",
  });
  await expect(nasuForecast.locator(".rmt-needed")).toHaveText(
    "途中帰郷（公式）",
  );
  // 注記は「今日の番組に残っていても外す」と書き、既存の途中帰郷の定義と食い違わない（指摘2）
  await expect(page.locator(".rmt-rank-note")).toContainText(
    "今日の番組に残っていても順位から外しています",
  );
  // 目安の点線は1本だけ。対象外の奈須（2行目）が目安内の艇の間に挟まっても、
  // その手前に線を引かない（ファン評価2周目 指摘1）
  await expect(page.locator(".rmt-compare tbody tr.is-border-edge")).toHaveCount(
    1,
  );
});

test("表の時点が表示中のレースの日と同じ（後出しになる）なら使わない", async ({
  page,
}) => {
  await openMeetTab(page, "2026-09-22T13:00:00+00:00");
  await expect(page.locator(".rmt-rank-note")).not.toContainText(
    "公式の得点率一覧（",
  );
  const nasu = page.locator(".rmt-compare tbody tr", { hasText: "奈須" });
  await expect(nasu.locator(".rmt-rank")).not.toContainText("途中帰郷");
  const nakamura = page.locator(".rmt-compare tbody tr", { hasText: "中村" });
  await expect(nakamura).toContainText("2.00");
  await expect(nakamura.locator(".rmt-penalty")).toHaveCount(0);
});
