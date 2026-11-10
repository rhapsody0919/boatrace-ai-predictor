// 旧 e2e/layout.spec.js から切り出しスクリプトで移した（CI02。題・中身は元のまま、import の相対の字だけ1段深くした）
import { expect } from "../fixtures.js";

/** グリッドの空トラックとみなす最小の余白。gapや端数の誤差を除くための閾値 */
export const TRAILING_GAP_THRESHOLD_PX = 40;

/** 横スクロールの許容誤差（スクロールバー・小数丸めの分） */
export const OVERFLOW_TOLERANCE_PX = 2;

/**
 * ページごとに「データが描画された」とみなす要素。gotoAndSettle はこれが見えるまで待つ。
 *
 * networkidle だけでは足りない。一度 idle に達すると以後の waitForLoadState は待たず、
 * マシンの負荷で goto が遅いと、データの要求を出す前に idle に達して計測に進み、
 * グリッドが0個のまま「崩れ無し」と判定していた（#936 の分析: goto 21.1秒 → idle 15ms →
 * 差し替え完了 25.7秒 → 計測 27.5秒で .digest-grid 0個）。
 * 静的なページ（/about・/faq・/how-to-use・/blog・/en/venues）は、データを待つ必要が無いので載せない。
 * 選んだ要素は 2026-09-29 の録画の再生で、各ページの主データとして描画されるものを実測した
 */
export const READY_SELECTORS = {
  // スケルトン（VenueGridSkeleton）も .venue-grid-card を持つため、実物だけに付く修飾子で待つ（BOA-593）
  "/": ".venue-grid-card--open, .venue-grid-card--closed",
  "/accuracy": ".turn-accuracy-venue-table",
  "/winning-technique": ".winning-technique-table",
  "/winning-technique?tab=motorranking&venue_code=16": ".vmr-table",
  "/races": ".dates-list .date-card",
  "/hit-races": ".race-cards-grid",
  "/racers": ".racer-compact-row, .racer-table",
  "/today": ".digest-grid",
  "/races/2026-08-11": ".venue-grid-card--open",
  "/race/2026-09-21-02-05": ".rbit-bar-row",
  "/racer/4320": ".racer-stat-cards-grid",
  "/venue/16/meet/2026-09-28": ".meet-ranking__table tbody tr",
  "/race/2026-10-06-18-10/assist": ".ta-lane",
};

export async function gotoAndSettle(page, path) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".app-header")).toBeVisible();
  const ready = READY_SELECTORS[path];
  if (ready) {
    // 表示の有無ではなく DOM に入ったかで見る（折りたたみ・幅ごとの出し分けで
    // 非表示になっている要素でも、データが届いたことは分かる）
    await expect(
      page.locator(ready).first(),
      `${path} の主データ（${ready}）が描画されていません`,
    ).toBeAttached({ timeout: 30000 });
  }
  // 主データの後に届く付随データ（バッジ・件数）も待つ。通信が終わらないページもあるため
  // タイムアウトは許容する（主データは上で確認済み）
  await page
    .waitForLoadState("networkidle", { timeout: 15000 })
    .catch((error) => {
      if (error.name !== "TimeoutError") throw error;
    });
}

/**
 * 開いているページの全グリッドを見て「箱の幅に対して中身が足りていない」ものを返す。
 *
 * 2種類の無駄を見る。どちらも「箱の幅に対して中身が足りていない」という
 * 構造的な事実で、見た目の好みの判定ではない。
 *
 *   (a) 空トラック: 幅を持つ列の数 > 実アイテム数。
 *       repeat(auto-fill, ...) はアイテムが足りなくても列の枠を作るため、
 *       カード3枚に対して5列分の枠ができて右に空白が残る。
 *       repeat(3, ...) のような固定列数でも、アイテムが列数を下回れば同じことが
 *       起きる（BOA-460）。
 *
 *   (b) 使い残し（slack）: グリッドの箱の幅 −（トラック合計 + gap合計）。
 *       トラックの上限を固定pxにすると列数の刻みが粗くなり、
 *       「列は余っていないのに箱の中に大きな空きが残る」状態になる。
 *       (a)だけでは検知できない（列数 ≤ アイテム数なら素通りするため）。
 */
export async function inspectGrids(page) {
  return page.evaluate((threshold) => {
    const found = [];
    let gridsChecked = 0;

    for (const el of document.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      if (cs.display !== "grid" && cs.display !== "inline-grid") continue;

      // レイアウトされていない要素では gridTemplateColumns が解決前の
      // 指定値（"repeat(auto-fit, minmax(280px, 1fr))" 等）のまま返る。
      // px値に解決されているものだけを対象にする
      const raw = cs.gridTemplateColumns.split(" ").filter(Boolean);
      if (raw.some((t) => !/^-?[\d.]+px$/.test(t))) continue;

      // repeat(auto-fit, ...) が潰したトラックは 0px として残るが、
      // 場所を取らないので列としては数えない
      const tracks = raw.map(parseFloat).filter((n) => n > 0);
      if (tracks.length < 2) continue;

      const items = [...el.children].filter((c) => {
        const r = c.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (items.length === 0) continue;

      gridsChecked += 1;

      const gridRect = el.getBoundingClientRect();
      const gap = parseFloat(cs.columnGap) || 0;
      const used =
        tracks.reduce((a, b) => a + b, 0) + gap * (tracks.length - 1);
      const slack = Math.round(gridRect.width - used);
      const emptyTracks = tracks.length - items.length;

      const cls = (typeof el.className === "string" ? el.className : "").slice(
        0,
        60,
      );
      const base = {
        cls,
        columns: tracks.length,
        items: items.length,
        gridWidth: Math.round(gridRect.width),
      };

      if (emptyTracks > 0) {
        const lastRight = Math.max(
          ...items.map((c) => c.getBoundingClientRect().right),
        );
        const trailingGap = Math.round(gridRect.right - lastRight);
        if (trailingGap >= threshold) {
          found.push({ ...base, kind: "空トラック", trailingGap });
          continue;
        }
      }

      if (slack >= threshold) {
        found.push({ ...base, kind: "使い残し", slack });
      }
    }
    return { found, gridsChecked };
  }, TRAILING_GAP_THRESHOLD_PX);
}

export function expectNoWastedGrids(result) {
  expect(
    result.found,
    `グリッドの箱の幅に対して中身が足りていません` +
      `（このページで検査したグリッド: ${result.gridsChecked}個）。\n` +
      `「空トラック」なら、アイテム数より多い列を作らない\n` +
      `（repeat(auto-fill, ...) は auto-fit に。固定列数 repeat(N, ...) は、\n` +
      `列数の上限を保ったまま余った列を潰す形にする。実例:\n` +
      `src/components/digest/DigestCardGrid.css の\n` +
      `repeat(auto-fit, minmax(calc((100% - gap * (N-1)) / N), 1fr))）、\n` +
      `「使い残し」ならトラックの上限を固定pxで抑えるのをやめて\n` +
      `minmax(..., 1fr) に戻し、箱の幅は max-width で絞ってください:\n` +
      JSON.stringify(result.found, null, 2),
  ).toEqual([]);
}
