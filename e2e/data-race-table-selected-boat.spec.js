import { test, expect } from "./fixtures.js";

/**
 * 出走表（データ出走表）にも選んだ艇（?boat=）の列の強調を出す（オーナー 2026-11-23 承認の5、
 * docs/design/data-display/approved.md）。以前は出走表だけ選んだ艇を受け取らず、枠別情報・今節で
 * 4号艇を選んでいても出走表では分からなかった。
 *
 * - URL の ?boat= の列のセルと見出しに drt-selected が付き、ほかの列には付かない
 * - 艇番の見出しを押すと選び（URL に書き戻す）、ほかのタブに引き継がれる
 * - 同じ艇をもう一度押すと選択を外す
 *
 * レースは avg-st-period.spec.js と同じ（録画にある若松9R）。
 */
const RACE = "/race/2026-10-09-20-09";

const tab = (page, label) =>
  page.locator(".race-tabs-btn", { hasText: new RegExp(`^${label}$`) });

// 艇番 n の列のセル（ラベルの列を除く n 番目の td）
const columnCells = (table, n) =>
  table.locator(`tbody tr td.drt-cell:nth-child(${n + 1})`);

const boatButton = (table, n) =>
  table.locator(".drt-boat-select", { hasText: new RegExp(`^${n}$`) });

test.use({ viewport: { width: 390, height: 844 } });

test("出走表で選んだ艇の列を強調し、ほかのタブと選択を共有する", async ({
  page,
}) => {
  test.slow();
  await page.goto(`${RACE}?boat=3`, { waitUntil: "domcontentloaded" });
  await tab(page, "基本情報").click();
  const table = page.locator(".data-race-table .drt-table");
  await expect(table).toBeVisible({ timeout: 60000 });

  await test.step("URL の艇の列だけが強調される", async () => {
    const rowCount = await table.locator("tbody tr").count();
    expect(rowCount).toBeGreaterThan(0);
    await expect(table.locator("td.drt-selected")).toHaveCount(rowCount);
    await expect(columnCells(table, 3).first()).toHaveClass(/drt-selected/);
    await expect(columnCells(table, 2).first()).not.toHaveClass(
      /drt-selected/,
    );
    await expect(boatButton(table, 3)).toHaveAttribute("aria-pressed", "true");
    await expect(table.locator("th.drt-name-th.drt-selected")).toHaveCount(1);
  });

  await test.step("見出しを押すと選び直し、URL に書き戻す", async () => {
    await boatButton(table, 5).click();
    await expect(page).toHaveURL(/[?&]boat=5/);
    await expect(columnCells(table, 5).first()).toHaveClass(/drt-selected/);
    await expect(columnCells(table, 3).first()).not.toHaveClass(
      /drt-selected/,
    );
    await expect(boatButton(table, 3)).toHaveAttribute("aria-pressed", "false");
  });

  await test.step("選んだ艇が枠別情報タブに引き継がれる", async () => {
    await tab(page, "枠別情報").click();
    await expect(
      page.locator(".rwit-boat-chip").filter({
        has: page.locator(".rwit-boat-chip-num", { hasText: /^5$/ }),
      }),
    ).toHaveAttribute("aria-pressed", "true", { timeout: 30000 });
  });

  await test.step("同じ艇をもう一度押すと選択を外す", async () => {
    await tab(page, "基本情報").click();
    await expect(table).toBeVisible({ timeout: 30000 });
    await boatButton(table, 5).click();
    await expect(page).not.toHaveURL(/[?&]boat=/);
    await expect(table.locator(".drt-selected")).toHaveCount(0);
  });
});
