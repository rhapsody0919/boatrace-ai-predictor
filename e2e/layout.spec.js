import { test, expect } from "@playwright/test";

/**
 * 画面幅ごとのレイアウト崩れを機械的に検知する。
 *
 * 背景: 2026-09-25時点でE2Eはすべて既定ビューポート（1280x720）だけで走っており、
 * モバイル幅も広いPC幅も一度も検証されていなかった（setViewportSize・devices[]・
 * config の viewport の使用がいずれも0件）。モバイルファーストのPWAを標榜しながら
 * 主戦場が未検証で、実際にトップページのブログ一覧が1440px以上で右側に
 * 大きく空白を作る状態が放置されていた。
 *
 * このファイルだけ playwright.config.js の layout-* プロジェクトで
 * 375 / 768 / 1024 / 1440 / 1920px を横断して実行する
 * （既存の smoke.spec.js は従来どおり既定ビューポートで1回だけ）。
 * 幅は「メディアクエリの境界」と「レイアウトが切り替わる帯の中」の両方を通す。
 * 375/1440/1920 の3軸だけにしていたとき、769〜1255px の帯で列が落ちる崩れを
 * まるごと見逃した（ADR-0073）。
 *
 * 検知するもの:
 *   1. 横スクロールの発生（要素が画面幅を超えている）
 *   2. グリッドの空トラック（幅を持つ列の数 > 実アイテム数。右側に空白が残る）
 *   3. グリッドの使い残し（箱の幅 −（トラック合計 + gap合計）が大きい。
 *      トラックの上限を固定pxで抑えると列数の刻みが粗くなり、列は余っていないのに
 *      箱の中に空きが残る。2 だけでは素通りする）
 *
 * 「見た目が美しいか」は判定しない。どれも「箱の幅に対して中身が足りていない」
 * という構造的な事実で、閾値のチューニングなしに判定できるものだけを対象にする。
 */

const PAGES = [
  "/",
  "/about",
  "/accuracy",
  "/winning-technique",
  "/races",
  "/hit-races",
  "/blog",
  "/faq",
  "/how-to-use",
  "/racers",
  // 会場ガイド一覧は en / zh-TW / ko のみ（config/languages.js の
  // LANGUAGE_ONLY_PATHS）。ja の "/venues" はルートが無く "/" へ
  // リダイレクトされるため、実在する "/en/venues" を見る
  "/en/venues",
  "/today",
  // 横長のテーブル（出走表・全艇比較）を持つ導線は、モバイルで横あふれを
  // 起こすリスクが最も高い。日付は smoke.spec.js と同じ実データを使う
  "/races/2026-08-11",
  "/race/2026-09-21-02-05",
  "/racer/4320",
];

/** グリッドの空トラックとみなす最小の余白。gapや端数の誤差を除くための閾値 */
const TRAILING_GAP_THRESHOLD_PX = 40;

/** 横スクロールの許容誤差（スクロールバー・小数丸めの分） */
const OVERFLOW_TOLERANCE_PX = 2;

async function gotoAndSettle(page, path) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  // Supabase由来のカード・バッジが描画される前に測ると、アイテム数が0のまま
  // 判定してしまう。通信が終わらないページもあるためタイムアウトは許容する
  await page
    .waitForLoadState("networkidle", { timeout: 15000 })
    .catch((error) => {
      if (error.name !== "TimeoutError") throw error;
    });
  await expect(page.locator(".app-header")).toBeVisible();
}

test.describe("レイアウト: 横スクロールが発生しない", () => {
  for (const path of PAGES) {
    test(`${path} で横スクロールが出ない`, async ({ page }) => {
      await gotoAndSettle(page, path);

      const overflow = await page.evaluate((tolerance) => {
        const de = document.documentElement;
        if (de.scrollWidth <= de.clientWidth + tolerance) return null;

        // はみ出している要素を特定して、原因が分かる形で報告する
        const culprits = [];
        for (const el of document.querySelectorAll("body *")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > de.clientWidth + tolerance) {
            culprits.push({
              tag: el.tagName.toLowerCase(),
              cls: (typeof el.className === "string" ? el.className : "").slice(
                0,
                60,
              ),
              right: Math.round(r.right),
              width: Math.round(r.width),
            });
          }
        }
        return {
          scrollWidth: de.scrollWidth,
          clientWidth: de.clientWidth,
          culprits: culprits.slice(0, 8),
        };
      }, OVERFLOW_TOLERANCE_PX);

      expect(overflow, JSON.stringify(overflow, null, 2)).toBeNull();
    });
  }
});

test.describe("レイアウト: グリッドの幅が無駄になっていない", () => {
  // 2種類の無駄を見る。どちらも「箱の幅に対して中身が足りていない」という
  // 構造的な事実で、見た目の好みの判定ではない。
  //
  //   (a) 空トラック: 幅を持つ列の数 > 実アイテム数。
  //       repeat(auto-fill, ...) はアイテムが足りなくても列の枠を作るため、
  //       カード3枚に対して5列分の枠ができて右に空白が残る。
  //
  //   (b) 使い残し（slack）: グリッドの箱の幅 −（トラック合計 + gap合計）。
  //       トラックの上限を固定pxにすると列数の刻みが粗くなり、
  //       「列は余っていないのに箱の中に大きな空きが残る」状態になる。
  //       (a)だけでは検知できない（列数 ≤ アイテム数なら素通りするため）。
  for (const path of PAGES) {
    test(`${path} のグリッドに使われていない幅が無い`, async ({ page }) => {
      await gotoAndSettle(page, path);

      const result = await page.evaluate((threshold) => {
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

          const cls = (
            typeof el.className === "string" ? el.className : ""
          ).slice(0, 60);
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

      expect(
        result.found,
        `グリッドの箱の幅に対して中身が足りていません` +
          `（このページで検査したグリッド: ${result.gridsChecked}個）。\n` +
          `「空トラック」なら repeat(auto-fill, ...) を auto-fit にする、\n` +
          `「使い残し」ならトラックの上限を固定pxで抑えるのをやめて\n` +
          `minmax(..., 1fr) に戻し、箱の幅は max-width で絞ってください:\n` +
          JSON.stringify(result.found, null, 2),
      ).toEqual([]);
    });
  }
});
