import { Config } from "@remotion/cli/config";
import fs from "fs";

// Claude Code Routineのサンドボックス環境では remotion.media への
// アウトバウンドアクセスがブロックされ、Remotion付属Chromiumの自動
// ダウンロードが失敗する（2026-09-03判明）。Playwright用に別途配布済みの
// Chromium Headless Shellが同じ実行環境に存在する場合はそれを再利用する。
// ローカル開発機・本番CIにはこのパスが存在しないため、通常の自動ダウンロード
// 挙動に影響しない。
const sandboxHeadlessShell =
  "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
if (fs.existsSync(sandboxHeadlessShell)) {
  Config.setBrowserExecutable(sandboxHeadlessShell);
  // サンドボックス環境のアウトバウンドHTTPSはTLS再終端プロキシ（agent proxy）を
  // 経由するため、Google Fonts（fonts.js、2026-09-04追加）取得時にヘッドレス
  // Chromiumがプロキシ側CAを信頼できずERR_CERT_AUTHORITY_INVALIDで失敗する
  // （2026-09-04判明）。ローカル開発機・本番CIにはこの経路が存在しないため、
  // sandboxHeadlessShell検出時のみ緩和する
  Config.setChromiumIgnoreCertificateErrors(true);
}
