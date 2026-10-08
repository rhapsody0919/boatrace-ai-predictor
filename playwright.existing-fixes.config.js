import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e/acceptance', testMatch: 'sns-existing-fixes.spec.js', workers: 1,
  use: { baseURL: 'http://127.0.0.1:47854', viewport: { width: 375, height: 812 } },
  reporter: 'list',
  webServer: { command: `"${process.execPath}" e2e/support/sns-existing-fixes-server.js`,
    url: 'http://127.0.0.1:47854/__existing_fixes_test', reuseExistingServer: false },
});
