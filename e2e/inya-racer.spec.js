import { test, expect } from "./fixtures.js";

/**
 * 「イン屋」の札と前付けの説明（2026-11-03、docs/design/inya-racer/）の固定。
 * 判定の境目は scripts/maintenance/verify-front-taking.js が固定の入力で検証する。ここでは画面に出る場所と形を見る。
 * 3024 西島義則（2019年以降、4〜6号艇の走の9割以上で1〜3コース。札が付く）・4765 野田部宏子（前付けほぼ無し）
 */

test("イン屋の選手は名前の下に札、進入コース別成績の直上に説明、コース別の表に理由の1行", async ({
  page,
}) => {
  await page.goto("/racer/3024");
  const chip = page.getByTestId("racer-inya-chip");
  await expect(chip).toBeVisible({ timeout: 30000 });
  await expect(chip).toHaveAttribute("title", /公式の用語ではありません/);
  const box = page.getByTestId("racer-front-taking");
  await expect(box).toHaveAttribute("data-status", "inya");
  await expect(box).toContainText("イン屋（前付け）");
  await expect(box).toContainText(/4〜6号艇で出た\d+走中 \d+走（\d+%）/);
  await expect(box).toContainText("当日も前付けするとは限りません");
  // 説明は進入コース別成績の中、表より前（1か所だけ）
  await expect(page.getByTestId("racer-front-taking")).toHaveCount(1);
  await expect(
    page.locator(".racer-official-stats [data-testid=racer-front-taking]"),
  ).toHaveCount(1);
  await expect(page.getByTestId("racer-course-inya-note")).toBeVisible();
  // 札を押すと説明へ移る
  await chip.click();
  await expect(box).toBeInViewport();
});

test("札の無い選手は見出しに範囲を付け、0走は「入った走はありませんでした」", async ({
  page,
}) => {
  await page.goto("/racer/4765");
  const box = page.getByTestId("racer-front-taking");
  await expect(box).toHaveAttribute("data-status", /rate|insufficient/, {
    timeout: 30000,
  });
  await expect(box).toContainText("4〜6号艇での進入（前付け）");
  await expect(page.getByTestId("racer-inya-chip")).toHaveCount(0);
  await expect(page.getByTestId("racer-course-inya-note")).toHaveCount(0);
});

test("選手情報の無いページには前付けの説明を出さない", async ({ page }) => {
  await page.goto("/racer/9999");
  await expect(page.locator(".racer-profile-header h1")).toContainText(
    "選手情報なし",
    {
      timeout: 30000,
    },
  );
  await page.waitForTimeout(3000);
  await expect(page.getByTestId("racer-front-taking")).toHaveCount(0);
});
