import { defineConfig, devices } from "@playwright/test";

// 配備先（本番の URL）を相手にする読むだけの確かめ（ZB02、BOA-1497）。e2e-release.yml が release の後に回す。
// 本体の playwright.config.js は手元のビルド（localhost・録画の再生）を相手にするので、ここでは引き継がない。
// webServer は置かない（相手は配備済みの本番）。spec は *.release.js で、本体の testMatch（*.spec.js）に当たらない。
// 書き込み・送信・page.route による差し替えはしない（本番を相手にするため。GET と画面の表示だけ）。
// 実行: npx playwright test --config=e2e/release-check/playwright.release.config.js
export default defineConfig({
  testDir: ".",
  testMatch: /\.release\.js$/,
  // 本番の CDN・関数の一時の揺れで赤にしないよう1回だけ取り直す（取り直しで緑なら flaky として報告に残る）
  retries: 1,
  workers: 2,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: process.env.RELEASE_BASE_URL || "https://www.boat-ai.jp",
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
  },
});
