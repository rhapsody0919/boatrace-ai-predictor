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
        // 灰色の帯は、トラック本体より矢印の幅だけ左に伸びている
        const arrowW = parseFloat(
          getComputedStyle(track).getPropertyValue("--rr-st-arrow-w"),
        );
        const nameText = row.querySelector(".rr-name-text");
        const range = document.createRange();
        range.selectNodeContents(nameText);
        return {
          bandLeftOverflow: t.left - arrowW - 2 - d.left,
          nameGap: t.left - arrowW - 2 - range.getBoundingClientRect().right,
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
    // 以前は約8px。矢印の本体を帯に収めるためトラック本体を12px詰めたので、目安は10px
    expect(tipOf("F.11") - tipOf("F.01")).toBeGreaterThanOrEqual(10);
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

test.describe("結果タブのスタートの図: 帯と名前の間（#1071 ファン評価2周目）", () => {
  test.use({ reducedMotion: "reduce" });

  for (const width of [375, 1024, 1440]) {
    test(`${width}px: 遅いスタート（ST0.29・0.33）の矢印も灰色の帯の中に収まる`, async ({
      page,
    }) => {
      // 桐生 2026-09-25 1R: ST 0.29・0.24・0.17・0.24・0.23・0.33
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/race/2026-09-25-01-01");
      await page.locator(".rr-st-track").first().waitFor({ timeout: 30000 });
      await page.waitForTimeout(500);
      const rows = await page.evaluate(() =>
        [...document.querySelectorAll(".rr-row")]
          .map((row) => {
            const track = row.querySelector(".rr-st-track");
            if (!track) return null;
            const t = track.getBoundingClientRect();
            const d = track.querySelector(".rr-st-dot").getBoundingClientRect();
            const arrowW = parseFloat(
              getComputedStyle(track).getPropertyValue("--rr-st-arrow-w"),
            );
            return {
              st: row.querySelector(".rr-st-value")?.textContent,
              overflow: t.left - arrowW - 2 - d.left,
            };
          })
          .filter(Boolean),
      );
      for (const r of rows) expect(r.overflow, r.st).toBeLessThanOrEqual(0.5);
    });
  }

  test("1440px: 名前とスタートの図の間に大きな空白を残さない", async ({
    page,
  }) => {
    // 以前は名前の列が余りの幅を全部取り、1440px で約660px空いていた
    const rows = await measure(page, 1440);
    for (const r of rows) expect(r.nameGap, r.st).toBeLessThanOrEqual(260);
  });
});
