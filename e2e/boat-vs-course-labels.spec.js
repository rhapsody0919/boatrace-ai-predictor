import { test, expect } from "./fixtures.js";

/**
 * 展開予測の的中は艇番で判定する（BOA-708）。予測が「枠なりを前提に N号艇が勝つ」という
 * 艇の予測のため。一方で、艇番を「Nコース」と書いていた表記が、前付けのあったレースで
 * 誤表示になっていた。表記は艇番にし、前付けで艇番とコースが違うときだけ進入コースを添える。
 */

const tab = (page, label) =>
  page.locator(".race-tabs-btn", { hasText: new RegExp(`^${label}$`) });

test.describe("艇番とコースの表記（BOA-708）", () => {
  test("前付けのあったレースでは、AI予想タブに1着の艇の進入コースを添える", async ({
    page,
  }) => {
    test.slow();
    // 2026-08-13 桐生2R: 6号艇が1コースに入って1着（予想は1号艇の逃げ → 艇番で判定して外れ）
    await page.goto("/race/2026-08-13-01-02", {
      waitUntil: "domcontentloaded",
    });
    await tab(page, "AI予想").click();
    const note = page.locator(".result-verify-entry-note");
    await expect(note).toContainText("1着の6号艇は1コースから進入しました", {
      timeout: 60000,
    });
  });

  test("艇番どおりのコースから勝ったレースでは、進入コースの注記を出さない", async ({
    page,
  }) => {
    test.slow();
    // 2026-09-27 戸田11R: 1号艇が1コースから1着
    await page.goto("/race/2026-09-27-02-11", {
      waitUntil: "domcontentloaded",
    });
    await tab(page, "AI予想").click();
    await expect(page.locator(".turn-pattern-summary").first()).toBeVisible({
      timeout: 60000,
    });
    await expect(page.locator(".result-verify-entry-note")).toHaveCount(0);
  });

  test("的中のシェア文は艇番で書き、進入が違うときだけコースを添える", async ({
    page,
  }) => {
    await page.goto("/about", { waitUntil: "domcontentloaded" });
    const texts = await page.evaluate(async () => {
      const { generateTurnHitShareText } = await import("/src/utils/share.js");
      const base = { venue: "津", raceNo: 6, date: "2026-08-11" };
      return {
        frontRunner: generateTurnHitShareText({
          ...base,
          winnerBoat: 4,
          winnerEntryCourse: 2,
        }),
        sameCourse: generateTurnHitShareText({
          ...base,
          winnerBoat: 1,
          winnerEntryCourse: 1,
        }),
        unknown: generateTurnHitShareText({
          ...base,
          winnerBoat: 3,
          winnerEntryCourse: null,
        }),
      };
    });
    expect(texts.frontRunner).toContain("4号艇が1着（2コースから）");
    expect(texts.sameCourse).toContain("1号艇が1着");
    expect(texts.sameCourse).not.toContain("コースから");
    expect(texts.unknown).toContain("3号艇が1着");
    for (const text of Object.values(texts)) {
      expect(text).not.toContain("コースが先頭");
    }
  });

  test("1着の艇の進入コースは actual_course を優先し、無ければ entry_course で補う", async ({
    page,
  }) => {
    await page.goto("/about", { waitUntil: "domcontentloaded" });
    const values = await page.evaluate(async () => {
      const { winnerEntryCourseOf } = await import("/src/utils/raceOutcome.js");
      return [
        // 確定済み（Kファイル同期後）: actual_course を使う
        winnerEntryCourseOf({ rank1: 4, actual_course_4: 2 }, 3),
        // 当日（同期前）: entry_course で補う
        winnerEntryCourseOf({ rank1: 4, actual_course_4: null }, 2),
        // どちらも無い: 出さない
        winnerEntryCourseOf({ rank1: 4 }, null),
        // 結果が無い
        winnerEntryCourseOf(null, 2),
      ];
    });
    expect(values).toEqual([2, 2, null, null]);
  });
});
