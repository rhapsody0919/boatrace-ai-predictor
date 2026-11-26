import { test, expect } from "./fixtures.js";

/**
 * 選手ページの枠番別回収率の扱いと、公式の期別の値の呼び名（UI/UX 改善 #8・#9、承認 docs/design/racer-wt-uiux-2026-11/mock/approved.md）の固定。
 * - 枠番別回収率は「この枠の中は絞り込みが効きます」の枠の中で畳んで「参考・N走」を付ける。矢印・色は付けない
 * - 30走未満も走数つきで率を出す（0走は「—」）。過去180日の固定と30走未満の「-」は、オーナーの指摘で
 *   絞り込みに合わせる形へ改めた（G2、オーナー承認 2026-11-26、side-session-notes の g2-racer/rr2・rr3）
 * - 公式の期別成績の2連の率は「2連対率」（出走表・当サイト集計の「2連率」と呼び分ける）
 * - 推移は枠番を選んで、各走の時点までの通算の線。全部の点に走数（オーナー 2026-11-26）
 * 録画の再生で 4320
 */

// 試験名は元のまま残す（guard-weakening は試験名が消えると赤）。中身はオーナー承認 2026-11-26 の形:
// 30走未満も「-」で隠さず率と走数を出し（0走だけ「—」）、絞り込みの枠の中に置く。題に期間を固定しない
test("枠番別回収率は畳んで参考・N走、30走未満の枠番は「-」で矢印・色は無い", async ({
  page,
}) => {
  await page.goto("/racer/4320");
  const fold = page.locator("#racer-filtered details.racer-return-fold");
  await expect(fold).toHaveCount(1, { timeout: 30000 });
  await expect(fold).not.toHaveAttribute("open", "");
  await expect(fold.locator("summary")).toHaveText(
    /^枠番別回収率.*参考・\d+走・上の絞り込みが全て効きます$/,
  );

  // タップ領域は44px以上で、▶ の印（list-item）が残る
  const box = await fold.locator("summary").boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await expect(fold.locator("summary")).toHaveCSS("display", "list-item");

  await fold.locator("summary").click();
  const rows = fold.locator("tbody tr");
  await expect(rows).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const cells = rows.nth(i).locator("td");
    const n = Number(await cells.nth(1).innerText());
    // 30走未満も「-」で隠さない。走が無い枠番だけ「—」
    await expect(cells.nth(2)).toHaveText(n > 0 ? /^[\d,]+%\s*1着\d+回(\s*最大の1回が\d+%)?$/ : /^—$/);
    await expect(cells.nth(3)).toHaveText(n > 0 ? /^[\d,]+%$/ : /^—$/);
  }
  await expect(fold.locator("[class*='diff'], [class*='better'], [class*='worse']")).toHaveCount(0);
  await expect(fold).not.toContainText(/[↑↓]/);
});

test("枠番別回収率の推移は枠番を選ぶと、その枠番の通算の線に替わる", async ({ page }) => {
  await page.goto("/racer/4320");
  const fold = page.locator("#racer-filtered details.racer-return-fold");
  await expect(fold).toHaveCount(1, { timeout: 30000 });
  await fold.locator("summary").click();
  const picks = fold.getByRole("group", { name: "推移を見る枠番" }).getByRole("button");
  await expect(picks).toHaveCount(6);
  // 最初は線を引ける枠番が選ばれている。2号艇を押すと替わる
  await expect(fold.locator("[aria-pressed='true']")).toHaveCount(1);
  await picks.nth(1).click();
  await expect(picks.nth(1)).toHaveAttribute("aria-pressed", "true");
  // 全部の点に走数（オーナー 2026-11-26）: 図の上に今の点の「N走目（日付）」が出る
  await expect(fold.locator(".rbr-readout")).toHaveText(/^\d+走目（\d\d\/\d\d）単勝 [\d,]+%・複勝 [\d,]+%$/);
  await expect(fold.locator(".rbr-trend-sub")).toContainText("2号艇");
});

test("枠番別回収率の推移で点を押してから走の少ない枠番に替えても落ちず、最新の点を出す", async ({ page }) => {
  // 押した位置が残り、点の数が減った枠番で落ちてページが消えた（ファン評価 P0 2026-11-26）
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/racer/4320");
  const fold = page.locator("#racer-filtered details.racer-return-fold");
  await expect(fold).toHaveCount(1, { timeout: 30000 });
  await fold.locator("summary").click();
  const picks = fold.getByRole("group", { name: "推移を見る枠番" }).getByRole("button");
  await picks.nth(0).click();
  const chart = fold.locator(".rbr-chart");
  const box = await chart.boundingBox();
  await chart.click({ position: { x: box.width * 0.75, y: box.height / 2 } });
  for (let i = 1; i < 6; i++) {
    await picks.nth(i).click();
    await expect(fold.locator(".rbr-trend-sub")).toContainText(`${i + 1}号艇`);
  }
  expect(errors).toEqual([]);
});

test("冒頭の要約の公式の期別の値は「2連対率」と呼ぶ", async ({ page }) => {
  await page.goto("/racer/4320");
  const summary = page.getByTestId("racer-summary");
  await expect(summary).toBeVisible({ timeout: 30000 });
  await expect(summary.locator("dt").filter({ hasText: "2連対率" })).toHaveCount(1);
  await expect(summary.locator("dt").filter({ hasText: /^2連率/ })).toHaveCount(0);
});
