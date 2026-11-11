// 旧 e2e/layout.spec.js から切り出しスクリプトで移した（CI02。題・中身は元のまま、import の相対の字だけ1段深くした）
import { test, expect } from "../fixtures.js";
import {
  HIT_RACES_FIXED_DATE,
  gotoAndSettle,
  inspectGrids,
  expectNoWastedGrids,
  serveFixedHitRaces,
} from "./helpers.js";

/**
 * BOA-527 の再現テスト。
 *
 * `/hit-races` のカード（`.race-cards-grid`）は `repeat(auto-fill, minmax(280px, 1fr))`
 * で並んでいた。`auto-fill` はカードが足りなくても列の枠を作るため、当日の的中が
 * 列数より少ない日だけ右側に空の列が残り（1920px: 6列にカード5枚で右307px）、
 * 上の PAGES の検査が本番データの巡り合わせで落ちていた。
 *
 * 件数を固定して検査するため、「今日」の予想データの応答を生成済みの過去日
 * （HIT_RACES_FIXED_DATE）の行に差し替え、そのうち展開予測が的中したレースを
 * 先頭から `hits` 件だけ残す（検査するのは既定の「今日」タブのグリッド）。
 * 差し替え（serveFixedHitRaces）は helpers.js にある（all-pages-layout の /hit-races も使う）。
 */

test.describe("レイアウト: /hit-races は的中が列数より少なくても幅を余らせない（BOA-527）", () => {
  // 1〜3件は、1440px（4列）・1920px（6列）の列数を下回る側。
  // "all" は列数以上（固定日の的中全件。表示は先頭8件に絞られる）
  for (const hits of [1, 2, 3, "all"]) {
    const label = hits === "all" ? "多数" : `${hits}件`;
    test(`的中が${label}のとき空トラックが出ない`, async ({ page }) => {
      const state = await serveFixedHitRaces(page, hits);
      await gotoAndSettle(page, "/hit-races");

      const grid = page.locator(".hit-races-section .race-cards-grid");
      await expect(
        grid,
        `.race-cards-grid が描画されていません（${HIT_RACES_FIXED_DATE} への差し替えが効いていない可能性）`,
      ).toBeVisible({ timeout: 30000 });

      // 固定日の的中が足りない・差し替えが効かず本番の当日データのまま検査する、
      // という空振りを防ぐ
      expect(
        state.available,
        `${HIT_RACES_FIXED_DATE} の的中が足りず、${label}のケースを作れません`,
      ).toBeGreaterThanOrEqual(hits === "all" ? 9 : hits);
      await expect(grid.locator(":scope > *")).toHaveCount(
        hits === "all" ? 8 : hits,
      );

      expectNoWastedGrids(await inspectGrids(page));
    });
  }
});

/**
 * BOA-754 の再現テスト。/hit-races の期間タブ（今日・昨日・全期間（14日間））が
 * 375px で2段に割れ、「全期間」がタブに見えなかった。どの幅でも1段に並び、はみ出さないこと
 */
test.describe("レイアウト: /hit-races の期間タブは1段に並ぶ（BOA-754）", () => {
  test("期間タブの3つが同じ行にあり、枠からはみ出さない", async ({ page }) => {
    await serveFixedHitRaces(page, "all");
    await gotoAndSettle(page, "/hit-races");
    const selector = page.locator(".period-selector");
    await expect(selector).toBeVisible({ timeout: 30000 });
    const state = await selector.evaluate((el) => {
      const buttons = [...el.querySelectorAll("button")];
      const box = el.getBoundingClientRect();
      return {
        count: buttons.length,
        tops: [
          ...new Set(
            buttons.map((b) => Math.round(b.getBoundingClientRect().top)),
          ),
        ],
        overflowRight: Math.max(
          ...buttons.map((b) => b.getBoundingClientRect().right - box.right),
        ),
      };
    });
    expect(state.count).toBe(3);
    expect(state.tops, "期間タブが2段に割れている").toHaveLength(1);
    expect(state.overflowRight).toBeLessThanOrEqual(1);
  });
});
