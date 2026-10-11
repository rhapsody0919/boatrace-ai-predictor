import { test, expect } from "./fixtures.js";

// BOA-775: 基本情報タブの期間チップは「公式｜今期｜直近3ヶ月｜直近1ヶ月」、初期は「公式」（2026-10-10 ユーザー選択）。
//   公式: 勝率・2連率・3連率・平均ST を公式の出走表と同じ期で出し、「?」に期間を出す
//   今期: 当サイトの走から 5/1・11/1 以降で計算する（以前の「今期」は全期間で、名前と中身が食い違っていた）
// 若松9R 2026-10-09 の公式の平均ST は 0.16/0.17/0.18/0.18/0.15/0.19（公式の出走表と一致）
const RACE = "/race/2026-10-09-20-09";

async function openBasic(page) {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(RACE);
  await page.locator(".race-tabs-btn", { hasText: "基本情報" }).first().click();
  await expect(page.locator(".rbit-bars")).toBeVisible({ timeout: 30000 });
}

const barValues = (page) =>
  page
    .locator(".rbit-bar-row .rbit-value")
    .evaluateAll((els) => els.map((e) => e.textContent.trim()));

test.describe("基本情報タブの期間（BOA-775）", () => {
  test("初期は「公式」で、平均ST は公式の出走表と同じ値。「?」に期間が出る", async ({
    page,
  }) => {
    await openBasic(page);
    await page.locator(".rbit-period-details summary").click();
    await expect(
      page.locator(".rbit-period-details .rbit-chip.is-active"),
    ).toHaveText("公式");
    await page.locator(".rbit-chip", { hasText: "平均ST" }).click();
    await expect
      .poll(async () => (await barValues(page)).join(" "), { timeout: 30000 })
      .toContain("0.16");
    const vals = (await barValues(page)).map(
      (t) => t.match(/\d\.\d{2}/)?.[0] ?? t,
    );
    expect(vals).toEqual(["0.16", "0.17", "0.18", "0.18", "0.15", "0.19"]);

    await page
      .locator(".rbit-period-details .term-hint__button")
      .first()
      .click();
    await expect(page.locator(".term-hint__popover")).toContainText(
      "2025/11/1〜2026/4/30 の成績",
    );
  });

  test("「今期」は 5/1 以降の当サイトの走で、期間の初日を書く。グレードを選ぶと「公式」から「今期」に替わる", async ({
    page,
  }) => {
    await openBasic(page);
    await page.locator(".rbit-period-details summary").click();
    await page
      .locator(".rbit-period-details .rbit-chip", { hasText: "今期" })
      .click();
    await expect(page.locator(".rbit-period-caveat").first()).toContainText(
      "今期は 2026/5/1 以降の当サイトに記録した走から計算",
    );

    // 公式に戻してからグレードを選ぶと、公式の値はグレードで絞れないので今期に替わる
    await page
      .locator(".rbit-period-details .rbit-chip", { hasText: "公式" })
      .click();
    await page.locator(".rbit-chip", { hasText: "一般" }).first().click();
    await expect(
      page.locator(".rbit-period-details .rbit-chip.is-active"),
    ).toHaveText("今期");
  });
});

// BOA-802 の3: データ出走表のモーター2連率は当サイトの過去90日の値なので、見出しに期間を書く
// （龍神ソナー側は「モーター2連率（公式・節の時点）」）。平均ST の名前に期間を付けたのと同じ考え方
test("1440px: データ出走表のモーターの行の見出しは「モーター2連率（過去90日）」", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(RACE);
  await page
    .locator(".race-tabs-btn", { hasText: "基本情報" })
    .first()
    .click();
  await expect(
    page.locator(".drt-table .drt-label-full", {
      hasText: "モーター2連率（過去90日）",
    }),
  ).toBeVisible({ timeout: 30000 });
});
