import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./e2e/acceptance',testMatch:'sns-mobile-approval.spec.js',workers:1,
 use:{baseURL:'http://127.0.0.1:47856',viewport:{width:375,height:812}},reporter:'list',
 webServer:{command:`"${process.execPath}" e2e/support/sns-mobile-approval-server.js`,url:'http://127.0.0.1:47856/__mobile_test',reuseExistingServer:false}});
