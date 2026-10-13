/**
 * Chromium の起動（ビルド時の AI スナップショット scripts/generate-ai-snapshots.js と、
 * SNS の送る前の表示の確認 api/_lib/snsHeadless.js（sns-pdca-loop tasks 10、ADR 0091）で共用）。
 */
import path from "node:path";

// Vercelのビルドサンドボックスはplaywrightが正式サポートしないLinux環境で、
// `playwright`パッケージがダウンロードするChromiumバイナリはシステム共有
// ライブラリ（libnspr4等）が無く起動時に落ちる（2026-09-15判明、PR#652参照）。
// `@sparticuz/chromium`はサーバーレス環境向けに必要なライブラリを同梱した
// 静的ビルドを提供するため、Vercel上ではそちらを`playwright-core`経由で
// 起動する。ローカル開発機（macOS等）では従来通り`playwright`本体の
// Chromiumを使う（`@sparticuz/chromium`はLinux専用バイナリのため）。
export async function launchChromium() {
  if (process.env.VERCEL) {
    const { chromium: chromiumCore } = await import("playwright-core");
    const sparticuzChromium = (await import("@sparticuz/chromium")).default;
    if (typeof sparticuzChromium.setGraphicsMode === "function") {
      sparticuzChromium.setGraphicsMode(false);
    }
    const executablePath = await sparticuzChromium.executablePath();
    process.env.LD_LIBRARY_PATH = [
      path.dirname(executablePath),
      process.env.LD_LIBRARY_PATH || "",
    ]
      .filter(Boolean)
      .join(":");
    return chromiumCore.launch({
      args: sparticuzChromium.args,
      executablePath,
      headless: true,
    });
  }

  const { chromium: chromiumLocal } = await import("playwright");
  return chromiumLocal.launch();
}
