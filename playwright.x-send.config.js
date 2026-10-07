import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./e2e/acceptance',testMatch:'sns-x-send.spec.js',workers:1,
  use:{baseURL:'http://127.0.0.1:47853',viewport:{width:375,height:812}},
  reporter:'list',
  webServer:{command:`"${process.execPath}" e2e/support/sns-x-send-server.js`,url:'http://127.0.0.1:47853/__x_send_test',reuseExistingServer:false},
});
