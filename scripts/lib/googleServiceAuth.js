/**
 * Googleサービスアカウント認証の共通ヘルパー（BOA-139）
 *
 * GA4 Data API・Search Console API等、複数のGoogle API連携スクリプトで
 * サービスアカウント（credentials/google-service-account.json）を共用するための認証ロジック。
 * 呼び出し側スクリプトで dotenv.config() 済みであることを前提とする。
 */

import fs from "fs";
import { google } from "googleapis";

/**
 * 指定スコープのGoogle JWT認証クライアントを生成する
 *
 * @param {string[]} scopes - 例: ['https://www.googleapis.com/auth/analytics.readonly']
 * @returns {import('googleapis').Auth.JWT}
 */
export function getGoogleAuthClient(scopes) {
  const keyPath =
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH ||
    "./credentials/google-service-account.json";

  if (!fs.existsSync(keyPath)) {
    console.error(`❌ サービスアカウントのキーファイルが見つかりません: ${keyPath}

Google Sheets 連携と同じ credentials/google-service-account.json を配置するか、
GOOGLE_SERVICE_ACCOUNT_KEY_PATH でパスを指定してください。`);
    process.exit(1);
  }

  const credentials = JSON.parse(fs.readFileSync(keyPath, "utf-8"));

  return new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes,
  });
}
