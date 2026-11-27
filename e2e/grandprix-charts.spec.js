import { test, expect } from "./fixtures.js";
import { FLOW, PAST_FINALS } from "../src/data/grandPrixFeature.js";
import { VENUE_SUMMARY_STATS } from "../src/data/venueSummaryStats.js";

// グランプリの特集（/grandprix、BOA-1724）の図: 勝ち上がり・会場と全国の比べ・過去の優勝戦
test("/grandprix の図: 勝ち上がりの段・大村の数字が会場の要約と同じ・過去の優勝戦のカード", async ({ page }) => {
  await page.goto("/grandprix");

  await expect(page.locator(".gp-stage")).toHaveCount(FLOW.length);
  // 出場の段は 2nd から6人・1st から12人の点
  const first = page.locator(".gp-stage").first();
  await expect(first.locator(".gp-dot--2nd")).toHaveCount(6);
  await expect(first.locator(".gp-dot--1st")).toHaveCount(12);

  // 大村の1コースの1着率は会場ページの要約と同じ値（手で写さない）
  const omura = VENUE_SUMMARY_STATS.venues["24"];
  const water = page.locator(".gp-water");
  await expect(water).toContainText(`${omura.courses[0].rate.toFixed(1)}%`);
  await expect(water).toContainText(`${omura.races.toLocaleString("ja-JP")}レース`);
  await expect(water.locator(".baseline-bar")).toHaveCount(6 + 4);

  await expect(page.locator(".gp-final")).toHaveCount(PAST_FINALS.length);
  const wins1 = PAST_FINALS.filter((f) => f.lane === 1).length;
  await expect(page.locator(".gp-lanes")).toContainText(`1号艇の1着は${PAST_FINALS.length}回中${wins1}回`);

  // 375px で横にはみ出さない
  await page.setViewportSize({ width: 375, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
