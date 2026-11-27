import { test, expect } from "./fixtures.js";

/**
 * 展開予測の説明を「1着」にそろえる（BOA-710）。
 *
 * BOA-822 の公開（2026-11-27）で展開予測の画面（レース詳細の展開予測カードと「?」・使い方ガイドの展開予測の説明・
 * 成績ページの展開予測の説明・的中レースの一覧と共有文）が無くなったので、「1着」の言い回しを確かめていた
 * 3本は、その物が出ない／転送されることの確かめに書き換えた。
 * 書き換え前の期待（「1着になりそう」・「的中した候補」・共有文に「先頭」を書かない）は、画面ごと無くなっている。
 */

const RACE = "/race/2026-09-29-16-12";

for (const lang of ["ja", "en"]) {
  test(`イン崩れのタブに展開予測のカードと「?」は出ない（${lang}、BOA-710 → BOA-822）`, async ({
    page,
  }) => {
    test.slow();
    await page.goto(`${lang === "ja" ? "" : "/en"}${RACE}?tab=aiPrediction`);
    await expect(page.locator(".in-caution-tab")).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator(".turn-pattern-list")).toHaveCount(0);
    await expect(page.locator(".turn-pattern-summary")).toHaveCount(0);
  });
}

test("使い方ガイドと成績ページに、展開予測の説明は無い（BOA-710 → BOA-822）", async ({
  page,
}) => {
  await page.goto("/how-to-use");
  // ガイドはステップごとに切り替える。ステップ5は注意度
  await page.locator(".step-nav-btn", { hasText: "Step 5" }).click();
  await expect(page.locator("body")).toContainText("イン崩れ注意度");
  await expect(page.locator("body")).not.toContainText(
    "確率付きの上位パターン",
  );
  await expect(page.getByText("「1コース 逃げ 39%」")).toHaveCount(0);

  await page.goto("/accuracy");
  await expect(page.locator(".accuracy-dashboard")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator(".accuracy-info")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(
    "どの艇が1着になるかを予想する機能",
  );
});

test("的中レースの一覧（/hit-races）は成績ページへ転送され、的中のカードと共有文は出ない（BOA-710 → BOA-822）", async ({
  page,
}) => {
  await page.goto("/hit-races");
  await expect(page).toHaveURL(/\/accuracy$/, { timeout: 30000 });
  await expect(page.locator(".turn-hit-course-label")).toHaveCount(0);
  await expect(page.locator(".social-share-button")).toHaveCount(0);
});
