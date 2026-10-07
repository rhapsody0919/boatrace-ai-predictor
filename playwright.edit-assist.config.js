import { defineConfig } from '@playwright/test';
import mobile from './playwright.mobile-approval.config.js';
export default defineConfig({...mobile,testMatch:'sns-edit-assist.spec.js'});
