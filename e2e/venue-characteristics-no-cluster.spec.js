import { test, expect } from "./fixtures.js";
import { VENUE_SUMMARY_STATS } from "../src/data/venueSummaryStats.js";

/**
 * 会場特徴カードに venues.cluster 由来の「イン強い／アウト強い／バランス型」を出さない（BOA-1202）。
 * cluster は update_venue_stats() の呼び出し元が無く止まっており、直近12か月の実績と
 * 24会場中11会場で食い違う（若松は1コースの1着率が約59%なのに「アウト強い」）。
 * venues の cluster を out_strong に固定し、1号艇の1着率が高い若松で出ないことを確かめる。
 */
const VENUE = 20;

const outcome = {
  venue_code: VENUE,
  venue_name: "若松",
  total_races: 40,
  last_updated: "2026-10-01",
  data: {
    1: [{ second_boat: 2, third_boat: 3, count: 24, probability: 60 }],
    3: [{ second_boat: 1, third_boat: 2, count: 16, probability: 40 }],
  },
};

test("若松の会場特徴カードに「アウト強い」を出さない（BOA-1202）", async ({
  page,
}) => {
  await page.route("**/api/outcome-distribution*", (route) =>
    route.fulfill({ json: outcome }),
  );
  await page.route("**/rest/v1/winning_technique_stats*", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/rest/v1/venues*", (route) => {
    if (!route.request().url().includes("select=cluster")) {
      return route.fallback();
    }
    return route.fulfill({ json: { cluster: "out_strong" } });
  });

  await page.goto(`/venue/${VENUE}`, { waitUntil: "domcontentloaded" });
  const card = page.locator(".venue-characteristics-card");
  await card.waitFor({ state: "attached", timeout: 30000 });
  // カードが描画されたことを、1コースの1着率（直近1年、BOA-1189）の表示で確かめる（空振りで通さない）
  await expect(card).toContainText(
    `${VENUE_SUMMARY_STATS.venues[VENUE].courses[0].rate.toFixed(1)}%`,
  );
  // 折りたたまれていても textContent には出る。見出し・要約・本文の全体で出ないこと
  const text = await card.evaluate((el) => el.textContent ?? "");
  expect(text).not.toContain("アウト強い");
  expect(text).not.toContain("イン強い");
  expect(text).not.toContain("バランス型");
});
