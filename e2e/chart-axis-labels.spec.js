import { test, expect } from "./fixtures.js";

/**
 * 分析ツールの棒グラフの横軸ラベル（艇番）が375pxで重ならないことの固定（BOA-615）。
 *
 * ko の「N号艇」を「N번 보트」にそろえたところ、ja の「N号艇」・en の「Boat N」より
 * 幅を取り、375pxで隣のラベルと重なって「1번 보트2번 보트…」と1本の文字列に見えた。
 * BandWrapAxisTick で棒1本ぶんの幅を超えたときだけ空白で折り返す。
 *
 * en は棒1本に収まるので折り返さないことも確かめる（固定幅で折り返すと en まで
 * 「Boat / 1」の2行になる。最初の修正で実際にそうなった）。
 */

test.use({ viewport: { width: 375, height: 812 } });

async function tickBoxes(page) {
  const ticks = page.locator(".recharts-xAxis-tick-labels text");
  await expect(ticks).toHaveCount(6, { timeout: 60000 });
  return ticks.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        lines: el.querySelectorAll("tspan").length,
        text: el.textContent,
      };
    }),
  );
}

for (const tab of ["technique", "topstart"]) {
  test(`ko /winning-technique?tab=${tab} の横軸ラベルが重ならない`, async ({
    page,
  }) => {
    await page.goto(`/ko/winning-technique?tab=${tab}`);
    const boxes = await tickBoxes(page);
    for (let i = 0; i < boxes.length - 1; i += 1) {
      expect(
        boxes[i].right,
        `「${boxes[i].text}」と「${boxes[i + 1].text}」が重なっている`,
      ).toBeLessThanOrEqual(boxes[i + 1].left);
    }
  });
}

test("en /winning-technique?tab=technique の横軸ラベルは折り返さない", async ({
  page,
}) => {
  await page.goto("/en/winning-technique?tab=technique");
  const boxes = await tickBoxes(page);
  expect(boxes.map((b) => b.lines)).toEqual([1, 1, 1, 1, 1, 1]);
});
