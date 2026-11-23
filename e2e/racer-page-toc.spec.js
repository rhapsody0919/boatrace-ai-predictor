import { test, expect } from "./fixtures.js";

/**
 * 選手ページ内の目次（UI/UX 改善 #6、承認 docs/design/racer-wt-uiux-2026-11/mock/approved.md）の固定。
 * - 実在する節だけを、ページの並び（プロフィール → 公式成績 → モーター → 成績 → 調子 → レース一覧 → ニュース）の順に出す
 * - 要約の下にあり、最初の描画から出る（遅れて出て下を押し下げない）
 * - 押すと節の頭が、貼り付いた目次の下に出る。目次はヘッダーの下に貼り付く
 * - #st-trend の飛び先の余白に目次の高さが足される
 * 録画の再生で 4320、375 と 1440。成績・調子・レース一覧の id は絞り込みの枠の PR（claude/racer-filter-scope）が付ける
 */
for (const viewport of [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
]) {
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport });

    test("画面にある節だけをページの並びの順に出し、最初の描画から出る", async ({
      page,
    }) => {
      // 節 #racer-profile が DOM に入った最初の時点で、目次が既にあるか
      await page.addInitScript(() => {
        new MutationObserver(() => {
          if (window.__tocAtProfile === undefined && document.getElementById("racer-profile")) {
            window.__tocAtProfile = !!document.querySelector("nav.racer-toc");
          }
        }).observe(document, { childList: true, subtree: true });
      });
      await page.goto("/racer/4320");
      const toc = page.locator("nav.racer-toc");
      await expect(toc).toBeVisible({ timeout: 40000 });
      expect(await page.evaluate(() => window.__tocAtProfile)).toBe(true);

      await expect(toc.locator("a").first()).toHaveText("プロフィール");
      await expect(toc.locator("a").last()).toHaveText("ニュース");
      const ids = await toc
        .locator("a")
        .evaluateAll((as) => as.map((a) => a.getAttribute("href").slice(1)));
      const tops = await page.evaluate(
        (list) =>
          list.map((id) => {
            const el = document.getElementById(id);
            return [el?.offsetHeight ?? 0, el?.getBoundingClientRect().top ?? 0];
          }),
        ids,
      );
      for (const [h] of tops) expect(h).toBeGreaterThan(0);
      const ys = tops.map(([, y]) => y);
      expect(ys).toEqual([...ys].sort((a, b) => a - b));

      const y = (q) =>
        page.evaluate((s) => document.querySelector(s).getBoundingClientRect().top, q);
      expect(await y("nav.racer-toc")).toBeGreaterThan(await y('[data-testid="racer-summary"]'));
    });

    test("押すと節の頭が目次の下に出て、目次はヘッダーの下に貼り付く。#st-trend の余白に目次の高さが足される", async ({
      page,
    }) => {
      await page.goto("/racer/4320");
      const toc = page.locator("nav.racer-toc");
      await expect(toc).toBeVisible({ timeout: 40000 });
      const hrefs = await toc
        .locator("a")
        .evaluateAll((as) => as.map((a) => a.getAttribute("href").slice(1)));
      for (const id of hrefs.slice(1)) {
        await toc.locator(`a[href="#${id}"]`).click();
        await expect
          .poll(() =>
            page.evaluate((target) => {
              const r = (q) => document.querySelector(q).getBoundingClientRect();
              return {
                stuck: Math.abs(r("nav.racer-toc").top - r(".app-header").bottom) <= 2,
                visible: r(`#${target}`).top >= r("nav.racer-toc").bottom - 1,
              };
            }, id),
          )
          .toEqual({ stuck: true, visible: true });
      }
      const margin = await page.evaluate(() => {
        const st = document.querySelector(".racer-st-trend");
        return {
          margin: st ? parseFloat(getComputedStyle(st).scrollMarginTop) : null,
          toc: document.querySelector("nav.racer-toc").offsetHeight,
        };
      });
      expect(margin.margin).toBeCloseTo(80 + margin.toc, 0);
    });
  });
}
