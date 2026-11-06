import { test, expect } from "./fixtures.js";

// BOA-1370: 履歴由来の決まり手も回数順に並び、バーと凡例の順が一致する。
test("選手の決まり手傾向は回数の多い順に並ぶ（BOA-1370）", async ({
  page,
}) => {
  await page.goto("/racer/3941");
  const profile = page.locator(".racer-technique-profile", {
    has: page.locator(".racer-technique-legend"),
  });
  const items = profile.locator(".racer-technique-legend li");
  await expect.poll(() => items.count()).toBeGreaterThanOrEqual(2);
  // フォールバックの「N回」ではなく、履歴が届いた後の「N回/全体回数」を待つ。
  await expect(items.first()).toContainText(/（\d+回\//);
  const labels = await items.allTextContents();
  const counts = labels.map((label) => {
    const match = label.match(/（(\d+)回\//);
    expect(match, label).not.toBeNull();
    return Number(match[1]);
  });
  expect(counts).toEqual([...counts].sort((a, b) => b - a));

  const names = labels.map((label) => label.trim().split(/\s/)[0]);
  const segments = profile.locator(".racer-technique-bar-segment");
  await expect(segments).toHaveCount(names.length);
  const barNames = await segments.evaluateAll((elements) =>
    elements.map((element) => element.title.split(/\s/)[0]),
  );
  expect(barNames).toEqual(names);
});
