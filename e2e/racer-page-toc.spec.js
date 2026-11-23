import { test, expect } from "./fixtures.js";

/**
 * 選手ページ内の目次と、絞り込みが効く節の枠（UI/UX 改善 #6、承認 docs/design/racer-wt-uiux-2026-11/mock/approved.md）の固定。
 * 録画の再生で 4320、375 と 1440。
 */
for (const viewport of [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
]) {
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport });

    test("目次は実在する節だけで、要約より下。押すと枠が目次の下に出て、目次は貼り付く", async ({
      page,
    }) => {
      await page.goto("/racer/4320");
      const toc = page.locator("nav.racer-toc");
      await expect(toc).toBeVisible({ timeout: 40000 });
      const ids = await toc
        .locator("a")
        .evaluateAll((as) => as.map((a) => a.getAttribute("href").slice(1)));
      expect(ids).toContain("racer-stats");
      expect(ids).toContain("racer-filtered");
      for (const id of ids) {
        const h = await page.evaluate(
          (i) => document.getElementById(i)?.offsetHeight ?? 0,
          id,
        );
        expect(h, `#${id} が画面にある`).toBeGreaterThan(0);
      }
      const y = (s) =>
        page.evaluate(
          (q) => document.querySelector(q).getBoundingClientRect().top,
          s,
        );
      expect(await y("nav.racer-toc")).toBeGreaterThan(
        await y('[data-testid="racer-summary"]'),
      );

      await toc.getByRole("link", { name: "調子（絞り込み）" }).click();
      // 貼り付いている（目次の上端がヘッダーの下端）うえで、枠の上端が目次の下端以下にある。移動（smooth）の終わりまで待つ
      await expect
        .poll(() =>
          page.evaluate(() => {
            const r = (q) => document.querySelector(q).getBoundingClientRect();
            return {
              stuck: Math.abs(r("nav.racer-toc").top - r(".app-header").bottom) <= 2,
              frameBelowToc: r("#racer-filtered").top >= r("nav.racer-toc").bottom - 1,
              scrolled: window.scrollY > 200,
            };
          }),
        )
        .toEqual({ stuck: true, frameBelowToc: true, scrolled: true });
    });

    test("絞り込みの欄と効く節は枠の中、公式成績・モーター・全体の成績は枠の外", async ({
      page,
    }) => {
      await page.goto("/racer/4320");
      const frame = page.locator("section.racer-filter-scope");
      await expect(frame).toBeVisible({ timeout: 40000 });
      await expect(frame.locator(".racer-filter-scope__title")).toHaveText(
        "この枠の中は絞り込みが効きます",
      );
      await expect(frame.locator(".racer-vc-filter")).toHaveCount(1);
      await expect(frame.locator("h3", { hasText: "決まり手傾向" })).toHaveCount(1);
      await expect(
        page.locator(".racer-filter-scope .racer-official-block, .racer-filter-scope .racer-motor-status-card, .racer-filter-scope .racer-cond-stats"),
      ).toHaveCount(0);
    });
  });
}
