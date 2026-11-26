// 枠別情報の「ST履歴」の上の6艇の ST の推移（R-36、オーナー 2026-11-26 承認）。
// 各艇の想定コースで走った全走の生の ST を走の順に並べ、表は今までどおり残す。走の記録は録画の物を使う
import { test, expect, fetchRecorded } from "./fixtures.js";

const RACE = "2026-09-28-09-11";

async function openHistory(page) {
  await page.goto(`/race/${RACE}?tab=waku`);
  const toggle = page.locator(".rsc-fold-toggle").nth(1);
  await expect(toggle).toBeVisible({ timeout: 30000 });
  await toggle.click();
  return page.locator(".rsc-st-trend");
}

test("ST履歴を開くと6艇の ST の推移が表の上に出て、選んだ艇だけ太線", async ({
  page,
}) => {
  const trend = await openHistory(page);
  await expect(trend.locator(".trc-svg")).toBeVisible({ timeout: 30000 });
  const lines = trend.locator(".trc-line");
  expect(await lines.count()).toBeGreaterThanOrEqual(2);
  // 選んでいない艇は薄い
  expect(
    await trend.locator('.trc-line[opacity="0.35"]').count(),
  ).toBeGreaterThanOrEqual(1);
  // 表は残る（列と並びは race-detail-course-2.spec.js が見る）
  await expect(page.locator(".rsc-history")).toBeVisible();
  // 図は表より上
  const chartBox = await trend.boundingBox();
  const tableBox = await page.locator(".rsc-history").boundingBox();
  expect(chartBox.y).toBeLessThan(tableBox.y);
});

test("選んだ艇の最新の走が F なら、右端の札は値でなく F", async ({ page }) => {
  // 1コースで走ったこのレースより前の最後の走を F にする（試験の中だけ）
  await page.route(
    "**/rest/v1/rpc/get_racer_scoped_race_rows*",
    async (route) => {
      const res = await fetchRecorded(route);
      const rows = await res.json();
      const own = rows.filter(
        (r) => r.actual_courses?.[r.boat_number - 1] === 1 && r.race_id < RACE,
      );
      const last = own[own.length - 1];
      if (last)
        last.st_rows = (last.st_rows ?? []).map((st) =>
          st[0] === last.boat_number
            ? [st[0], 0.02, true, false, st[4], st[5]]
            : st,
        );
      await route.fulfill(res.fulfillOptions({ json: rows }));
    },
  );
  const trend = await openHistory(page);
  await expect(trend.locator(".trc-end-flag")).toHaveText("F", {
    timeout: 30000,
  });
  await expect(trend.locator(".trc-flag-tag").first()).toBeVisible();
});
