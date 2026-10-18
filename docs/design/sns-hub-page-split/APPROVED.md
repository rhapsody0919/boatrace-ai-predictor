# SNS ハブ管理画面のページ分割 — 承認の記録

- 承認日: 2026-10-18
- 承認のメッセージ（要旨）: 「Q1〜Q4すべて推奨どおりで承認、実装を進めて」（オーナー、オーケストレーター経由）
- 承認した案: Artifact「sns-hub ページ分割案」（https://claude.ai/artifact/YQ74VFp8g9qhDji3cP1UPC）。画像は `mock/mock-375.png`・`mock/mock-1440.png`

## 承認範囲

| 画面 | URL | 中身 |
|---|---|---|
| 手動承認 | `/admin/sns-hub` | ネタ承認、Blog・note・X・YouTube の下書き（状態: 承認待ち／投稿準備完了／投稿済み） |
| 自動送信 | `/admin/sns-hub/auto` | いまの状態（チャネルごとのモード・試運転・停止）と「全部止める」、要対応、今日、全月カレンダー（畳む） |
| 数字と戦略メモ | `/admin/sns-hub/metrics` | 48h・7d の観測と CSV、投稿ごとの観測、戦略メモ |
| 資料 | `/admin/sns-hub/library` | フォーマットカタログ、展望素材 v0 の取り込み |

共通: 上部のページ切り替え（手動承認は承認待ちの件数、自動送信は要対応の件数）。

## 決めたこと（Q1〜Q4、すべて推奨どおり）

1. 検査で落ちた自動送信の素材は、画面から人が承認して送る道を作らない（Slack の知らせと「要対応」の表示だけ）
2. TikTok のタブを消す（アカウント BAN）。下書きのデータは DB に残す
3. 自動送信ページに「いまの状態」を読み取りだけで出す。切り替え・再開は本番 SQL のまま
4. 展望素材 v0 の取り込み画面は資料のページに移して残す

## 撤去したもの

- 今日のレースを確認・個別承認（`MobileApprovalPanel`・`EditAssistFindings`・`/api/admin/sns-hub/mobile-approval`）
- 送信の仕組みが使う `api/_lib/snsMobileApproval.js` の `sendHolds`・`mobileVersion` と、マイグレーション 140 の表・関数は残した（sns-auto-plan・draft-diff が使う）
