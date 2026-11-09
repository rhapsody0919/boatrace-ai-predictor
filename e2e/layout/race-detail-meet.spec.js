import { test, expect } from "../fixtures.js";

// BOA-826: 769〜1199px はカードの外枠を720pxに止める。
// BOA-881: 1200px 以上はカードを列いっぱいにし、表（640）の右に注記を置く2段にする（「左に寄る」の解消）。
test("今節のカード: 1200px以上は列いっぱい、769〜1199pxは720px以下、768px以下は親幅のまま", async ({
  page,
}) => {
  await page.goto("/race/2026-09-23-09-12?tab=meet", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator(".rmt-compare tbody tr")).toHaveCount(6, {
    timeout: 30000,
  });
  for (const width of [1440, 1920, 1024, 769, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const measurements = await page.locator(".rmt-card").evaluateAll((cards) =>
      cards.map((card) => ({
        width: card.getBoundingClientRect().width,
        left: card.getBoundingClientRect().left,
        parentLeft: card.parentElement.getBoundingClientRect().left,
        parentWidth: card.parentElement.clientWidth,
      })),
    );
    expect(measurements.length).toBeGreaterThan(0);
    for (const card of measurements) {
      if (width >= 1200) {
        expect(Math.abs(card.width - card.parentWidth)).toBeLessThanOrEqual(1);
      } else if (width >= 769) {
        expect(card.width, `${width}px: カードの幅`).toBeLessThanOrEqual(720);
      } else {
        expect(Math.abs(card.width - card.parentWidth)).toBeLessThanOrEqual(1);
      }
      expect(Math.abs(card.left - card.parentLeft)).toBeLessThanOrEqual(1);
    }
    if (width >= 769) {
      const table = await page.locator(".rmt-compare").boundingBox();
      expect(table.width).toBeLessThanOrEqual(640);
    }
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(2);
  }
});
