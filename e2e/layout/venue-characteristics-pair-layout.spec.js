// 会場ページの「<会場>のコース別成績と特徴（直近1年）」で、768px 以上は「進入コース別の表｜決まり手の表」を2列に並べ、
// 見出しの上端をそろえること（G3 の点検 2026-11-26）。1列のままだと PC で表が 1152px のカードの左に寄って縦に積まれた。
// 767px 以下は今のまま縦に積む。幅は layout-* の project ごと（375・768・1024・1440・1920）
import { test, expect } from "../fixtures.js";

test("会場の特徴のカード: 768px 以上で進入コース別と決まり手の表が2列に並び、見出しの上端がそろう", async ({
  page,
}) => {
  await page.goto("/races/2026-09-24/1", { waitUntil: "domcontentloaded" });
  const card = page.locator(".venue-characteristics-card");
  await expect(card.locator(".venue-course-table")).toBeVisible({
    timeout: 30000,
  });
  const m = await card.evaluate((el) => {
    const r = (sel) => el.querySelector(sel).getBoundingClientRect();
    const cols = [...el.querySelectorAll(".venue-characteristics-pair > div")];
    const heads = cols.map((c) =>
      c
        .querySelector(".venue-characteristics-subtitle")
        .getBoundingClientRect(),
    );
    return {
      course: r(".venue-course-table"),
      tech: r(".venue-technique-table"),
      techCol: cols[1].getBoundingClientRect(),
      heads: heads.map((h) => h.top),
      overflow: el.scrollWidth - el.clientWidth,
    };
  });
  expect(m.overflow, "カードの横のはみ出し").toBeLessThanOrEqual(1);
  expect(m.heads.length, "左右の列に見出しが1つずつ").toBe(2);
  if (page.viewportSize().width >= 768) {
    expect(m.course.right).toBeLessThanOrEqual(m.tech.left);
    expect(Math.abs(m.heads[0] - m.heads[1])).toBeLessThanOrEqual(1);
    // 決まり手の表は右の列いっぱい（以前は max-width 28rem で右端がそろわなかった）
    expect(Math.abs(m.tech.right - m.techCol.right)).toBeLessThanOrEqual(1);
  } else {
    expect(m.tech.top).toBeGreaterThanOrEqual(m.course.bottom);
  }
});
