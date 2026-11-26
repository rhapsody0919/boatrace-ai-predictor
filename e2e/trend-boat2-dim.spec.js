// 推移の図で選んでいない2号艇の黒の線が、ライトでは他の艇より強すぎず、ダークでは地に溶けて消えないこと
// （visual-designer 11/26 P1）。枠別情報の ST の推移（R-36、6艇の生の値。dimHalo の無い尺度）で見る。走の記録は録画の物を使う
import { test, expect } from "./fixtures.js";

const RACE = "2026-09-28-09-11";

async function boat2Line(page, theme) {
  await page.goto(`/race/${RACE}?tab=waku`);
  const toggle = page.locator(".rsc-fold-toggle").nth(1);
  await expect(toggle).toBeVisible({ timeout: 30000 });
  await toggle.click();
  const trend = page.locator(".rsc-st-trend");
  await expect(trend.locator(".trc-svg")).toBeVisible({ timeout: 30000 });
  await page.evaluate(
    (t) => document.documentElement.setAttribute("data-theme", t),
    theme,
  );
  // 選んだ艇は1号艇。2号艇は薄くした線
  const line = trend.locator(".trc-line-2");
  await expect(line).toHaveAttribute("opacity", "0.35");
  return line.evaluate((g) => ({
    opacity: Number(getComputedStyle(g).opacity),
    other: Number(
      getComputedStyle(g.ownerSVGElement.querySelector(".trc-line-3")).opacity,
    ),
    filter: getComputedStyle(g.querySelector(".trc-stroke")).filter,
  }));
}

test("ライトでは選んでいない2号艇の黒の線を他の艇より薄くし、縁を付けない", async ({
  page,
}) => {
  const s = await boat2Line(page, "light");
  expect(s.opacity).toBeLessThan(s.other);
  expect(s.filter).toBe("none");
});

test("ダークでは選んでいない2号艇の線に明るい縁を付け、他の艇より濃く残す", async ({
  page,
}) => {
  const s = await boat2Line(page, "dark");
  expect(s.opacity).toBeGreaterThan(s.other);
  expect(s.filter).toContain("drop-shadow");
});
