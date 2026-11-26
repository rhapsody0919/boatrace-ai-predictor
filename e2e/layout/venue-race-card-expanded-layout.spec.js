// 会場のレースカードのミニ出走表で、開いた行の「今節前走」「部品交換」が折り返せず、6号艇の列が隠れないこと（G3 の点検 2026-11-26）。
// 本番 /venue/8（11/26）では、今節前走の3段（6着／6コース／11/25 11R）が .drt-nowrap の span で、部品交換が .drt-badge の札で
// 折れず、開いた後の表が枠より 72〜130px 広がった（375〜1920px の全幅）。venues-layout.spec.js の同じ趣旨の試験は値を
// textContent で平らに差し替えるので span が消え、この崩れを捕まえなかった。ここでは本番と同じ DOM の形を入れて測る
import { test, expect } from "../fixtures.js";

const PREV = [
  ["6着", "6コース", "11/25 9R"],
  ['<abbr title="妨（妨害失格）">妨</abbr>', "6コース", "11/25 5R"],
  ["1着", "1コース", "11/25 11R"],
  ["3着", "2コース", "11/25 11R"],
  ["3着", "4コース", "11/25 5R"],
  ["3着", "3コース", "11/25 9R"],
];
const PARTS = [
  "—",
  '<span class="drt-value drt-parts-changed"><span class="drt-badge"><span class="drt-part">リング</span><span class="drt-part">×１</span></span></span>',
  "—",
  "—",
  "—",
  "—",
];

test("会場のレースカード: 開いた行の今節前走・部品交換が折れ、6号艇の列が枠の中にある", async ({
  page,
}) => {
  await page.goto("/races/2026-09-24/1", { waitUntil: "domcontentloaded" });
  const card = page.locator(".race-list-section .race-card").first();
  await expect(card.locator(".rcdt-table")).toBeVisible({ timeout: 30000 });
  await card.locator(".rcdt-expand-btn").click();
  await expect(
    card.locator("tbody tr", { hasText: "今節前走" }).first(),
  ).toBeVisible({ timeout: 30000 });

  const m = await card.evaluate(
    (el, { prev, parts }) => {
      for (const tr of el.querySelectorAll(".rcdt-collapsed-rows tr")) {
        const label = tr.children[0].textContent.trim();
        const cells = [...tr.children].slice(1);
        if (label === "今節前走")
          cells.forEach((td, i) => {
            const [finish, course, race] = prev[i];
            td.innerHTML = `<span class="drt-value">${finish}<span class="drt-sub drt-nowrap"> ${course}</span><span class="drt-sub drt-nowrap">${race}</span></span>`;
          });
        if (label === "部品交換")
          cells.forEach((td, i) => {
            td.innerHTML = parts[i];
          });
      }
      const wrap = el.querySelector(".rcdt-table-wrapper");
      const heads = [...el.querySelectorAll("thead tr:first-child th")];
      return {
        overflow: wrap.scrollWidth - wrap.clientWidth,
        lastBoatRight: heads[heads.length - 1].getBoundingClientRect().right,
        wrapRight: wrap.getBoundingClientRect().right,
      };
    },
    { prev: PREV, parts: PARTS },
  );

  expect(m.overflow, "開いた後の出走表の横スクロール").toBeLessThanOrEqual(1);
  expect(m.lastBoatRight, "6号艇の列が枠の外").toBeLessThanOrEqual(
    m.wrapRight + 0.5,
  );
});
