import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";

// 受け入れE2E（e2e/acceptance/、acceptance-test-writer が spec.md・screens.md から書く）専用の設定。
//
// 本体の playwright.config.js に project として足さないのは次の2点のため。
//   - CI の `npm run test:e2e` は --project 無しで全プロジェクトを走らせるので、
//     足すとPRゲートに入る。ゲートへの組み込みは BOA-466（E2E録画データ化）の後に
//     判断する（.claude/rules/sdd-workflow.md）
//   - check-e2e-skips.js は宣言された全プロジェクトにテストがあることを求めるので、
//     受け入れE2Eが1本も無い状態でCIが落ちる
//
// webServer・baseURL・タイムアウト等は本体をそのまま引き継ぐ。
// 実行: npx playwright test --config=playwright.acceptance.config.js e2e/acceptance/{slug}.spec.js
export default defineConfig({
  ...base,
  testDir: "./e2e/acceptance",
  // sns-x-send.spec.js は専用のテスト用サーバーが要る（playwright.x-send.config.js、
  // npm run test:x-send-ui）。本体のdevサーバーで開くとアプリ本体が表示されて必ず落ちる
  testIgnore: [/sns-x-send\.spec\.js/],
  // 本体の JSON レポート（e2e-results.json、check-e2e-skips.js が読む）を上書きしない
  reporter: [["list"]],
  projects: [{ name: "acceptance" }],
});
