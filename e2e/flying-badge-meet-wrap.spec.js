import { test, expect } from "./fixtures.js";

/**
 * F バッジの「今節」の印は、ST考察カードの1列（375pxで約49px）に入る。ko を「이번 절」から
 * 「이번 시리즈」に揃えたら1行に収まらず、両端が欠けて読めなくなった（BOA-720 のファン評価）。
 * 語の切れ目で折り返し、セルからはみ出さないこと。
 */
test("今節の印は狭いセルでも語の切れ目で折り返し、はみ出さない", async ({
  page,
}) => {
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => import("/src/components/race/FlyingBadge.css"));
  const result = await page.evaluate(() => {
    const cell = document.createElement("div");
    cell.style.width = "49px";
    cell.innerHTML =
      '<span class="flying-badge is-f2 has-meet">F2<span class="flying-badge-meet">이번 시리즈</span></span>';
    document.body.appendChild(cell);
    const badge = cell.querySelector(".flying-badge");
    const meet = cell.querySelector(".flying-badge-meet");
    return {
      badgeRight: badge.getBoundingClientRect().right,
      cellRight: cell.getBoundingClientRect().right,
      meetOverflow: meet.scrollWidth - meet.clientWidth,
      meetLines: Math.round(
        meet.getBoundingClientRect().height /
          parseFloat(getComputedStyle(meet).lineHeight),
      ),
    };
  });
  expect(result.badgeRight).toBeLessThanOrEqual(result.cellRight);
  expect(result.meetOverflow).toBeLessThanOrEqual(0);
  // 「이번 / 시리즈」の2行（音節の途中では切らない）
  expect(result.meetLines).toBe(2);
});
