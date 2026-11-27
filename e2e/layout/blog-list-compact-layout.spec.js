// ブログの一覧をスマホで詰めた形を守る: 1本の行が低く1画面に4本以上入り、題・説明・日付を消さない（Blog.css、2026-11-27）
import { test, expect } from "../fixtures.js";
import { OVERFLOW_TOLERANCE_PX } from "./helpers.js";

// 2026-11-27 の本番は 375px で1本のカードが約260pxあり、1画面（812px）に約2.5本しか入らなかった
const ROW_MAX_PX = 170;

test("/blog の一覧がスマホで詰まり、頁が横にはみ出さない @blog", async ({ page }) => {
  await page.goto("/blog", { waitUntil: "domcontentloaded" });
  const cards = page.locator(".blog-grid .blog-card");
  await expect(cards.first()).toBeVisible();
  const { width } = page.viewportSize();

  if (width <= 768) {
    const rows = await cards.evaluateAll((els) =>
      els.slice(0, 10).map((el) => ({
        height: el.getBoundingClientRect().height,
        title: el.querySelector("h3")?.textContent ?? "",
        description: el.querySelector(".description")?.textContent ?? "",
        date: el.querySelector(".date")?.textContent ?? "",
        descriptionVisible: (() => {
          const d = el.querySelector(".description");
          return Boolean(d) && d.getBoundingClientRect().height > 0;
        })(),
      })),
    );
    for (const row of rows) {
      expect(row.height).toBeLessThanOrEqual(ROW_MAX_PX);
      // 詰めても題・説明・日付は消さない（説明は1行に縮めるだけ）
      expect(row.title.length).toBeGreaterThan(0);
      expect(row.description.length).toBeGreaterThan(0);
      expect(row.date).toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(row.descriptionVisible).toBe(true);
    }
  }

  const sizes = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(sizes.scrollWidth).toBeLessThanOrEqual(
    sizes.clientWidth + OVERFLOW_TOLERANCE_PX,
  );
});
