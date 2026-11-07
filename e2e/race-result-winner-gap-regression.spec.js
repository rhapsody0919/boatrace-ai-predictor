import { test, expect } from "./fixtures.js";

/**
 * 結果タブの1着の行：金の線（行の外）と「1着」の文字の間に4px以上の余白（BOA-1027）。
 * 列の左端は全行・見出しでそろえる。
 */

for (const width of [375, 1440]) {
  test(`1着の金の線と「1着」の間に余白がある（${width}px）`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/race/2026-09-19-02-09");
    await page.locator(".race-tabs-btn", { hasText: "結果" }).first().click();
    await page.locator(".rr-row.is-winner").first().waitFor();

    const m = await page.evaluate(() => {
      const textLeft = (el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        return r.getBoundingClientRect().left;
      };
      const winner = document.querySelector(".rr-row.is-winner");
      const rows = Array.from(winner.parentElement.querySelectorAll(".rr-row"));
      const head = winner.parentElement.querySelector(".rr-row-head > *");
      return {
        gap: textLeft(winner.querySelector(".rr-pos")) - winner.getBoundingClientRect().left,
        posLefts: rows.map((row) => textLeft(row.querySelector(".rr-pos"))),
        headLeft: head ? textLeft(head) : null,
      };
    });

    expect(m.gap).toBeGreaterThanOrEqual(4);
    expect(m.posLefts).toHaveLength(6);
    expect(Math.max(...m.posLefts) - Math.min(...m.posLefts)).toBeLessThanOrEqual(1);
    expect(m.headLeft).not.toBeNull();
    expect(Math.abs(m.headLeft - m.posLefts[0])).toBeLessThanOrEqual(1);
  });
}
