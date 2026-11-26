// ホームの PC（1200px 以上）で、主役の会場の一覧を左・短い案内を右の列に置き、会場の一覧を2列の頭に出すこと（G3 の点検 2026-11-26）。
// 1列のままだと会場の一覧の上端が 1472px（初めての人は動画の案内で 2695px）で、PC の最初の画面に会場が1つも入らなかった。
// 1199px 以下は今の並び（案内 → 会場の一覧）のまま。会場の一覧の直上に見出し「24会場の開催状況」を置く（どの幅も）。幅は layout-* の project ごと（375・768・1024・1440・1920）
import { test, expect } from "../fixtures.js";
import { gotoAndSettle } from "./helpers.js";

test("ホームの会場の一覧が、1200px 以上で案内の列の左に並び、未満では案内の下に在る", async ({
  page,
}) => {
  await gotoAndSettle(page, "/");
  const m = await page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        top: r.top + scrollY,
        bottom: r.bottom + scrollY,
        left: r.left,
        right: r.right,
      };
    };
    return {
      grid: box(".home-today-board > .venue-grid"),
      title: box(".home-today-board > .home-venue-grid-title"),
      digest: box(".home-today-board > .home-digest-link"),
      // 案内の列の全体（並びは grid で変わるので、全部の上端の最小・左端の最小で見る）
      side: (() => {
        const rs = [
          ...document.querySelectorAll(
            ".home-today-board > :is(.first-visit-guide-card, .intro-banner, .sg-now-banner, .home-digest-link)",
          ),
        ].map((el) => el.getBoundingClientRect());
        if (!rs.length) return null;
        return {
          top: Math.min(...rs.map((r) => r.top)) + scrollY,
          left: Math.min(...rs.map((r) => r.left)),
        };
      })(),
      volatility: box(".home-today-board > .volatility-highlights"),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  expect(m.grid, "会場の一覧が包みの直下に在る").not.toBeNull();
  expect(m.side, "案内が包みの直下に在る").not.toBeNull();
  expect(m.overflow, "ページの横のはみ出し").toBeLessThanOrEqual(1);
  // 会場の一覧の見出し（締切の欄の続きに見えないように。オーナー承認 2026-11-26）は一覧の直上に在る
  expect(m.title, "会場の一覧の見出しが包みの直下に在る").not.toBeNull();
  expect(m.title.bottom).toBeLessThanOrEqual(m.grid.top + 1);
  expect(m.grid.top - m.title.bottom, "見出しと一覧の間").toBeLessThanOrEqual(24);
  expect(Math.abs(m.title.left - m.grid.left)).toBeLessThanOrEqual(1);

  if (page.viewportSize().width >= 1200) {
    // 会場の一覧は左の列、案内は右の列。上端は案内の列の先頭とそろう
    expect(m.grid.right).toBeLessThanOrEqual(m.side.left);
    expect(Math.abs(m.grid.top - m.side.top)).toBeLessThanOrEqual(2);
    // 長いイン崩れ注意度は2列の下に全幅で置く（右の列だけが長くならない）
    if (m.volatility) {
      expect(m.volatility.top).toBeGreaterThanOrEqual(m.grid.bottom);
      expect(m.volatility.left).toBeLessThanOrEqual(m.grid.left + 1);
    }
  } else {
    // 今の並びのまま: 会場の一覧は本日のデータ一覧の導線より下
    if (m.digest) expect(m.grid.top).toBeGreaterThanOrEqual(m.digest.bottom);
    expect(m.grid.top).toBeGreaterThan(m.side.top);
  }
});
