// 選手ページの会場別・枠番別の表（src/components/racer/RacerPerformanceStats.css の .racer-return-rate-table）。
// 1列目（会場名など）は折り返さない。375px で出走数が2桁だと「住之/江」「浜名/湖」と折れた（G2 2026-11-26）
import { test, expect } from "../fixtures.js";

test.describe("レイアウト: 選手ページの表の1列目", () => {
  test("会場名などの1列目が1行に収まり、ページが横にはみ出さない", async ({ page }) => {
    await page.goto("/racer/4320", { waitUntil: "domcontentloaded" });
    const cells = page.locator(".racer-return-rate-table tbody td:first-child");
    await expect(cells.first()).toBeVisible({ timeout: 30000 });
    const lines = await cells.evaluateAll((tds) =>
      tds.map((td) => {
        const range = document.createRange();
        range.selectNodeContents(td);
        const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
        return { text: td.textContent, lines: tops.size };
      }),
    );
    expect(lines.length, "表の行の数").toBeGreaterThan(0);
    expect(lines.filter((c) => c.lines > 1), "2行に折れた1列目").toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "ページの横のはみ出し").toBeLessThanOrEqual(2);
  });
});
