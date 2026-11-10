// 旧 e2e/layout.spec.js から切り出しスクリプトで移した（CI02。題・中身は元のまま、import の相対の字だけ1段深くした）
import { test, expect } from "../fixtures.js";
import {
  OVERFLOW_TOLERANCE_PX,
  gotoAndSettle,
  inspectGrids,
  expectNoWastedGrids,
} from "./helpers.js";

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
  // 会場モーターランキング（BOA-428）: 約60行×7列の表。表の中だけ横スクロールさせる
  "/winning-technique?tab=motorranking&venue_code=16",
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
  // 節ページ（BOA-682）。52行の得点率ランキングと勝ち上がりの2カラム
  "/venue/16/meet/2026-09-28",
  // 思考アシスト（BOA-430）。案②レーン（艇×横軸）と固定フッター
  "/race/2026-10-06-18-10/assist",
];

/** 記事のページ（/blog・/blog/{id}）とホーム（最新記事のカードを出す）を開く試験の題に付ける印。記事だけの PR の軽い組で走らせる（BOA-929） */
const blogTag = (path) =>
  /^\/(blog(\/|$)|((en|ko|zh-TW)\/?)?$)/.test(path) ? " @blog" : "";

test.describe("レイアウト: 横スクロールが発生しない", () => {
  for (const path of PAGES) {
    test(`${path} で横スクロールが出ない${blogTag(path)}`, async ({ page }) => {
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
  for (const path of PAGES) {
    test(`${path} のグリッドに使われていない幅が無い${blogTag(path)}`, async ({
      page,
    }) => {
      await gotoAndSettle(page, path);
      expectNoWastedGrids(await inspectGrids(page));
    });
  }
});
