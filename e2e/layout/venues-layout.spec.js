// 旧 e2e/layout.spec.js から切り出しスクリプトで移した（CI02。題・中身は元のまま、import の相対の字だけ1段深くした）
import { test, expect } from "../fixtures.js";

for (const theme of ["light", "dark"]) {
  test(`BOA-894: 会場一覧へ戻るリンクが375pxの${theme}で意味トークンを使う`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/venue/2");
    const link = page.locator(".venue-race-list-page .page-header .back-link");
    await expect(link).toBeVisible();
    await page.evaluate((theme) => {
      document.documentElement.setAttribute("data-theme", theme);
    }, theme);
    const tokenColor = (token) =>
      page.evaluate((token) => {
        const probe = document.createElement("span");
        probe.style.color = `var(${token})`;
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      }, token);
    await expect(link).toHaveCSS(
      "color",
      await tokenColor("--brand-accent-secondary"),
    );
    await expect(link).toHaveCSS("text-decoration-line", "none");
    // 本日ビューは読み込み後に次のレースへ自動でスクロールし、5秒は高さの変化に合わせて戻す（VenueRaceListPage の
    // holdScrollPosition、BOA-546）。1R の発走後の昼の e2e-live では、hover の後にリンクが画面外へ動いて hover が外れた（BOA-1490）。
    // 読み込みの終わりを待ち、確かめるたびに hover し直す（hover は画面外の要素を視野へ戻す）。上限はスクロールし直す5秒より長く
    await expect(
      page
        .locator(".race-list-section, .venue-race-list-page__empty")
        .first(),
    ).toBeVisible();
    const hoveredColor = async () => {
      await link.hover();
      return link.evaluate((el) => getComputedStyle(el).color);
    };
    await expect
      .poll(hoveredColor, { timeout: 10000 })
      .toBe(await tokenColor("--text-primary"));
    await expect
      .poll(async () => {
        await link.hover();
        return link.evaluate((el) => getComputedStyle(el).textDecorationLine);
      }, { timeout: 10000 })
      .toBe("underline");
  });
}

// 会場のレース一覧カード（BOA-558 の6・BOA-586）。2026-09-24 桐生は準優勝戦（バッジ3つ）を含む
test.describe("レイアウト: 会場のレース一覧カード（出走表の列・モーターの行・見出しの高さ）", () => {
  test("6号艇の列が切れず、モーターの値が罫線に接さず、同じ段のカードの出走表の高さがそろう", async ({
    page,
  }) => {
    await page.goto("/races/2026-09-24/1", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".race-card .rcdt-table").first()).toBeVisible({
      timeout: 30000,
    });
    await page
      .waitForLoadState("networkidle", { timeout: 15000 })
      .catch((error) => {
        if (error.name !== "TimeoutError") throw error;
      });

    const m = await page.evaluate(() => {
      const cards = [
        ...document.querySelectorAll(".race-list-section .race-card"),
      ];
      return cards.map((card) => {
        const wrap = card.querySelector(".rcdt-table-wrapper");
        const table = card.querySelector(".rcdt-table");
        const lastBoat = table.querySelector("thead tr th:last-child");
        const motorRow = [...table.querySelectorAll("tbody tr")].find((tr) =>
          /モーター/.test(tr.textContent),
        );
        const gaps = motorRow
          ? [...motorRow.querySelectorAll("td.rcdt-cell")]
              .map((td) => {
                const value = td.querySelector(".drt-value > span");
                if (!value) return null;
                const a = td.getBoundingClientRect();
                const b = value.getBoundingClientRect();
                return Math.min(b.left - a.left, a.right - b.right);
              })
              .filter((g) => g !== null)
          : [];
        const c = card.getBoundingClientRect();
        return {
          // 6号艇の列が表の枠の中にある（BOA-559 の再発防止）
          overflow: wrap.scrollWidth - wrap.clientWidth,
          lastBoatRight: lastBoat.getBoundingClientRect().right,
          wrapRight: wrap.getBoundingClientRect().right,
          minMotorGap: gaps.length ? Math.min(...gaps) : null,
          rowTop: Math.round(c.top),
          tableTop: table.getBoundingClientRect().top - c.top,
        };
      });
    });

    expect(m.length).toBeGreaterThan(0);
    for (const [i, card] of m.entries()) {
      expect(
        card.overflow,
        `${i + 1}枚目: 出走表の横スクロール`,
      ).toBeLessThanOrEqual(1);
      expect(
        card.lastBoatRight,
        `${i + 1}枚目: 6号艇の列が枠の外`,
      ).toBeLessThanOrEqual(card.wrapRight + 0.5);
      if (card.minMotorGap !== null) {
        // 以前は 1024px で最小1.5px（「42.2%」が37pxのセルに34px）。%を小さくして2px以上にした
        expect(
          card.minMotorGap,
          `${i + 1}枚目: モーターの値の左右の余白`,
        ).toBeGreaterThanOrEqual(1.8);
      }
    }
    // 同じ段（上端がそろうカード）では、出走表の始まる高さもそろう。以前は 1024px で
    // バッジの数により見出しが1〜3段に折れ、最大67pxずれた
    const byRow = new Map();
    for (const card of m) {
      if (!byRow.has(card.rowTop)) byRow.set(card.rowTop, []);
      byRow.get(card.rowTop).push(card.tableTop);
    }
    for (const [top, tops] of byRow) {
      if (tops.length < 2) continue;
      expect(
        Math.max(...tops) - Math.min(...tops),
        `上端 ${top}px の段で出走表の高さがずれている`,
      ).toBeLessThanOrEqual(1);
    }
  });
});
