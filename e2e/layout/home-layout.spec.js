// 旧 e2e/layout.spec.js から切り出しスクリプトで移した（CI02。題・中身は元のまま、import の相対の字だけ1段深くした）
import { test, expect } from "../fixtures.js";
import { rewriteTodayRaces } from "../today-races-rewrite.js";
import { OVERFLOW_TOLERANCE_PX, gotoAndSettle } from "./helpers.js";

/**
 * BOA-539 の再現テスト。
 *
 * `/guide`（src/pages/ContentHub.css）とホーム（src/components/race/VenueGrid.css）が、
 * 同じ詳細度の `.venue-grid` を別々に定義していた。CSSは全ページ分が1つのバンドルに
 * 結合され、ContentHub.css が後に来るため、ホームの会場グリッドに `/guide` 側の
 * `repeat(auto-fill, minmax(100px, 1fr))` が効いていた（修正前の実測: 1024pxで8列・
 * 1440pxで12列・1920pxで16列。VenueGrid.css の指定は4列）。
 * 読み込み順だけで決まるため、どのページから開いても同じ結果になる。ここでは
 * 両ページのCSSが確実に適用済みになる「/guide → SPA遷移でホーム」の順で測る。
 * `/guide` 側は `.guide-venue-grid` に改名して名前空間を分けた。
 *
 * 期待値は VenueGrid.css の指定（421px以上で4列、420px以下で3列、320px以下で2列）
 */
function expectedHomeVenueColumns(width) {
  if (width <= 320) return 2;
  if (width <= 420) return 3;
  return 4;
}

test.describe("レイアウト: ホームの会場グリッドに /guide の指定が効かない（BOA-539） @blog", () => {
  test("/guide からSPA遷移で戻ったホームの会場グリッドが意図した列数になる", async ({
    page,
  }) => {
    await gotoAndSettle(page, "/guide");
    // /guide の会場リンク（24場）が描画され、ContentHub.css が適用済みであること
    await expect(
      page.locator('.venue-section a[href^="/blog/venue-"]'),
    ).toHaveCount(24);

    // ヘッダーのロゴは navigate("/") のSPA遷移（ページを再読み込みしない）
    await page.locator(".app-header .logo").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.locator(".venue-grid-card--open, .venue-grid-card--closed").first(),
    ).toBeAttached({ timeout: 30000 });

    const grid = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector(".venue-grid"));
      return {
        width: window.innerWidth,
        columns: cs.gridTemplateColumns.split(" ").filter(Boolean).length,
        gridTemplateColumns: cs.gridTemplateColumns,
      };
    });
    expect(grid.columns, JSON.stringify(grid)).toBe(
      expectedHomeVenueColumns(grid.width),
    );
  });
});

/**
 * BOA-1199: トップの会場カードの日目の札。いちばん幅を取る組み合わせ（札・優勝戦・SG・時間帯の
 * アイコン、英語の「Opening day」）でも、札がカードからはみ出さず、会場名を省略記号で削らず、
 * 横スクロールが出ないこと。全会場を「次のレースあり」に書き換えて全カードで測る
 */
test.describe("レイアウト: トップの会場カードの日目の札（BOA-1199）", () => {
  for (const { path, day, isFinalDay, label, stage } of [
    { path: "/", day: 6, isFinalDay: true, label: "最終日", stage: "優勝戦" },
    {
      path: "/en",
      day: 1,
      isFinalDay: false,
      label: "Opening day",
      stage: "優勝戦",
    },
    {
      path: "/en",
      day: 5,
      isFinalDay: false,
      label: "Day 5",
      stage: "準優勝戦",
    },
  ]) {
    test(`${path} の「${label}」の札がカードに収まる`, async ({ page }) => {
      await rewriteTodayRaces(page, (venues) => {
        for (const v of venues)
          (v.races ?? []).forEach((r, i, races) => {
            r.startTime = "23:59";
            r.seriesDay = day;
            r.isFinalDay = isFinalDay;
            r.cancellationStatus = null;
            r.raceGrade = "SG";
            r.raceStage = i === races.length - 1 ? stage : null;
          });
      });
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(
        page.locator(".venue-grid-card__series-day").first(),
      ).toHaveText(label, { timeout: 30000 });
      const problems = await page.evaluate((tolerance) => {
        const out = [];
        const de = document.documentElement;
        if (de.scrollWidth > de.clientWidth + tolerance)
          out.push({
            scrollWidth: de.scrollWidth,
            clientWidth: de.clientWidth,
          });
        for (const card of document.querySelectorAll(
          ".venue-grid-card--open",
        )) {
          const badge = card.querySelector(".venue-grid-card__series-day");
          if (!badge) continue;
          const c = card.getBoundingClientRect();
          const name = card.querySelector(".venue-grid-card__name");
          // 日目の札と、同じ行に並べた優勝戦・準優勝戦のバッジ（A案）がカードに収まる
          for (const el of card.querySelectorAll(
            ".venue-grid-card__series-day, .venue-grid-card__stage",
          )) {
            const b = el.getBoundingClientRect();
            if (b.right > c.right + tolerance || b.left < c.left - tolerance)
              out.push({ card: card.getAttribute("href"), out: el.className });
            // バッジの中で2行に割れない（英語の「Semifinal 9R」が時間帯のアイコンのある会場で割れた。ファン評価1周目）
            if (b.height > badge.getBoundingClientRect().height + 1)
              out.push({
                card: card.getAttribute("href"),
                split: el.className,
                height: b.height,
              });
          }
          if (name.scrollWidth > name.clientWidth + 1)
            out.push({
              card: card.getAttribute("href"),
              nameClipped: name.textContent,
            });
        }
        return out;
      }, OVERFLOW_TOLERANCE_PX);
      expect(problems, JSON.stringify(problems, null, 2)).toEqual([]);
    });
  }
});
