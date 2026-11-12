import { test, expect } from "./fixtures.js";

// 出典ボックスの注記の「※」と、表のまわり足の「※」（会場独自の計測）は別の意味。
// 出典ボックスの注記には「※」を付けず、表のまわり足の「※」と分ける（BOA-1222）
const WIDTHS = [
  { width: 375, height: 800, label: ".drt-label-short" },
  { width: 1440, height: 900, label: ".drt-label-full" },
];

for (const { width, height, label } of WIDTHS) {
  test(`直前情報: 出典ボックスの注記に「※」が付かず、まわり足の「※」は残る（${width}px）`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/race/2026-10-02-12-12?tab=beforeInfo");
    const venueNote = page.getByTestId("rbi-turn-time-venue-note");
    await expect(venueNote).toBeVisible({ timeout: 30000 });

    const source = page.getByTestId("rbi-source");
    const texts = await source.locator(".rbi-source-text").allTextContents();
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      expect(text).not.toContain("※");
    }

    expect((await venueNote.textContent()).trim().startsWith("※")).toBe(true);

    // 見出しは「まわり」＋ 末尾の「足 ※」（.drt-turn-tail）に分かれて描画される（BOA-1029）
    await expect(
      page
        .locator(`.race-before-info-tab .drt-turn-tail ${label}`)
        .filter({ hasText: /^足\s※$/ })
        .first(),
    ).toBeVisible();
  });
}
