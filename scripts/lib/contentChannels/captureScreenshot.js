/**
 * ブログ/note/YouTubeサムネイル用のスクリーンショット取得。
 * `npm run dev`で起動済みのローカルサーバーに対し、指定パスを
 * Playwrightで撮影する（Routineサンドボックスでのlocalhost接続は
 * 2026-09-01の技術検証で確認済み、docs/design/content-multi-channel-pipeline/spec.md参照）。
 */

import { chromium } from "@playwright/test";

const DEFAULT_VIEWPORT = { width: 1200, height: 630 };

/**
 * @param {{baseUrl: string, path: string, outputPath: string, viewport?: {width: number, height: number}, waitForTimeout?: number}} opts
 */
export async function captureScreenshot({
  baseUrl,
  path: urlPath,
  outputPath,
  viewport = DEFAULT_VIEWPORT,
  waitForTimeout = 1500,
}) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport });
    await page.goto(`${baseUrl}${urlPath}`, { waitUntil: "networkidle" });
    // グラフ・アニメーション描画完了を待つ（要素セレクタが機能によって
    // 異なるため、固定待機で簡易に対応する）
    await page.waitForTimeout(waitForTimeout);
    await page.screenshot({ path: outputPath });
  } finally {
    await browser.close();
  }
}
