import { test, expect } from "./fixtures.js";
import { gotoAnalysisTabOnFixedDate } from "./smoke/helpers.js";

/**
 * 分析ツールの出走表データ（G4 T-29）: 行＝指標・列＝艇番、値の下に6艇の中の位置の棒。
 *   - 375px で表が横にはみ出さない（13列の表だった頃はスマホで5列しか見えなかった）
 *   - 全国勝率の行は、値が一番大きい艇の棒が一番長く、一番小さい艇の棒が一番短い
 *   - 平均ST（公式）の行は逆（小さいほど長い）
 *   - 上位3位の色のクラス（rcd-rank-N）は出さない（plan.md §14）
 * 固定の過去レース（ANALYSIS_FIXED_RACE_ID）の録画で開く。
 */
test.use({ viewport: { width: 375, height: 812 } });

const rowOf = (page, label) =>
  page.locator(".rcd-table tbody tr", {
    has: page.locator("th.rcd-metric", { hasText: label }),
  });

async function valuesAndBars(row) {
  return row.locator("td").evaluateAll((tds) =>
    tds.map((td) => ({
      value: parseFloat(td.textContent),
      bar:
        td.querySelector(".rcd-pos-fill")?.getBoundingClientRect().width ??
        null,
    })),
  );
}

test("出走表データ: 行＝指標で 375px に収まり、棒は6艇の中の位置を示す", async ({
  page,
}) => {
  await gotoAnalysisTabOnFixedDate(page, "racecard");
  await expect(page.locator(".rcd-table thead .rcd-boat-head")).toHaveCount(6, {
    timeout: 20000,
  });

  const overflow = await page
    .locator(".rcd-table-wrapper")
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator("[class*='rcd-rank-']")).toHaveCount(0);

  const check = async (label, better) => {
    const cells = (await valuesAndBars(rowOf(page, label))).filter(
      (c) => Number.isFinite(c.value) && c.bar !== null,
    );
    expect(cells.length).toBeGreaterThan(1);
    const best = cells.reduce((a, b) =>
      better === "max"
        ? b.value > a.value
          ? b
          : a
        : b.value < a.value
          ? b
          : a,
    );
    const worst = cells.reduce((a, b) =>
      better === "max"
        ? b.value < a.value
          ? b
          : a
        : b.value > a.value
          ? b
          : a,
    );
    expect(best.bar).toBe(Math.max(...cells.map((c) => c.bar)));
    expect(worst.bar).toBe(Math.min(...cells.map((c) => c.bar)));
  };
  await check("全国勝率", "max");
  await check("平均ST（公式）", "min");
});
