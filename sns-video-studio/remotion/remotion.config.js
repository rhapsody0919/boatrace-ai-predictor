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

  // 同サンドボックスでは全アウトバウンドHTTPSがポリシー適用プロキシで
  // TLS再終端される（/root/.ccr/ca-bundle.crt）。このChromiumインスタンスの
  // NSS証明書ストアにはそのCAがインポートされていないため、
  // @remotion/google-fonts（fonts.jsのNoto Sans JP取得）がERR_CERT_AUTHORITY_INVALIDで
  // 失敗する（2026-09-04判明）。プロキシ自体はポリシーで許可された通信のみを
  // 中継するため、証明書検証のみをこのサンドボックス限定でスキップする。
  Config.setChromiumIgnoreCertificateErrors(true);
}
