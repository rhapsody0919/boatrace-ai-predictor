import { test, expect } from "./fixtures.js";

// 結果タブのスタートの図（BOA-586）。浜名湖 2026-09-14 6R は不成立で、
// 6艇中5艇が F（F.11・F.09・F.03・F.03・F.01）、4号艇だけ 0.02
const RACE = "/race/2026-09-14-06-06";

async function measure(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(RACE);
  await page.locator(".rr-st-track").first().waitFor({ timeout: 30000 });
  // 動きを止めて静止位置で測る
  await page.waitForTimeout(500);
  return page.evaluate(() =>
    [...document.querySelectorAll(".rr-row")]
      .map((row) => {
        const track = row.querySelector(".rr-st-track");
        if (!track) return null;
        const t = track.getBoundingClientRect();
        const d = track.querySelector(".rr-st-dot").getBoundingClientRect();
        return {
          st: row.querySelector(".rr-st-value")?.textContent,
          trackWidth: t.width,
          tip: d.right - t.left,
          overflow: d.right - t.right,
          fastest: Boolean(row.querySelector(".rr-st-fastest-tag")),
        };
      })
      .filter(Boolean),
  );
}

test.describe("結果タブのスタートの図（BOA-586）", () => {
  test.use({ reducedMotion: "reduce" });

  test("375px: F.01 と F.11 の位置の差が読み取れ、F の矢印はトラックからはみ出さない", async ({
    page,
  }) => {
    const rows = await measure(page, 375);
    const tipOf = (st) => rows.find((r) => r.st === st).tip;
    // 以前はスタートラインが84%で F 側が14%しか無く、差は約8pxだった
    expect(tipOf("F.11") - tipOf("F.01")).toBeGreaterThanOrEqual(12);
    for (const r of rows) expect(r.overflow, r.st).toBeLessThanOrEqual(0);
    // F.01 でも、矢印の先端が線から 4px 以上先にある（以前は約1.5pxで、線に重なって見えた。
    // #1071 ファン評価1周目）。線の位置はトラックの72%
    const f01 = rows.find((r) => r.st === "F.01");
    expect(f01.tip - f01.trackWidth * 0.72).toBeGreaterThanOrEqual(4);
  });

  test("1440px: トラックを広げ、0.01秒の差が読み取れる", async ({ page }) => {
    const rows = await measure(page, 1440);
    // 以前は 6.5rem（104px）固定で、名前の列との間が約700px空いていた
    expect(rows[0].trackWidth).toBeGreaterThanOrEqual(240);
    const tipOf = (st) => rows.find((r) => r.st === st).tip;
    expect(tipOf("F.11") - tipOf("F.01")).toBeGreaterThanOrEqual(40);
  });

  test("F 以外が1艇しかいないときは「最速」を付けない", async ({ page }) => {
    const rows = await measure(page, 1440);
    expect(rows.filter((r) => r.fastest)).toHaveLength(0);
  });
});

test("最終レースでは下部ナビの「次のレース」ボタンを隠す（「- →」と出さない。BOA-586）", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/race/2026-09-25-01-12");
  const buttons = page.locator(
    ".race-bottom-nav__race-row .race-bottom-nav__btn",
  );
  await expect(buttons.first()).toBeVisible({ timeout: 30000 });
  await expect(buttons.first()).toContainText("11R");
  await expect(buttons.last()).toBeHidden();
});
