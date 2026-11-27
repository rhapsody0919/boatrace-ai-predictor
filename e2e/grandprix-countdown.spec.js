import { test, expect } from "./fixtures.js";
import { PRIZE_RANKING } from "../src/data/grandPrixFeature.js";

// グランプリの特集（/grandprix、BOA-1724）の日数の帯と賞金の棒。帯は日付で変わるので時計を置いて試す
const at = (page, iso) => page.clock.setFixedTime(new Date(iso));

test("開幕前は日数、開催中は日目、終了後は終わりの帯", async ({ page }) => {
  await at(page, "2026-11-27T12:00:00+09:00");
  await page.goto("/grandprix");
  await expect(page.locator(".gp-countdown")).toContainText("18日開幕まで（12/15）");

  await at(page, "2026-12-17T12:00:00+09:00");
  await page.goto("/grandprix");
  await expect(page.locator(".gp-countdown")).toContainText("3日目開催中");

  await at(page, "2026-12-21T12:00:00+09:00");
  await page.goto("/grandprix");
  await expect(page.locator(".gp-countdown")).toContainText("開催は終わりました");
});

test("賞金の棒は確定の値が入るまで出さない", async ({ page }) => {
  await page.goto("/grandprix");
  const section = page.locator("section[aria-labelledby=gp-prize-h]");
  await expect(section).toBeVisible();
  if (PRIZE_RANKING.confirmed) {
    await expect(section.locator(".gp-prize-row")).toHaveCount(18);
    await expect(section.locator(".gp-group--cut")).toHaveCount(1);
  } else {
    await expect(section.locator(".gp-prize")).toHaveCount(0);
    await expect(section).toContainText("決まりしだい");
  }
});
