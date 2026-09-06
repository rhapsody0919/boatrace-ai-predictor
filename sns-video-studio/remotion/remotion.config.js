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
  // 同環境のプロキシCA（/root/.ccr/ca-bundle.crt）をヘッドレスシェルは信頼しないため、
  // fonts.gstatic.com等へのフォント取得がERR_CERT_AUTHORITY_INVALIDで失敗する
  // （2026-09-04判明）。同じサンドボックス判定の範囲でのみ証明書検証を無効化する。
  Config.setChromiumIgnoreCertificateErrors(true);
}
