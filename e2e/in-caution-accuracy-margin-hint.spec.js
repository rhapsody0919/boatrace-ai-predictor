import { test, expect } from "./fixtures.js";

/**
 * /accuracy のイン崩れ注意度の段ごとの実績: ぶれ幅（偶然の幅）を行に出さず「?」にまとめ、見出しがにじまない（G4 T-31、plan.md §14）。
 *   - 行は「22,071レース中 65.7%（全体の29%のレース）」だけで「ぶれ幅」を含まない
 *   - 「段ごとに1号艇が1着を逃した割合」の横の「?」を押すと、段ごとのぶれ幅（崩れやすい 65.1〜66.3%）と読み方が出る
 *   - 見出しは .accuracy-dashboard h2 の 2rem・青い影に負けない（影なし・本文の色）
 * DB に依存しないよう accuracy_cache を差し替える（e2e/in-caution-accuracy.spec.js と同じ値）。
 */

const PRE = {
  from: "2025-06-01",
  to: "2026-10-10",
  base: { n: 75295, nonWin: 34194 },
  byLevel: {
    low: { n: 21027, nonWin: 5716 },
    mid: { n: 32169, nonWin: 13962 },
    high: { n: 22071, nonWin: 14503 },
  },
  sparse: { n: 28, nonWin: 13 },
};

test("/accuracy: ぶれ幅は行に出さず「?」に段ごとにまとめ、見出しは影なし", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("boatai-language", "ja"));
  await page.route("**/rest/v1/accuracy_cache*", (route) =>
    route.fulfill({
      status: 200,
      json: route.request().url().includes("in_caution_accuracy")
        ? [
            {
              data: {
                calculatedAt: "2026-10-17T17:40:00Z",
                def: "gapband-r-v1",
                prelaunch: PRE,
                postlaunch: null,
              },
            },
          ]
        : [],
    }),
  );
  await page.goto("/accuracy");
  const chart = page.locator(".ica");
  await expect(chart.locator(".ica-row")).toHaveCount(3, { timeout: 20000 });
  await expect(chart.locator(".ica-row").first()).toContainText(
    "22,071レース中 65.7%（全体の29%のレース）",
  );
  await expect(chart.locator(".ica-row").first()).not.toContainText("ぶれ幅");
  await expect(chart.locator(".ica-about")).not.toContainText("ぶれ幅");

  await chart
    .locator(".ica-card-head")
    .getByRole("button", { name: "用語の説明を見る" })
    .click();
  const popover = page.locator(".term-hint__popover");
  await expect(popover).toContainText("崩れやすい 65.1〜66.3%");
  await expect(popover).toContainText("実際の幅はもう少し広くなります");

  const title = page.locator("#ica-title");
  await expect(title).toHaveCSS("text-shadow", "none");
  const [titleColor, bodyColor] = await title.evaluate((el) => [
    getComputedStyle(el).color,
    getComputedStyle(el.closest(".ica").querySelector(".ica-card-title"))
      .color,
  ]);
  expect(titleColor).toBe(bodyColor);
});
