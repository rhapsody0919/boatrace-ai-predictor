import { test, expect } from "./fixtures.js";

// 結果タブのスタートの位置（BOA-586・#1071）。着順の行の ST の矢印は、スタート隊形の絵（コース順、BOA-811）に
// 置き換えたので、同じ性質をその絵で確かめる。浜名湖 2026-09-14 6R は不成立で、
// 6艇中5艇が F（F.11・F.09・F.03・F.03・F.01）、4号艇だけ 0.02
const RACE = "/race/2026-09-14-06-06";

// SVG の座標（幅351）で測る。tip は艇の舳先、slit はスリット線の x、labelRight は左の札（艇番）の右端
async function formation(page, url, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(url);
  const svg = page.locator(".rr-formation-svg");
  await expect(svg).toBeVisible({ timeout: 30000 });
  return svg.evaluate((el) => {
    const slit = Number(el.querySelector(".rr-fm-slit").getAttribute("x1"));
    const rows = [...el.querySelectorAll("g[data-boat]")]
      .map((g) => {
        const hull = g.querySelector(".rr-fm-hull");
        if (!hull) return null;
        const b = hull.getBBox();
        return {
          st: g.querySelector(".rr-fm-st")?.textContent ?? "",
          tip: b.x + b.width,
          left: b.x,
        };
      })
      .filter(Boolean);
    const badges = [...el.querySelectorAll("g[data-boat] rect")].map(
      (r) => Number(r.getAttribute("x")) + Number(r.getAttribute("width")),
    );
    return {
      slit,
      rows,
      labelRight: Math.max(...badges),
      scale: el.getBoundingClientRect().width / 351,
    };
  });
}

test.describe("結果タブのスタート隊形の絵（BOA-586・BOA-811）", () => {
  for (const width of [375, 1440]) {
    test(`${width}px: F.01 と F.11 の位置の差が読み取れ、F は線の先で絵からはみ出さない`, async ({
      page,
    }) => {
      const f = await formation(page, RACE, width);
      const tipOf = (st) => f.rows.find((r) => r.st.startsWith(st)).tip;
      // 1艇身（0.13秒）＝58 の実縮尺。0.10秒の差は約45。画面上でも 30px 以上
      expect((tipOf("F.11") - tipOf("F.01")) * f.scale).toBeGreaterThanOrEqual(
        30,
      );
      for (const r of f.rows) expect(r.tip, r.st).toBeLessThanOrEqual(351);
      // F.01 でも舳先が線から離れている（線に重なって見えない。#1071 ファン評価1周目）
      expect((tipOf("F.01") - f.slit) * f.scale).toBeGreaterThanOrEqual(3);
    });
  }

  test("F 以外が1艇しかいないときは「最速」を付けない（表・絵とも）", async ({
    page,
  }) => {
    const f = await formation(page, RACE, 1440);
    expect(f.rows.filter((r) => r.st.includes("最速"))).toHaveLength(0);
    await expect(page.locator(".rr-st-fastest-tag")).toHaveCount(0);
  });

  for (const width of [375, 1024, 1440]) {
    test(`${width}px: 遅いスタート（ST0.29・0.33）の艇も左の札に重ならない（#1071 ファン評価2周目）`, async ({
      page,
    }) => {
      // 桐生 2026-09-25 1R: ST 0.29・0.24・0.17・0.24・0.23・0.33
      const f = await formation(page, "/race/2026-09-25-01-01", width);
      for (const r of f.rows)
        expect(r.left, r.st).toBeGreaterThan(f.labelRight);
    });
  }
});

test("最終レースでは下部ナビの「次のレース」ボタンを隠す（「- →」と出さない。BOA-586）", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/race/2026-09-25-01-12");
  const buttons = page.locator(
    ".race-bottom-nav__race-row .race-bottom-nav__btn",
  );
  await expect(buttons.first()).toBeVisible({ timeout: 30000 });
  await expect(buttons.first()).toContainText("11R");
  await expect(buttons.last()).toBeHidden();
});
