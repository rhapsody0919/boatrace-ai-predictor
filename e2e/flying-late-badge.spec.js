import { test, expect } from "./fixtures.js";

// BOA-440: Fバッジに「今節」の印、L（出遅れ）バッジ
test.describe("Fバッジの今節の印・Lバッジ（BOA-440）", () => {
  test("今節（前日まで）にFを切った艇にだけ「今節」の印が付き、前の節以前のF1には付かない", async ({
    page,
  }) => {
    // 2026-09-25 桐生7R: F1が5艇（1・2・3・5・6号艇）。
    // 5号艇（3740）は9/22 5R、6号艇（3654）は9/24 8Rで今節にFを切っている。
    // 1〜3号艇は今節（9/20〜）にFが無い＝期の前半のF
    await page.goto("/race/2026-09-25-01-07");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
      timeout: 25000,
    });
    const basic = page.locator(".rbit-bar-row .flying-badge");
    await expect(basic).toHaveCount(5);
    await expect(
      page.locator(".rbit-bar-row .flying-badge-meet"),
    ).toHaveCount(2);
    await expect(basic.filter({ hasText: "今節" }).first()).toHaveAttribute(
      "title",
      /今節（この開催の前日まで）/,
    );
    // 「今節はもう走らない」と読める言い方をしない（Fを切っても節の残りは出走する）
    const titles = await basic.evaluateAll((els) =>
      els.map((el) => el.getAttribute("title")).join(" "),
    );
    expect(titles).not.toMatch(/帰郷|休み|欠場/);

    // ST考察カード（枠別情報タブ）も同じ判定
    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();
    await page
      .locator(".rsc-card")
      .waitFor({ state: "visible", timeout: 25000 });
    await expect(page.locator(".rsc-grid .flying-badge")).toHaveCount(5);
    await expect(page.locator(".rsc-grid .flying-badge-meet")).toHaveCount(2);
  });

  test("l_count が1以上の艇にはLバッジがFとは別の見た目で出る", async ({
    page,
  }) => {
    // 2026-04-11 びわこ2R: 1号艇（5186）が F1・L1
    await page.goto("/race/2026-04-11-06-02");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
      timeout: 25000,
    });
    const late = page.locator(".rbit-bar-row .flying-badge.is-late");
    await expect(late).toHaveCount(1);
    await expect(late).toHaveText("L1");
    await expect(late).toHaveAttribute("title", /出遅れ/);
    const [lateBg, fBg] = await Promise.all([
      late.evaluate((el) => getComputedStyle(el).backgroundColor),
      page
        .locator(".rbit-bar-row .flying-badge:not(.is-late)")
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    ]);
    expect(lateBg).not.toBe(fBg);
  });
});
