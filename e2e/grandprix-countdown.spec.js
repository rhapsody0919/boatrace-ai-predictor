import { test, expect } from "./fixtures.js";
import { EDITION, PRIZE_RANKING } from "../src/data/grandPrixFeature.js";
import { formatYenMan, grandPrixPhase } from "../src/pure/grandPrixPhase.js";

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

// 段階の境目（前日は1日・初日は1日目・最終日は6日目・翌日は終了。月・年をまたいでも暦の日）と、賞金の「億・万」の書き方
test("日数の段階と金額の書き方（画面を開かない）", () => {
  const ed = { startDate: "2026-12-15", endDate: "2026-12-20" };
  expect(grandPrixPhase("2026-12-14", ed)).toEqual({ phase: "before", days: 1 });
  expect(grandPrixPhase("2026-12-15", ed)).toEqual({ phase: "during", day: 1 });
  expect(grandPrixPhase("2026-12-20", ed)).toEqual({ phase: "during", day: 6 });
  expect(grandPrixPhase("2026-12-21", ed)).toEqual({ phase: "after" });
  expect(grandPrixPhase("2026-12-31", { startDate: "2027-01-02", endDate: "2027-01-07" })).toEqual({ phase: "before", days: 2 });
  expect(formatYenMan(196592000)).toBe("1億9,659万");
  expect(formatYenMan(95763366)).toBe("9,576万");
  expect(formatYenMan(100004999)).toBe("1億");
  expect(EDITION.startDate <= EDITION.endDate).toBe(true);
  const yens = PRIZE_RANKING.racers.map((r) => r.yen);
  expect([...yens].sort((a, b) => b - a)).toEqual(yens);
  if (PRIZE_RANKING.confirmed) expect(PRIZE_RANKING.racers).toHaveLength(18);
});
