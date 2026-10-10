import { test, expect } from "./fixtures.js";

// BOA-815: データ出走表の平均ST は期間を名前に付けて2行で出す（2026-10-10 ユーザー承認、
// docs/design/avg-st-definition/mock/APPROVED.md）。
//   1行目「平均ST ›／前期・公式」: 公式の出走表と同じ値（勝率と同じ期の期別成績、2桁）
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
    test(`${width}px: 前期・公式（2桁）と直近30走（3桁）の2行が出て、公式の出走表と同じ値になる`, async ({
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
        .filter({ hasText: "前期・公式" })
        .first();
      await expect(official).toBeVisible({ timeout: 30000 });
      await expect(official.locator("td.drt-cell")).toHaveText(OFFICIAL, {
        timeout: 30000,
      });

      const st30 = await rowCells(table, "平均ST(30走)");
      await expect(st30.locator("td.drt-cell")).toHaveText(ST30, {
        timeout: 30000,
      });

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
                !t.includes("前期・公式") &&
                !t.includes("30走"),
            ),
        );
      expect(plain).toEqual([]);

      // 表の下の注記は、平均ST が行の名前の期間だと書く（「過去90日間」に含めない）
      await expect(page.locator(".drt-note").first()).toContainText(
        "平均STは行の名前の期間です",
      );
    });
  }
});
