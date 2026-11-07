import { test, expect } from "./fixtures.js";

// 直前情報の出典ボックスの注記の先頭に「※」を付けない（BOA-1222）。
// 表の「まわり足 ※」と、会場独自の計測の注記（表の下）だけが「※」を使い、出典ボックスの注記と意味を分ける
test("直前情報: 出典ボックスの注記に「※」が無く、まわり足の注記は「※」で始まる", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/race/2026-10-02-12-12?tab=beforeInfo");
  const venueNote = page.getByTestId("rbi-turn-time-venue-note");
  await expect(venueNote).toBeVisible({ timeout: 30000 });

  const source = page.getByTestId("rbi-source");
  await expect(source.locator(".rbi-source-text").first()).toBeVisible();
  const texts = await source.locator(".rbi-source-text").allInnerTexts();
  for (const text of texts) {
    expect(text).not.toContain("※");
  }

  expect((await venueNote.innerText()).trim().startsWith("※")).toBe(true);
  await expect(
    page.locator(".race-before-info-tab").getByText("まわり足 ※").first(),
  ).toBeVisible();
});
