// 直前情報タブ「今節の足の推移と着順」の注記（#3542 のファン評価 P2・P3、wording-editor 11/26）。
// 右端の数字の意味と、点を押せることを書き、縦軸の頭と重なる「上ほど速い」は書かない。走の記録は録画の物を使う
import { test, expect } from "./fixtures.js";

const RACE_PATH = "/race/2026-10-14-22-12?tab=beforeInfo&boat=3";

test.use({ viewport: { width: 390, height: 844 } });

test("今節の足の注記は右の数字の意味と点を押せることを書き、上ほど速いを書かない", async ({
  page,
}) => {
  test.slow();
  await page.goto(RACE_PATH, { waitUntil: "domcontentloaded" });
  const card = page.getByTestId("meet-form-trend");
  await expect(card.locator(".trc-svg")).toBeVisible({ timeout: 60000 });
  const note = card.locator(".rbi-chart-note");
  await expect(note).toContainText("このレースの値ではありません");
  await expect(note).toContainText("点を押すと");
  await expect(note).not.toContainText("上ほど速い");
});
