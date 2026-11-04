import { test, expect } from "./fixtures.js";

// BOA-815: データ出走表の平均ST は期間を名前に付けて2行で出す（2026-10-10 ユーザー承認、
// docs/design/avg-st-definition/mock/APPROVED.md）。
//   1行目「平均ST ›／公式」: 公式の出走表と同じ値（勝率と同じ期の期別成績、2桁）
//   2行目「平均ST(30走)」: 龍神ソナー・思考アシストと同じ v16 の st_mean30（3桁）
// 若松9R 2026-10-09 の公式の出走表は 0.16/0.17/0.18/0.18/0.15/0.19。
// 修正前の1行は「当サイトに蓄積した全期間」の 0.156/0.150/0.166/0.178/0.145/0.179 で、公式と食い違っていた
const RACE = "/race/2026-10-09-20-09";
const OFFICIAL = ["0.16", "0.17", "0.18", "0.18", "0.15", "0.19"];
const ST30 = ["0.175", "0.131", "0.141", "0.184", "0.151", "0.178"];

async function rowCells(table, label) {
  const row = table
    .locator("tbody tr")
    .filter({
      has: table.page().locator(".drt-label-full", { hasText: label }),
    })
    .first();
  await expect(row).toBeVisible({ timeout: 30000 });
  return row;
}

test.describe("データ出走表の平均ST（BOA-815）", () => {
  for (const width of [375, 1440]) {
    test(`${width}px: 公式（2桁）と直近30走（3桁）の2行が出て、公式の出走表と同じ値になる`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(RACE);
      await page
        .locator(".race-tabs-btn", { hasText: "基本情報" })
        .first()
        .click();
      const table = page.locator(".drt-table").first();
      await expect(table).toBeVisible({ timeout: 30000 });

      const official = table
        .locator("tbody tr")
        .filter({ has: page.locator(".drt-label-note", { hasText: "公式" }) })
        .first();
      await expect(official).toBeVisible({ timeout: 30000 });
      await expect(official.locator("td.drt-cell")).toHaveText(OFFICIAL, {
        timeout: 30000,
      });

      const st30 = await rowCells(table, "平均ST(30走)");
      await expect(st30.locator("td.drt-cell")).toHaveText(ST30, {
        timeout: 30000,
      });

      // 期間は名前に入れず「?」に出す（2026-10-10 ユーザー判断。10/9 は 2025/11/1〜2026/4/30 の成績）
      await official.locator(".term-hint__button").click();
      await expect(page.locator(".term-hint__popover")).toContainText(
        "2025/11/1〜2026/4/30 の成績",
      );
      await official.locator(".term-hint__button").click();

      // 金枠は表示している桁で比べる（公式は5号艇 0.15、30走は2号艇 0.131）
      await expect(official.locator("td.drt-best")).toHaveText(["0.15"]);
      await expect(st30.locator("td.drt-best")).toHaveText(["0.131"]);

      // 期間の無い「平均ST」の行（全期間の値）は残っていない
      const plain = await table
        .locator("tbody tr")
        .evaluateAll((rows) =>
          rows
            .map((r) => r.querySelector(".drt-label-cell")?.textContent ?? "")
            .filter(
              (t) =>
                t.includes("平均ST") &&
                !t.includes("公式") &&
                !t.includes("30走"),
            ),
        );
      expect(plain).toEqual([]);

      // BOA-1296: 直近3期の想定コース1着率に差し替える
      if (width === 1440) {
        await expect(
          table.locator(".drt-label-full", { hasText: "想定コース1着率" }),
        ).toBeVisible();
      }

      // 表の下の注記は、平均ST が行の名前の期間だと書く（「過去90日間」に含めない）
      await expect(page.locator(".drt-note").first()).toContainText(
        "想定コース1着率は直近3期の進入コース",
      );
    });
  }

  // 公式は節の途中で期を替えない。戸田 6/27〜7/1 の節の 7/1 は旧期（(2026,1) の期）の値。
  // レース日で期を決めていたときは 0.15/0.16/0.19/0.17/0.16 を出し、6艇中4艇が食い違った（データ精度の検証で発見）
  test("節の途中で期が替わるレースは、節の初日の期の値を出す（戸田 2026-07-01 8R）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto("/race/2026-07-01-02-08");
    await page
      .locator(".race-tabs-btn", { hasText: "基本情報" })
      .first()
      .click();
    const table = page.locator(".drt-table").first();
    await expect(table).toBeVisible({ timeout: 30000 });
    const official = table
      .locator("tbody tr")
      .filter({ has: page.locator(".drt-label-note", { hasText: "公式" }) })
      .first();
    // 公式の出走表は 0.16/0.17/0.19/0.15/0.15/-（6号艇は新人でその期の記録が無い）
    await expect(official.locator("td.drt-cell")).toHaveText(
      ["0.16", "0.17", "0.19", "0.15", "0.15", "—"],
      { timeout: 30000 },
    );
  });
});

// BOA-1293 と同じ公式3期を差し替える。艇番集計と異なる値で検出する。
const COURSE_TERMS = [
  [2025, 2, "2024-11-01", "2025-04-30", 35, 20],
  [2026, 1, "2025-05-01", "2025-10-31", 30, 20],
  [2026, 2, "2025-11-01", "2026-04-30", 37, 23],
];
for (const width of [375, 1440]) {
  for (const failed of [false, true]) {
    test(`想定コース1着率 ${width}px 取得失敗=${failed}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.route("**/rest/v1/racer_period_stats?*", (route) => route.fulfill({
        json: COURSE_TERMS.map(([period_year, period_no, calc_from, calc_to, n, wins]) => ({
          period_year, period_no, calc_from, calc_to, starts: 100,
          c1_entries: n, c1_p1: wins,
          c2_entries: 5, c2_p1: 4, c3_entries: 1, c3_p1: 1,
          c4_entries: 30, c4_p1: 6, c5_entries: 30, c5_p1: 0,
          c6_entries: 30, c6_p1: 0,
        })),
      }));
      await page.route("**/rest/v1/rpc/get_course_win_rate_baseline", (route) =>
        route.fulfill(failed ? { status: 500, json: { message: "test failure" } }
          : { json: { national: { 1: { winRate: 55.2 } } } }));
      await page.goto(RACE);
      await page.locator(".race-tabs-btn", { hasText: "基本情報" }).first().click();
      const table = page.locator(".drt-table").first();
      const row = await rowCells(table, "想定コース1着率");
      const cells = row.locator("td.drt-cell");
      await expect(row.locator(".drt-label-note")).toContainText("直近3期・進入コース");
      if (failed) {
        await expect(cells).toHaveText(["—", "—", "—", "—", "—", "—"]);
        await expect(row.locator(".drt-best")).toHaveCount(0);
      } else {
        await expect(cells.nth(0)).toContainText("62%");
        await expect(cells.nth(0)).toContainText("63/102");
        await expect(cells.nth(1)).toContainText("80% ⚠");
        await expect(cells.nth(2)).toHaveText("—3走");
        await expect(row.locator(".drt-best")).toHaveCount(1);
        await expect(cells.nth(0)).toHaveClass(/drt-best/);
        expect(await cells.nth(1).locator(".drt-value").evaluate((el) => getComputedStyle(el).color))
          .toBe(await cells.nth(1).locator(".drt-sub").evaluate((el) => getComputedStyle(el).color));
      }
      await expect(table.locator(".drt-label-full", { hasText: "枠番勝率" })).toHaveCount(0);
    });
  }
}
