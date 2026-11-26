import { test, expect } from "./fixtures.js";

/**
 * 選手ページの「3着以内のレースの3連単配当」（src/components/racer/RacerTrifectaInvolvement.jsx、G2 オーナー承認 2026-11-26）の固定。
 * - 絞り込みの枠の中で畳む。開いたときに配当を読む
 * - 表は 1着・2着・3着・全体の4行。全体の回数は1〜3着の和
 * - 「1走あたり配当」は円で出し、回収率・% と並べない（舟券1点の成績ではない、と注記する）。矢印・色は付けない
 * 録画の再生で 4320
 */

test("3連単配当は畳んで、開くと1着・2着・3着・全体の4行を円で出す", async ({ page }) => {
  await page.goto("/racer/4320");
  const fold = page.locator("#racer-filtered details.rti-fold");
  await expect(fold).toHaveCount(1, { timeout: 30000 });
  await expect(fold).not.toHaveAttribute("open", "");
  await fold.locator("summary").click();

  const rows = fold.locator(".rti-table tbody tr");
  await expect(rows).toHaveCount(4, { timeout: 30000 });
  await expect(rows.locator("th")).toHaveText(["1着", "2着", "3着", "全体"]);
  const counts = await rows.evaluateAll((trs) => trs.map((tr) => Number(tr.querySelector("td").textContent.replace(/[^\d]/g, ""))));
  expect(counts[3]).toBe(counts[0] + counts[1] + counts[2]);
  await expect(rows.nth(3).locator("td").nth(1)).toHaveText(/^[\d,]+円$/);

  await expect(fold).toContainText("舟券1点の成績ではありません");
  await expect(fold).not.toContainText("回収率");
  await expect(fold).not.toContainText(/[↑↓]/);
});

test("絞り込みを替えて配当の取得に失敗したら、前の絞り込みの配当で0円の表を出さず、失敗の表示だけ出す", async ({ page }) => {
  // 古い配当が残り、取得中・失敗のときに「0円・0回」の表を本物の顔で出した（ファン評価 P1 2026-11-26）
  let calls = 0;
  // 3連単の配当の取得（race_results の select に payout_trio）だけを、1回目は通し2回目から失敗させる
  const isTrifectaPayouts = (url) =>
    url.pathname.endsWith("/rest/v1/race_results") && (url.searchParams.get("select") ?? "").includes("payout_trio");
  await page.route(isTrifectaPayouts, (route) => {
    calls += 1;
    return calls === 1 ? route.fallback() : route.abort();
  });
  await page.goto("/racer/4320");
  const fold = page.locator("#racer-filtered details.rti-fold");
  await expect(fold).toHaveCount(1, { timeout: 30000 });
  await fold.locator("summary").click();
  await expect(fold.locator(".rti-table tbody tr")).toHaveCount(4, { timeout: 30000 });

  const course = page.locator("#vc-course");
  const value = await course.locator("option:not([disabled])").nth(1).getAttribute("value");
  await course.selectOption(value);
  await expect(fold.locator(".inline-fetch-error")).toBeVisible({ timeout: 30000 });
  await expect(fold.locator(".rti-table")).toHaveCount(0);
});
