import { defineConfig } from "@playwright/test";
import { createHash } from "node:crypto";

// このマシンでは複数のgit worktreeが並行してdevサーバーを起動する運用のため、
// 既定ポート5173を全worktreeで共有すると、reuseExistingServer:true経由で
// 「別worktreeの（時に.env.local未配置でSupabase未接続の壊れた）サーバー」に
// 誤接続し、Supabase依存の全テストがデータ空("データが見つかりません")で
// 一貫して失敗する事故が繰り返し発生した（2026-08-29 / 2026-09-16再発）。
// PW_PORT未指定時はworktreeの絶対パスから決定的にポートを算出し、
// worktreeごとに自然に分散させる。
function derivePortFromCwd() {
  const hash = createHash("sha256").update(process.cwd()).digest();
  return 40000 + (hash.readUInt16BE(0) % 10000);
}

const explicitPort = process.env.PW_PORT;
const port = explicitPort || String(derivePortFromCwd());

export default defineConfig({
  testDir: "./e2e",
  // 本番Supabaseに直接接続するため、DB応答の揺らぎで読み込み待ちが伸びる。
  // 既定の5秒expect・30秒テストではDBが少し遅いだけで大量に失敗するため余裕を持たせる
  timeout: 60000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    // PW_PORTを明示指定した場合のみ既存サーバーの再利用を許可する
    // （開発者が意図的に指定した前提）。無指定時は上記の自動導出ポートで
    // 必ず新規起動し、他worktreeのサーバーへの誤接続を構造的に防ぐ。
    // ポートが衝突した場合は--strictPortにより起動失敗という分かりやすい
    // エラーになる（サイレントな誤接続よりはるかに気づきやすい）。
    reuseExistingServer: Boolean(explicitPort) && !process.env.CI,
    timeout: 30000,
  },
});
