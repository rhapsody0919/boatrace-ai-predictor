import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir:'./e2e/acceptance',testMatch:'sns-deadline-queue.spec.js',workers:1,
 use:{baseURL:'http://127.0.0.1:47854',viewport:{width:375,height:812},timezoneId:'America/Los_Angeles'},reporter:'list',
 webServer:{command:`"${process.execPath}" e2e/support/sns-deadline-queue-server.js`,url:'http://127.0.0.1:47854/__queue_test',reuseExistingServer:false},
});
