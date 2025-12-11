// Google Sheets Integration Script
// Updates Google Spreadsheet with daily prediction performance data

import { google } from 'googleapis';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== CONFIGURATION =====
// TODO: ユーザーが以下の設定を行う必要があります

// 1. Google Service Account認証情報のパス
// Google Cloud Consoleで作成したサービスアカウントのJSONキーファイルのパス
const SERVICE_ACCOUNT_KEY_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH ||
  path.join(__dirname, '..', 'credentials', 'google-service-account.json');

// 2. スプレッドシートID
// スプレッドシートのURLから取得: https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID || 'YOUR_SPREADSHEET_ID_HERE';

// 3. シート名
const SHEET_NAME = 'AI予想実績';

// ===== メイン処理 =====

/**
 * Google Sheets APIクライアントを初期化
 */
async function getGoogleSheetsClient() {
  try {
    // サービスアカウントキーファイルを読み込み
    const keyFileContent = await fs.readFile(SERVICE_ACCOUNT_KEY_PATH, 'utf-8');
    const credentials = JSON.parse(keyFileContent);

    // JWT認証を使用してGoogle Sheets APIクライアントを作成
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    return sheets;
  } catch (error) {
    console.error('Google Sheets API初期化エラー:', error.message);
    console.error('\n設定を確認してください:');
    console.error(`1. サービスアカウントキーファイルのパス: ${SERVICE_ACCOUNT_KEY_PATH}`);
    console.error(`2. スプレッドシートID: ${SPREADSHEET_ID}`);
    throw error;
  }
}

/**
 * スプレッドシートにヘッダー行を作成
 */
async function createHeaderRow(sheets) {
  const headers = [
    '日付',
    'レース数',
    '単勝的中率',
    '複勝的中率',
    '3連複的中率',
    '3連単的中率',
    '単勝回収率',
    '複勝回収率',
    '3連複回収率',
    '3連単回収率',
    '単勝投資額',
    '単勝払戻',
    '複勝投資額',
    '複勝払戻',
    '3連複投資額',
    '3連複払戻',
    '3連単投資額',
    '3連単払戻',
    '更新日時'
  ];

  try {
    // ヘッダー行が既に存在するか確認
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:S1`,
    });

    if (!response.data.values || response.data.values.length === 0) {
      // ヘッダー行が存在しない場合は作成
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A1:S1`,
        valueInputOption: 'RAW',
        resource: {
          values: [headers],
        },
      });
      console.log('ヘッダー行を作成しました');
    }
  } catch (error) {
    console.error('ヘッダー行の作成/確認エラー:', error.message);
    throw error;
  }
}

/**
 * サマリーデータをスプレッドシートに追加/更新
 */
async function updateSpreadsheet(sheets, summaryData) {
  try {
    // 現在のデータを取得
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:A`,
    });

    const existingDates = response.data.values ? response.data.values.slice(1).map(row => row[0]) : [];

    // dailyHistoryの各日付のデータを処理
    const rowsToAppend = [];
    const rowsToUpdate = [];

    for (const day of summaryData.dailyHistory) {
      const rowData = [
        day.date,
        day.totalRaces,
        (day.topPickHitRate * 100).toFixed(2) + '%',
        (day.topPickPlaceRate * 100).toFixed(2) + '%',
        (day.top3HitRate * 100).toFixed(2) + '%',
        (day.top3IncludedRate * 100).toFixed(2) + '%',
        day.actualRecovery ? (day.actualRecovery.win.recoveryRate * 100).toFixed(2) + '%' : 'N/A',
        day.actualRecovery ? (day.actualRecovery.place.recoveryRate * 100).toFixed(2) + '%' : 'N/A',
        day.actualRecovery ? (day.actualRecovery.trifecta.recoveryRate * 100).toFixed(2) + '%' : 'N/A',
        day.actualRecovery ? (day.actualRecovery.trio.recoveryRate * 100).toFixed(2) + '%' : 'N/A',
        day.actualRecovery ? day.actualRecovery.win.totalInvestment : 'N/A',
        day.actualRecovery ? day.actualRecovery.win.totalPayout : 'N/A',
        day.actualRecovery ? day.actualRecovery.place.totalInvestment : 'N/A',
        day.actualRecovery ? day.actualRecovery.place.totalPayout : 'N/A',
        day.actualRecovery ? day.actualRecovery.trifecta.totalInvestment : 'N/A',
        day.actualRecovery ? day.actualRecovery.trifecta.totalPayout : 'N/A',
        day.actualRecovery ? day.actualRecovery.trio.totalInvestment : 'N/A',
        day.actualRecovery ? day.actualRecovery.trio.totalPayout : 'N/A',
        new Date().toISOString(),
      ];

      const existingIndex = existingDates.indexOf(day.date);
      if (existingIndex === -1) {
        // 新しい日付の場合は追加
        rowsToAppend.push(rowData);
      } else {
        // 既存の日付の場合は更新
        const rowNumber = existingIndex + 2; // ヘッダー行の次から開始なので+2
        rowsToUpdate.push({ range: `${SHEET_NAME}!A${rowNumber}:S${rowNumber}`, values: [rowData] });
      }
    }

    // 新規行を追加
    if (rowsToAppend.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A:S`,
        valueInputOption: 'RAW',
        resource: {
          values: rowsToAppend,
        },
      });
      console.log(`${rowsToAppend.length}件の新しいデータを追加しました`);
    }

    // 既存行を更新
    if (rowsToUpdate.length > 0) {
      for (const update of rowsToUpdate) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: update.range,
          valueInputOption: 'RAW',
          resource: {
            values: update.values,
          },
        });
      }
      console.log(`${rowsToUpdate.length}件の既存データを更新しました`);
    }

    if (rowsToAppend.length === 0 && rowsToUpdate.length === 0) {
      console.log('更新するデータがありません（すべて最新です）');
    }

  } catch (error) {
    console.error('スプレッドシート更新エラー:', error.message);
    throw error;
  }
}

/**
 * メイン処理
 */
async function main() {
  try {
    console.log('Google Sheets連携スクリプトを開始します...\n');

    // 設定チェック
    if (SPREADSHEET_ID === 'YOUR_SPREADSHEET_ID_HERE') {
      console.error('エラー: GOOGLE_SPREADSHEET_IDが設定されていません');
      console.error('環境変数またはスクリプト内のSPREADSHEET_IDを設定してください');
      process.exit(1);
    }

    // summary.jsonを読み込み
    const summaryPath = path.join(__dirname, '..', 'data', 'predictions', 'summary.json');
    const summaryContent = await fs.readFile(summaryPath, 'utf-8');
    const summaryData = JSON.parse(summaryContent);

    console.log(`summary.jsonを読み込みました (${summaryData.dailyHistory.length}日分のデータ)`);

    // Google Sheets APIクライアントを取得
    const sheets = await getGoogleSheetsClient();
    console.log('Google Sheets APIに接続しました');

    // ヘッダー行を作成/確認
    await createHeaderRow(sheets);

    // データを更新
    await updateSpreadsheet(sheets, summaryData);

    console.log('\n✅ Google Sheetsの更新が完了しました！');
    console.log(`スプレッドシートURL: https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`);

  } catch (error) {
    console.error('\n❌ エラーが発生しました:', error);
    process.exit(1);
  }
}

// スクリプトを実行
main();
