// Email Notification Script
// Sends daily summary email with AI prediction performance data using SendGrid

import sgMail from '@sendgrid/mail';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== CONFIGURATION =====
// TODO: ユーザーが以下の設定を行う必要があります

// 1. SendGrid API Key
// SendGridアカウントで作成したAPI Keyを設定
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || 'YOUR_SENDGRID_API_KEY_HERE';

// 2. 送信元メールアドレス（SendGridで認証済みのアドレス）
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@yourdomain.com';

// 3. 送信先メールアドレス
const TO_EMAIL = process.env.TO_EMAIL || 'rapsody919@gmail.com';

// 4. 通知条件
const NOTIFICATION_THRESHOLDS = {
  // 回収率がこの値以上の場合は特別に通知
  highRecoveryRate: 1.5, // 150%以上
  // 3連単的中があった場合は特別に通知
  trioHitNotification: true,
};

// ===== メイン処理 =====

/**
 * SendGridを初期化
 */
function initializeSendGrid() {
  if (SENDGRID_API_KEY === 'YOUR_SENDGRID_API_KEY_HERE') {
    console.error('エラー: SENDGRID_API_KEYが設定されていません');
    console.error('環境変数またはスクリプト内のSENDGRID_API_KEYを設定してください');
    process.exit(1);
  }

  sgMail.setApiKey(SENDGRID_API_KEY);
  console.log('SendGridを初期化しました');
}

/**
 * HTMLメール本文を生成
 */
function generateEmailHTML(yesterdayData, overallData) {
  const date = yesterdayData.date;
  const races = yesterdayData.totalRaces;

  // 的中率のスタイル
  const getHitRateStyle = (rate) => {
    if (rate >= 0.3) return 'color: #10b981; font-weight: bold;';
    if (rate >= 0.2) return 'color: #3b82f6; font-weight: bold;';
    return 'color: #64748b;';
  };

  // 回収率のスタイル
  const getRecoveryStyle = (rate) => {
    if (rate >= 1.5) return 'color: #10b981; font-weight: bold; font-size: 1.1em;';
    if (rate >= 1.0) return 'color: #10b981; font-weight: bold;';
    if (rate >= 0.9) return 'color: #f59e0b; font-weight: bold;';
    return 'color: #ef4444; font-weight: bold;';
  };

  // ハイライト判定
  const hasHighRecovery = Object.values(yesterdayData.actualRecovery || {}).some(
    bet => bet.recoveryRate >= NOTIFICATION_THRESHOLDS.highRecoveryRate
  );
  const hasTrioHit = yesterdayData.top3IncludedRate > 0;

  let highlights = '';
  if (hasHighRecovery || hasTrioHit) {
    highlights = '<div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 1rem; margin-bottom: 1.5rem;">';
    highlights += '<h3 style="margin: 0 0 0.5rem 0; color: #92400e;">🎯 注目ポイント</h3>';
    if (hasHighRecovery) {
      highlights += '<p style="margin: 0.25rem 0;">✨ 回収率150%超えの券種があります！</p>';
    }
    if (hasTrioHit) {
      highlights += `<p style="margin: 0.25rem 0;">🎊 3連単的中 ${Math.round(yesterdayData.top3IncludedRate * 100)}% (${Math.round(yesterdayData.top3IncludedRate * races)}件的中)</p>`;
    }
    highlights += '</div>';
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI予想実績レポート - ${date}</title>
</head>
<body style="font-family: 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1e293b; margin: 0; padding: 0; background-color: #f1f5f9;">
  <div style="max-width: 600px; margin: 0 auto; padding: 2rem 1rem;">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: white; padding: 2rem; border-radius: 12px 12px 0 0; text-align: center;">
      <h1 style="margin: 0; font-size: 1.75rem;">📊 AI予想実績レポート</h1>
      <p style="margin: 0.5rem 0 0 0; font-size: 1.25rem; opacity: 0.95;">${date}</p>
    </div>

    <!-- Body -->
    <div style="background: white; padding: 2rem; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">

      ${highlights}

      <!-- 前日の実績 -->
      <div style="margin-bottom: 2rem;">
        <h2 style="color: #0f172a; margin: 0 0 1rem 0; padding-bottom: 0.5rem; border-bottom: 2px solid #e2e8f0;">
          前日の実績
        </h2>
        <p style="color: #64748b; margin-bottom: 1rem;">レース数: <strong>${races}レース</strong></p>

        <!-- 的中率テーブル -->
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 1.5rem;">
          <thead>
            <tr style="background: #f8fafc; border-bottom: 2px solid #cbd5e1;">
              <th style="padding: 0.75rem; text-align: left; color: #475569; font-weight: 600;">券種</th>
              <th style="padding: 0.75rem; text-align: center; color: #475569; font-weight: 600;">的中率</th>
              <th style="padding: 0.75rem; text-align: center; color: #475569; font-weight: 600;">回収率</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 0.75rem;">単勝</td>
              <td style="padding: 0.75rem; text-align: center; ${getHitRateStyle(yesterdayData.topPickHitRate)}">
                ${(yesterdayData.topPickHitRate * 100).toFixed(1)}%
              </td>
              <td style="padding: 0.75rem; text-align: center; ${getRecoveryStyle(yesterdayData.actualRecovery.win.recoveryRate)}">
                ${(yesterdayData.actualRecovery.win.recoveryRate * 100).toFixed(1)}%
              </td>
            </tr>
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 0.75rem;">複勝</td>
              <td style="padding: 0.75rem; text-align: center; ${getHitRateStyle(yesterdayData.topPickPlaceRate)}">
                ${(yesterdayData.topPickPlaceRate * 100).toFixed(1)}%
              </td>
              <td style="padding: 0.75rem; text-align: center; ${getRecoveryStyle(yesterdayData.actualRecovery.place.recoveryRate)}">
                ${(yesterdayData.actualRecovery.place.recoveryRate * 100).toFixed(1)}%
              </td>
            </tr>
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 0.75rem;">3連複</td>
              <td style="padding: 0.75rem; text-align: center; ${getHitRateStyle(yesterdayData.top3HitRate)}">
                ${(yesterdayData.top3HitRate * 100).toFixed(1)}%
              </td>
              <td style="padding: 0.75rem; text-align: center; ${getRecoveryStyle(yesterdayData.actualRecovery.trifecta.recoveryRate)}">
                ${(yesterdayData.actualRecovery.trifecta.recoveryRate * 100).toFixed(1)}%
              </td>
            </tr>
            <tr>
              <td style="padding: 0.75rem;">3連単</td>
              <td style="padding: 0.75rem; text-align: center; ${getHitRateStyle(yesterdayData.top3IncludedRate)}">
                ${(yesterdayData.top3IncludedRate * 100).toFixed(1)}%
              </td>
              <td style="padding: 0.75rem; text-align: center; ${getRecoveryStyle(yesterdayData.actualRecovery.trio.recoveryRate)}">
                ${(yesterdayData.actualRecovery.trio.recoveryRate * 100).toFixed(1)}%
              </td>
            </tr>
          </tbody>
        </table>

        <!-- 投資額と払戻 -->
        <div style="background: #f8fafc; padding: 1rem; border-radius: 8px; margin-top: 1rem;">
          <h3 style="margin: 0 0 0.5rem 0; color: #475569; font-size: 0.95rem;">投資額と払戻金額</h3>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; font-size: 0.9rem;">
            <div>単勝投資: ¥${yesterdayData.actualRecovery.win.totalInvestment.toLocaleString()}</div>
            <div>単勝払戻: ¥${yesterdayData.actualRecovery.win.totalPayout.toLocaleString()}</div>
            <div>複勝投資: ¥${yesterdayData.actualRecovery.place.totalInvestment.toLocaleString()}</div>
            <div>複勝払戻: ¥${yesterdayData.actualRecovery.place.totalPayout.toLocaleString()}</div>
            <div>3連複投資: ¥${yesterdayData.actualRecovery.trifecta.totalInvestment.toLocaleString()}</div>
            <div>3連複払戻: ¥${yesterdayData.actualRecovery.trifecta.totalPayout.toLocaleString()}</div>
            <div>3連単投資: ¥${yesterdayData.actualRecovery.trio.totalInvestment.toLocaleString()}</div>
            <div>3連単払戻: ¥${yesterdayData.actualRecovery.trio.totalPayout.toLocaleString()}</div>
          </div>
        </div>
      </div>

      <!-- 累計実績 -->
      <div style="margin-bottom: 2rem;">
        <h2 style="color: #0f172a; margin: 0 0 1rem 0; padding-bottom: 0.5rem; border-bottom: 2px solid #e2e8f0;">
          累計実績
        </h2>
        <p style="color: #64748b; margin-bottom: 1rem;">総レース数: <strong>${overallData.totalRaces}レース</strong></p>

        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background: #f8fafc; border-bottom: 2px solid #cbd5e1;">
              <th style="padding: 0.75rem; text-align: left; color: #475569; font-weight: 600;">券種</th>
              <th style="padding: 0.75rem; text-align: center; color: #475569; font-weight: 600;">的中率</th>
              <th style="padding: 0.75rem; text-align: center; color: #475569; font-weight: 600;">回収率</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 0.75rem;">単勝</td>
              <td style="padding: 0.75rem; text-align: center;">${(overallData.topPickHitRate * 100).toFixed(1)}%</td>
              <td style="padding: 0.75rem; text-align: center; ${getRecoveryStyle(overallData.actualRecovery.win.recoveryRate)}">
                ${(overallData.actualRecovery.win.recoveryRate * 100).toFixed(1)}%
              </td>
            </tr>
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 0.75rem;">複勝</td>
              <td style="padding: 0.75rem; text-align: center;">${(overallData.topPickPlaceRate * 100).toFixed(1)}%</td>
              <td style="padding: 0.75rem; text-align: center; ${getRecoveryStyle(overallData.actualRecovery.place.recoveryRate)}">
                ${(overallData.actualRecovery.place.recoveryRate * 100).toFixed(1)}%
              </td>
            </tr>
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 0.75rem;">3連複</td>
              <td style="padding: 0.75rem; text-align: center;">${(overallData.top3HitRate * 100).toFixed(1)}%</td>
              <td style="padding: 0.75rem; text-align: center; ${getRecoveryStyle(overallData.actualRecovery.trifecta.recoveryRate)}">
                ${(overallData.actualRecovery.trifecta.recoveryRate * 100).toFixed(1)}%
              </td>
            </tr>
            <tr>
              <td style="padding: 0.75rem;">3連単</td>
              <td style="padding: 0.75rem; text-align: center;">${(overallData.top3IncludedRate * 100).toFixed(1)}%</td>
              <td style="padding: 0.75rem; text-align: center; ${getRecoveryStyle(overallData.actualRecovery.trio.recoveryRate)}">
                ${(overallData.actualRecovery.trio.recoveryRate * 100).toFixed(1)}%
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Footer -->
      <div style="text-align: center; padding-top: 1.5rem; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 0.9rem;">
        <p style="margin: 0;">詳細は<a href="https://rhapsody0919.github.io/boatrace-ai-predictor/#accuracy" style="color: #3b82f6; text-decoration: none;">Webサイト</a>でご確認いただけます</p>
        <p style="margin: 0.5rem 0 0 0; font-size: 0.85rem;">🤖 Boatrace AI Predictor</p>
      </div>
    </div>
  </div>
</body>
</html>
  `;

  return html;
}

/**
 * プレーンテキストメール本文を生成
 */
function generateEmailText(yesterdayData, overallData) {
  const date = yesterdayData.date;
  const races = yesterdayData.totalRaces;

  return `
AI予想実績レポート - ${date}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
前日の実績
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

レース数: ${races}レース

【的中率と回収率】
単勝:   的中率 ${(yesterdayData.topPickHitRate * 100).toFixed(1)}% | 回収率 ${(yesterdayData.actualRecovery.win.recoveryRate * 100).toFixed(1)}%
複勝:   的中率 ${(yesterdayData.topPickPlaceRate * 100).toFixed(1)}% | 回収率 ${(yesterdayData.actualRecovery.place.recoveryRate * 100).toFixed(1)}%
3連複: 的中率 ${(yesterdayData.top3HitRate * 100).toFixed(1)}% | 回収率 ${(yesterdayData.actualRecovery.trifecta.recoveryRate * 100).toFixed(1)}%
3連単: 的中率 ${(yesterdayData.top3IncludedRate * 100).toFixed(1)}% | 回収率 ${(yesterdayData.actualRecovery.trio.recoveryRate * 100).toFixed(1)}%

【投資額と払戻】
単勝:   投資 ¥${yesterdayData.actualRecovery.win.totalInvestment.toLocaleString()} → 払戻 ¥${yesterdayData.actualRecovery.win.totalPayout.toLocaleString()}
複勝:   投資 ¥${yesterdayData.actualRecovery.place.totalInvestment.toLocaleString()} → 払戻 ¥${yesterdayData.actualRecovery.place.totalPayout.toLocaleString()}
3連複: 投資 ¥${yesterdayData.actualRecovery.trifecta.totalInvestment.toLocaleString()} → 払戻 ¥${yesterdayData.actualRecovery.trifecta.totalPayout.toLocaleString()}
3連単: 投資 ¥${yesterdayData.actualRecovery.trio.totalInvestment.toLocaleString()} → 払戻 ¥${yesterdayData.actualRecovery.trio.totalPayout.toLocaleString()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
累計実績（総${overallData.totalRaces}レース）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

単勝:   的中率 ${(overallData.topPickHitRate * 100).toFixed(1)}% | 回収率 ${(overallData.actualRecovery.win.recoveryRate * 100).toFixed(1)}%
複勝:   的中率 ${(overallData.topPickPlaceRate * 100).toFixed(1)}% | 回収率 ${(overallData.actualRecovery.place.recoveryRate * 100).toFixed(1)}%
3連複: 的中率 ${(overallData.top3HitRate * 100).toFixed(1)}% | 回収率 ${(overallData.actualRecovery.trifecta.recoveryRate * 100).toFixed(1)}%
3連単: 的中率 ${(overallData.top3IncludedRate * 100).toFixed(1)}% | 回収率 ${(overallData.actualRecovery.trio.recoveryRate * 100).toFixed(1)}%

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

詳細: https://rhapsody0919.github.io/boatrace-ai-predictor/#accuracy

🤖 Boatrace AI Predictor
  `;
}

/**
 * メールを送信
 */
async function sendEmail(yesterdayData, overallData) {
  const subject = `📊 AI予想実績レポート - ${yesterdayData.date}`;
  const html = generateEmailHTML(yesterdayData, overallData);
  const text = generateEmailText(yesterdayData, overallData);

  const msg = {
    to: TO_EMAIL,
    from: FROM_EMAIL,
    subject,
    text,
    html,
  };

  try {
    await sgMail.send(msg);
    console.log(`✅ メール送信成功: ${TO_EMAIL}`);
  } catch (error) {
    console.error('❌ メール送信エラー:', error);
    if (error.response) {
      console.error('レスポンス:', error.response.body);
    }
    throw error;
  }
}

/**
 * メイン処理
 */
async function main() {
  try {
    console.log('メール通知スクリプトを開始します...\n');

    // SendGridを初期化
    initializeSendGrid();

    // summary.jsonを読み込み
    const summaryPath = path.join(__dirname, '..', 'data', 'predictions', 'summary.json');
    const summaryContent = await fs.readFile(summaryPath, 'utf-8');
    const summaryData = JSON.parse(summaryContent);

    console.log('summary.jsonを読み込みました');

    // 前日のデータがない場合はスキップ
    if (!summaryData.yesterday || summaryData.yesterday.totalRaces === 0) {
      console.log('前日のデータがありません。メール送信をスキップします。');
      process.exit(0);
    }

    console.log(`前日のデータ: ${summaryData.yesterday.date} (${summaryData.yesterday.totalRaces}レース)`);

    // メール送信
    await sendEmail(summaryData.yesterday, summaryData.overall);

    console.log('\n✅ メール通知が完了しました！');

  } catch (error) {
    console.error('\n❌ エラーが発生しました:', error);
    process.exit(1);
  }
}

// スクリプトを実行
main();
