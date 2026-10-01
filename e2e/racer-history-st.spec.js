import { test, expect } from "./fixtures.js";

/**
 * 選手ページの履歴は本番ST（race_start_timings）と公式の着欄の記号を出す（BOA-576）。
 * 以前は ST を展示ST（exhibition_data.start_timing）から出し、落・転・妨などの走を「着外(順位不明)」としていた。
 * 選手5250の本番データ（2026-09-30 確認）:
 * - 9/24 桐生10R: 本番ST 0.02（展示ST 0.06）、3着
 * - 9/21 桐生11R: 本番ST 0.11（展示ST 0.09）、着欄「落」
 */
test("選手ページの履歴: 本番STと公式の記号を出す", async ({ page }) => {
  await page.goto("/racer/5250");
  const rowOf = (date, raceNo) =>
    page
      .locator("tr")
      .filter({ hasText: date })
      .filter({
        has: page.locator("td", { hasText: new RegExp(`^${raceNo}R$`) }),
      });
  // 9/24 は2走（5R・10R）ある。10R の行を取る
  const r0924 = rowOf("2026-09-24", 10);
  await expect(r0924).toBeVisible({ timeout: 30000 });
  await expect(r0924).toContainText("0.02");
  await expect(r0924).not.toContainText("0.06");
  const r0921 = rowOf("2026-09-21", 11);
  await expect(r0921).toContainText("落");
  await expect(r0921).not.toContainText("着外");
});

// 完走が3艇未満のレースでは race_results の rank に返還艇（F）が入っていることがある。着欄に公式の記号がある走は、
// 着順より記号を優先する（「3着」と「F0.06」が同じ行に並ばない。BOA-576 のデータ精度検証）。
// 選手4069: 2026-09-22 児島1R は F0.01（公式も F.01）
test("選手ページの履歴: フライングの走は着順でなく F を出し、ST も F 付きで出す", async ({
  page,
}) => {
  await page.goto("/racer/4069");
  const row = page
    .locator("tr")
    .filter({ hasText: "2026-09-22" })
    .filter({ has: page.locator("td", { hasText: /^1R$/ }) });
  await expect(row).toBeVisible({ timeout: 30000 });
  await expect(row).toContainText("F0.01");
});

// 2026-09-19 戸田9R: 公式の完走は1・2号艇だけで3号艇はF0.04。race_results は rank 1-2-3 で、修正前は「3着」
test("選手ページの履歴: race_results の着順に入った返還艇（F）は「3」でなく「F」と出す", async ({
  page,
}) => {
  await page.goto("/racer/3928");
  const row = page
    .locator("tr")
    .filter({ hasText: "2026-09-19" })
    .filter({ has: page.locator("td", { hasText: /^9R$/ }) });
  await expect(row).toBeVisible({ timeout: 30000 });
  await expect(row).toContainText("F0.04");
  // ST の次の列が着欄
  const cells = await row.locator("td").allTextContents();
  const stAt = cells.indexOf("F0.04");
  expect(cells[stAt + 1]).toBe("F");
});

// 本番STは2025-12から、展示タイムは2026-03からある。ST推移の見出しを「2025年12月以降」にし、
// 展示タイムの推移は展示がある走だけで横軸を作る（見出しの期間と横軸の始まりが食い違っていた。
// PR #996 ファン評価1周目）
test("選手ページ: STの推移・展示タイムの推移の見出しと横軸の始まりが合う", async ({
  page,
}) => {
  await page.goto("/racer/5250");
  const chartOf = (title) =>
    page.locator(".racer-stat-chart").filter({
      has: page.locator("h3", { hasText: title }),
    });
  const st = chartOf("STの推移");
  await expect(st).toBeVisible({ timeout: 30000 });
  await expect(st.locator("h3")).toContainText("2025年12月以降");
  // 横軸の日付ラベル（"25-12-27" 形式）のうち最初のもの。recharts の版で
  // 目盛りラベルの入れ物のクラスが変わるので、svg 内の日付形式の文字で取る
  const firstTick = (chart) =>
    chart
      .locator("svg text")
      .evaluateAll(
        (els) =>
          els
            .map((el) => el.textContent.trim())
            .find((t) => /^\d{2}-\d{2}-\d{2}$/.test(t)) ?? null,
      );
  // 5250 の本番STは 2025-12-27 から、展示タイムは 2026-03 から
  expect(await firstTick(st)).toMatch(/^25-12-/);
  const ex = chartOf("展示タイムの推移");
  await expect(ex.locator("h3")).toContainText("2026年3月以降");
  expect(await firstTick(ex)).toMatch(/^26-/);
});
