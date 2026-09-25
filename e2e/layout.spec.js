import { test, expect } from "@playwright/test";

/**
 * 画面幅ごとのレイアウト崩れを機械的に検知する。
 *
 * 背景: 2026-09-25時点でE2Eの87テストはすべて既定ビューポート（1280x720）だけで
 * 走っており、モバイル幅も広いPC幅も一度も検証されていなかった。モバイルファーストの
 * PWAを標榜しながら主戦場が未検証で、実際にトップページのブログ一覧が
 * 1440px以上で右側に大きく空白を作る状態が放置されていた。
 *
 * このファイルだけ playwright.config.js の layout-* プロジェクトで
 * 複数の幅を横断して実行する（既存の smoke.spec.js は従来どおり1回だけ）。
 *
 * 検知するもの:
 *   1. 横スクロールの発生（要素が画面幅を超えている）
 *   2. グリッドの空トラック（生成された列数 > 実アイテム数。右側に空白ができる）
 *
 * 「見た目が美しいか」は判定しない。人が見て気づける崩れのうち、
 * 機械的に判定できるものだけを対象にする。
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
  "/venues",
  "/today",
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

test.describe("レイアウト: グリッドに空のトラックができていない", () => {
  // grid-template-columns に repeat(auto-fill, ...) を使うと、アイテムが足りなくても
  // 列の枠が作られる。カード3枚に対して5列分の枠ができると、右側に空白が残って
  // 中央寄せの見出し・ボタンと揃わなくなる。auto-fit なら空トラックは潰れる。
  for (const path of PAGES) {
    test(`${path} のグリッドに空トラックが無い`, async ({ page }) => {
      await gotoAndSettle(page, path);

      const offenders = await page.evaluate((threshold) => {
        const found = [];
        for (const el of document.querySelectorAll("*")) {
          const cs = getComputedStyle(el);
          if (cs.display !== "grid" && cs.display !== "inline-grid") continue;

          // repeat(auto-fit, ...) が潰したトラックは 0px として
          // gridTemplateColumns に残るが、場所を取らないので実害は無い。
          // 実際に幅を持つトラックだけを数える
          const tracks = cs.gridTemplateColumns
            .split(" ")
            .filter(Boolean)
            .filter((t) => parseFloat(t) > 0);
          if (tracks.length < 2) continue;

          const items = [...el.children].filter((c) => {
            const r = c.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
          if (items.length === 0) continue;
          if (tracks.length <= items.length) continue;

          const gridRect = el.getBoundingClientRect();
          const lastRight = Math.max(
            ...items.map((c) => c.getBoundingClientRect().right),
          );
          const trailingGap = Math.round(gridRect.right - lastRight);
          if (trailingGap < threshold) continue;

          found.push({
            cls: (typeof el.className === "string" ? el.className : "").slice(
              0,
              60,
            ),
            columns: tracks.length,
            items: items.length,
            gridWidth: Math.round(gridRect.width),
            trailingGap,
          });
        }
        return found;
      }, TRAILING_GAP_THRESHOLD_PX);

      expect(
        offenders,
        `グリッドの列数がアイテム数を上回り、右側に空白ができています。` +
          `repeat(auto-fill, ...) を auto-fit に変えるか、列数を固定してください:\n` +
          JSON.stringify(offenders, null, 2),
      ).toEqual([]);
    });
  }
});
