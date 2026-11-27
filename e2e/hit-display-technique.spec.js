import { test, expect } from "./fixtures.js";

/**
 * 展開予測の的中の表示（BOA-724）は、BOA-822 の公開（2026-11-27）で画面から無くなった。
 * 的中の判定を出す所（タブの「イン崩れ」・的中レース一覧・共有文）に、的中の表示は出ない。
 *
 * BOA-822 の公開（2026-11-27）で表示が無くなったので外した:
 * - A-2: 共有文は、決まり手もコースも予想どおりのときだけ「予想通りの展開でした」と書く
 * - A-1: AI予想タブで、予想の決まり手が外れた的中には実際の決まり手を添える
 * - A-1: AI予想タブの「的中」は、決まり手と%の後ろではなく艇番の隣に付ける
 * - A-3: 的中レースのカードは、予想の決まり手が実際と違うときに実際の決まり手を添える
 * - A-2 (b): AI予想タブのまとめは、本命が予想どおりに勝ったときだけ「予想通り」と言う
 * - ファン評価3周目: 1着の艇の行は、AIが一番に推した決まり手のまま出し、外れは「実際」で示す
 * - ファン評価3周目: 的中カードの「（本命）」「（2コース進入）」を語の途中で折り返さない
 * - カードの見出しは、本命が予想どおりに勝ったときだけ「展開予測的中」にする（共有文と同じ区別）
 */

// 以前は「的中」の行・札・まとめが出ていた確定済みのレース（大村 9/30 10R、戸田 9/27 11R）
for (const raceId of ["2026-09-30-24-10", "2026-09-27-02-11"]) {
  test(`イン崩れタブには、展開予測の的中の行・札・まとめ・答え合わせが出ない: ${raceId}`, async ({
    page,
  }) => {
    test.slow();
    await page.goto(`/race/${raceId}`, { waitUntil: "domcontentloaded" });
    await page.locator(".race-tabs-btn", { hasText: /^イン崩れ$/ }).click();
    await expect(page.locator(".in-caution-tab")).toBeVisible({
      timeout: 60000,
    });
    for (const cls of [
      ".turn-pattern-row--hit",
      ".turn-pattern-hit-tag",
      ".turn-pattern-summary",
      ".turn-pattern-actual",
      ".result-verify-title",
    ]) {
      await expect(page.locator(cls), cls).toHaveCount(0);
    }
    await expect(page.locator(".in-caution-tab")).not.toContainText(
      /展開予測|予想通りの展開|的中/,
    );
  });
}
