/**
 * Chromium の起動（ビルド時の AI スナップショット scripts/generate-ai-snapshots.js と、
 * SNS の送る前の表示の確認 api/_lib/snsHeadless.js（sns-pdca-loop tasks 10、ADR 0091）で共用）。
 */
import path from "node:path";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";

// @sparticuz/chromium が持つフォントは Open Sans だけで、日本語が描かれない（2026-10-16、/today の X 投稿の画像で
// 見出し・会場名・選手名が空白になった）。同梱の Noto Sans JP（SIL OFL、scripts/lib/fonts/）を、Chromium の起動の前に
// fontconfig が読む /tmp/fonts（fonts.conf の <dir>）に置く。関数には vercel.json の includeFiles で同梱する
export const JAPANESE_FONT = new URL(
  "./fonts/NotoSansJP-wght.ttf",
  import.meta.url,
);

/** 日本語フォントを fontconfig の読む場所へ置く（置いてあれば何もしない）。返り値は置いた先 */
export async function installJapaneseFont(dir = path.join(tmpdir(), "fonts")) {
  const target = path.join(dir, "NotoSansJP-wght.ttf");
  const exists = await stat(target).then(
    (s) => s.size > 0,
    () => false,
  );
  if (!exists) {
    await mkdir(dir, { recursive: true });
    await copyFile(JAPANESE_FONT, target);
  }
  return target;
}

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
    // executablePath() が /tmp/fonts に fonts.conf と既定のフォントを展開した後に置く。先に /tmp/fonts を作ると、
    // @sparticuz/chromium は展開済みとみなして fonts.conf を置かない（lambdafs.js の existsSync）
    await installJapaneseFont();
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
