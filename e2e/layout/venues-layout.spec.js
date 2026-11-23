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
    // 一覧の描画を待ち（自動スクロールはまだ続きうる）、確かめるたびに hover し直す（hover は画面外の要素を視野へ戻す）。上限はスクロールし直す5秒より長く
    await expect(
      page
        .locator(".race-list-section, .venue-race-list-page__empty")
        .first(),
    ).toBeVisible({ timeout: 10000 });
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

// 「調子・展示・回収率まで見る」を開いた行が、上の艇番の列とずれず、表が枠からはみ出さない（2026-11-23 ファン評価 P0・P1）。
// 以前は開いた行を別の表に置いたため列の幅が中身で決まり、375px で展示ST が隣の艇の列の下に出て、6号艇の列が枠の外へ切れた。
// 同じ表に移した後も、1024px（カード約315px）では1行のままのラベルと「47.6kg」等で表が約9px 広がった。
// 録画にこのレースの詳細が無く開いた行が「—」になるので、本番 /venue/2 1R（11/23）と同じ長さの文字を入れて測る
const LONG_EXPANDED_VALUES = {
  "2連率": ["17.8%", "23.9%", "12.5%", "42.6%", "1.4%", "34.0%"],
  調子: ["↑0.26", "↑1.82", "—", "↑0.36", "↓0.16", "↑0.05"],
  展示ST: ["0.05", "0.09", "0.12", "F.05", "0.01", "0.10"],
  体重: ["47.6kg", "47.9kg", "40.5kg", "47.0kg", "48.3kg", "52.0kg"],
  調整重量: ["0.0kg", "0.0kg", "6.5kg", "0.0kg", "0.0kg", "0.0kg"],
  今節前走: [
    "6着 6コース 11/22 7R",
    "3着 6コース 11/22 11R",
    "6着 3コース 11/22 5R",
    "3着 4コース 11/22 10R",
    "6着 6コース 11/22 4R",
    "2着 5コース 11/22 12R",
  ],
  枠番: ["13% 3/23", "0% 0/17", "0% 0/16", "3% 1/36", "0% 0/22", "4% 1/25"],
  決まり手: [
    "まくり差し 4勝",
    "逃げ 3勝",
    "まくり差し 3勝",
    "逃げ 13勝",
    "勝利なし",
    "まくり 2勝",
  ],
  回収率: ["110%", "0%", "0%", "28%", "0%", "87%"],
};

for (const width of [375, 1024]) {
  test(`会場のレースカード: 開いた行の列が艇番の列とそろい、6号艇の列が枠の中にある（${width}px）`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/races/2026-09-24/1", { waitUntil: "domcontentloaded" });
    const card = page.locator(".race-list-section .race-card").first();
    await expect(card.locator(".rcdt-table")).toBeVisible({ timeout: 30000 });
    await card.locator(".rcdt-expand-btn").click();
    // 開いた行（展示ST）が出るまで待つ。表の組み方（1つか2つか）に依らない形で待つ
    await expect(
      card.locator("tbody tr", { hasText: "展示ST" }).first(),
    ).toBeVisible({ timeout: 30000 });

    const m = await card.evaluate((el, values) => {
      el.querySelectorAll(".rcdt tbody tr").forEach((tr) => {
        const row = values[tr.children[0].textContent.trim()];
        if (!row) return;
        [...tr.children].slice(1).forEach((td, i) => {
          td.textContent = row[i];
        });
      });
      const heads = [...el.querySelectorAll("thead tr:first-child th")].map(
        (th) => th.getBoundingClientRect(),
      );
      const rows = [...el.querySelectorAll(".rcdt tbody tr")].map((tr) =>
        [...tr.children].map((td) => td.getBoundingClientRect()),
      );
      const wrap = el.querySelector(".rcdt-table-wrapper");
      return {
        overflow: wrap.scrollWidth - wrap.clientWidth,
        heads: heads.map((r) => ({ left: r.left, right: r.right })),
        rows: rows.map((cells) =>
          cells.map((r) => ({ left: r.left, right: r.right })),
        ),
      };
    }, LONG_EXPANDED_VALUES);

    // 常時の3行（勝率・当地・モーター）より多い＝開いた行も照らしている
    expect(m.rows.length).toBeGreaterThan(3);
    // 開いた後も6号艇の列が枠の中（横スクロールに隠れない）
    expect(m.overflow, "開いた後の出走表の横スクロール").toBeLessThanOrEqual(1);
    for (const [i, cells] of m.rows.entries()) {
      expect(cells.length, `${i + 1}行目: 列の数`).toBe(m.heads.length);
      for (const [j, cell] of cells.entries()) {
        expect(
          Math.abs(cell.left - m.heads[j].left),
          `${i + 1}行目の${j}列目: 左端が見出しとずれる`,
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(cell.right - m.heads[j].right),
          `${i + 1}行目の${j}列目: 右端が見出しとずれる`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });
}
