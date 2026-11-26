// 直前情報タブ「今節の足の推移と着順」を共通の推移の図へ載せ替えた後の、点を押す吹き出し（オーナー 2026-11-26 承認）。
// 吹き出しにその走の日・会場・R・艇→進入・着順・展示タイムを出し、「レースへ →」でその走のレース詳細へ飛べる。
// 点の中に着順、右端に6艇の最後の値の札がある。走の記録は録画の物を使う
import { test, expect } from "./fixtures.js";

const RACE_PATH = "/race/2026-10-14-22-12?tab=beforeInfo&boat=3";

test.use({ viewport: { width: 390, height: 844 } });

test("点を押すとその走の吹き出しが出て、レースへ飛べる", async ({ page }) => {
  test.slow();
  await page.goto(RACE_PATH, { waitUntil: "domcontentloaded" });
  const card = page.getByTestId("meet-form-trend");
  const svg = card.locator(".trc-svg");
  await expect(svg).toBeVisible({ timeout: 60000 });
  // 選んだ3号艇の点の中に着順（今節7走）、右端に6艇の札
  await expect(card.locator(".trc-mark-text")).toHaveCount(7);
  await expect(card.locator(".trc-end")).toHaveCount(6);
  // 9走まで走った2号艇のほかは7走で終わる。その5艇の札への引き出し線は点線（先の走に値が続いて見えない）
  await expect(card.locator('.trc-leader[stroke-dasharray="2 2"]')).toHaveCount(
    5,
  );
  // 注記は右の数字の意味と、点を押せることを書く（縦軸の頭と重なる「上ほど速い」は書かない）
  const note = card.locator(".rbi-chart-note");
  await expect(note).toContainText("このレースの値ではありません");
  await expect(note).toContainText("点を押すと");
  await expect(note).not.toContainText("上ほど速い");

  // 5走目（10/12 12R、1着）の点を押す。横は各艇の1走目から並ぶ
  await svg.scrollIntoViewIfNeeded();
  const marks = card.locator(".trc-mark-dot");
  const box = await marks.nth(4).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const tip = card.locator(".trc-tip");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("10/12");
  await expect(tip).toContainText("12R");
  await expect(tip).toContainText("1着");
  await expect(tip).toContainText("展示タイム");
  // 今節の走は ST を出さない
  await expect(tip).not.toContainText("ST");
  await expect(tip.locator(".trc-tip-link")).toHaveAttribute(
    "href",
    /^\/race\/2026-10-12-22-12$/,
  );
});
