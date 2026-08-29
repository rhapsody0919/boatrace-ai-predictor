import { defineConfig } from "@playwright/test";

// PW_PORT: 並行セッション（worktree等）で既定の5173が他のdevサーバーに
// 使われている場合、別ポートで起動済みのサーバーに向けてテストを実行するための
// 上書き。reuseExistingServerのため、5173が「別コードベースのサーバー」だと
// 気づかずそちらへテストが走る事故が起きた（2026-08-29、venue-list-redesign）
const port = process.env.PW_PORT || "5173";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
