import { viewportSkipReason } from "../viewport-skip.js";
import { test, expect, fetchRecorded } from "../fixtures.js";
import { gotoAndSettle } from "./helpers.js";

// 枠別情報タブ（BOA-757）。折れるなら全部の列・行で同じ位置で折る
test.describe("レイアウト: 枠別情報の ST考察と「1コースが逃げたとき」の折れ方がそろう", () => {
  test("ST考察の「平均◯◯」と「2連単 ◯%」の高さが行の中でそろう", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "layout-mobile",
      viewportSkipReason("スマホ幅（320・375px）だけの指定"),
    );
    for (const [path, width] of [
      ["/race/2026-09-28-09-11", 320],
      ["/en/race/2026-09-23-09-12", 320],
      ["/ko/race/2026-09-23-09-12", 320],
      ["/race/2026-09-28-09-11", 375],
    ]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${path}?tab=waku`, { waitUntil: "domcontentloaded" });
      await expect(page.locator(".rsc-baseline").first()).toBeVisible({
        timeout: 30000,
      });
      await expect(page.locator(".nsc-exacta").first()).toBeVisible({
        timeout: 30000,
      });
      const m = await page.evaluate(() => ({
        // 行ごとの「平均◯◯」の高さの種類の数（1ならそろっている）
        baseline: [...document.querySelectorAll(".rsc-grid tbody tr")]
          .map(
            (tr) =>
              new Set(
                [...tr.querySelectorAll(".rsc-baseline")].map((e) =>
                  Math.round(e.getBoundingClientRect().height),
                ),
              ).size,
          )
          .filter((n) => n > 0),
        exacta: new Set(
          [...document.querySelectorAll(".nsc-exacta")].map((e) =>
            Math.round(e.getBoundingClientRect().height),
          ),
        ).size,
        overflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      }));
      for (const n of m.baseline) {
        expect(n, `${path} ${width}px: 「平均」の高さの種類`).toBe(1);
      }
      expect(m.exacta, `${path} ${width}px: 「2連単」の高さの種類`).toBe(1);
      expect(m.overflow, `${path} ${width}px: 横スクロール`).toBe(0);
    }
  });
});

/**
 * レース詳細の 1R〜12R の帯（BOA-1189 GS01-c）。レース数は会場・日で変わりうるので、
 * 件数を差し替えて、スマホの2段目の残りが横いっぱいに伸びないこと・768px 以上で1行に並ぶことを見る
 * （component-reuse.md「件数がデータで変わるグリッド」）。8件は会場16の 1〜7R と 12R
 */
/**
 * レース詳細の出走6艇（BOA-1189 GS01-c、A案）。スマホの2行で、選手名のリンクの押せる高さが
 * 44px 以上あり、上下・左右の選手のリンクと押せる範囲が重ならないこと（ui-layout.md。
 * 32px で上下の行の間が4pxだった。ファン評価 A案の周 P2）
 */
test("レイアウト: レース詳細の出走6艇の選手名は 44px 以上で重ならない（BOA-1189）", async ({
  page,
}) => {
  test.skip(
    page.viewportSize().width >= 768,
    viewportSkipReason("スマホ幅（2行になる幅）で確認"),
  );
  await gotoAndSettle(page, "/race/2026-09-29-16-12");
  const links = page.locator(
    '[data-testid="race-entrants"] a[href^="/racer/"]',
  );
  await expect(links).toHaveCount(6, { timeout: 30000 });
  const rects = await links.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    }),
  );
  for (const r of rects) {
    expect(
      r.bottom - r.top,
      `高さ ${JSON.stringify(r)}`,
    ).toBeGreaterThanOrEqual(44);
  }
  // 2行に分かれている（検査の空振り防止）
  expect(new Set(rects.map((r) => Math.round(r.top))).size).toBeGreaterThan(1);
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i];
      const b = rects[j];
      const overlap =
        a.left < b.right - 0.5 &&
        b.left < a.right - 0.5 &&
        a.top < b.bottom - 0.5 &&
        b.top < a.bottom - 0.5;
      expect(overlap, `重なり ${JSON.stringify([a, b])}`).toBe(false);
    }
  }
});

test.describe("レイアウト: レース詳細の 1R〜12R の帯は件数によらずそろう（BOA-1189）", () => {
  for (const keep of [8, 12]) {
    test(`帯が${keep}件のとき、項目の幅がそろう`, async ({ page }) => {
      await page.route("**/api/predictions/2026-09-29**", async (route) => {
        const response = await fetchRecorded(route);
        const body = await response.json();
        if (keep < 12) {
          body.races = (body.races ?? []).filter(
            (r) =>
              r.venueCode !== 16 ||
              r.raceNumber <= keep - 1 ||
              r.raceNumber === 12,
          );
        }
        await route.fulfill(response.fulfillOptions({ json: body }));
      });
      await gotoAndSettle(page, "/race/2026-09-29-16-12");
      const items = page.locator(".race-number-strip__list > li");
      await expect(items).toHaveCount(keep, { timeout: 30000 });
      const boxes = await items.evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { w: Math.round(r.width), top: Math.round(r.top) };
        }),
      );
      const widths = boxes.map((b) => b.w);
      expect(
        Math.max(...widths) - Math.min(...widths),
        `帯の項目の幅がそろっていません: ${JSON.stringify(widths)}`,
      ).toBeLessThanOrEqual(1);
      if (page.viewportSize().width >= 768) {
        expect(
          new Set(boxes.map((b) => b.top)).size,
          `768px 以上で帯が1行に並んでいません: ${JSON.stringify(boxes)}`,
        ).toBe(1);
      }
    });
  }
});
