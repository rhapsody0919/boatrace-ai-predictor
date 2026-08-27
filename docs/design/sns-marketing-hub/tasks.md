# SNSマーケティングハブ Phase 1: タスク分解

`spec.md`・`plan.md`・`screens.md`に基づくタスク一覧。依存順に並べてある。各タスクは目安として1コミット〜1PRで完結する粒度。

## 基盤（データ・インフラ）

- [ ] **Task 1: Supabaseマイグレーション適用**
  `docs/db-migration/035_sns_marketing_hub_schema.sql`をSupabase Dashboardで実行する。4テーブル（`sns_drafts`・`sns_draft_metrics`・`sns_template_variants`・`sns_approvers`）作成、RLS有効化（publicポリシーなし、ADR 0021）。`sns_approvers`に初期データ「本人」を投入

- [ ] **Task 2: リスクチェックルールファイルの新設**
  `sns-video-studio/remotion/risk-rules.json`を新設し、`sns-video-producer-prompt.md`・`tiktok-posting-operations.md`（E節）等に散在する禁止パターン（ギャンブル連想表現、廃止済みモデル名、「競艇」表記）を抽出して初版を作成する

- [ ] **Task 3: Basic認証Middleware実装**
  プロジェクトルートに`middleware.ts`を新設（`vercel/examples`の`edge-middleware/basic-auth-password`パターン踏襲）。`config.matcher`で`/admin/sns-hub`と`/api/admin/sns-hub/*`の両方を対象に設定。既存の`vercel.json`のSPA向けrewriteと共存することをローカル確認する

## APIレイヤー

- [ ] **Task 4: 下書き一覧・承認者一覧の取得API**
  `/api/admin/sns-hub/drafts`（GET、ステータス別フィルタ対応）・`/api/admin/sns-hub/approvers`（GET）を実装。service role keyでSupabaseにアクセス（ADR 0021）

- [ ] **Task 5: 承認・修正・作り直しアクションAPI**
  `/api/admin/sns-hub/drafts/:id/approve`・`/revise`・`/redo`（いずれもPOST）を実装。Supabase更新後、対応するRoutineの`/fire`エンドポイントを呼ぶ（ADR 0020）。この時点ではRoutine側は未実装のため、`/fire`呼び出し部分はモック/スタブで進め、Task 13〜14と結合する

- [ ] **Task 6: 投稿済み反映・指標入力API**
  `/api/admin/sns-hub/drafts/:id/mark-posted`・`/metrics`（いずれもPOST）を実装

## フロントエンド

- [ ] **Task 7: ルーティング・サービス層**
  `src/AppRouter.jsx`に`/admin/sns-hub`ルートを追加。`src/services/snsHubService.js`を新設し、Task 4〜6のAPIを呼ぶ薄いラッパー関数群を実装

- [ ] **Task 8: SnsHubAdminページ本体**
  `src/pages/admin/SnsHubAdmin.jsx`・`.css`を新設。ヘッダー・3タブ（ReviewTab/ReadyToPostTab/PostedTab）のナビゲーション枠組み、ローディング/エラー状態（`AdminRules.jsx`パターン踏襲）。この時点ではタブ中身は空でよい

- [ ] **Task 9: DraftCard・VideoPreview・RiskWarningBadge実装**
  ReviewTabの中核。下書き1件の表示（動画再生・意図/ペルソナ背景・テンプレートバリアント表示・リスク警告バッジ）を実装。Supabase Storageの署名付きURL取得はTask 4のAPIレスポンスに含める

- [ ] **Task 10: 承認・修正アクション実装**
  DraftCardにアクションボタン（✅/📝/❌）・承認者選択チップ・`RevisionPanel`（定型理由チップ＋自由記述）を実装し、Task 5のAPIと接続する。`Toast`（既存）でフィードバック表示

- [ ] **Task 11: PostingActionLinks・webShare.js実装**
  ReadyToPostTabの中核。動画ダウンロード・キャプションコピー・プラットフォーム別リンク（X: intent URL、TikTok/YouTube: 固定URL）を実装。`src/utils/webShare.js`（`canShareVideo()`）を新設し、iOS Safari + Web Share API対応時のみ共有ボタンを出す

- [ ] **Task 12: PostedTab・TikTokMetricsForm実装**
  投稿済み一覧とTikTok指標の手動入力フォームを実装し、Task 6のAPIと接続する

## Claude Code Routine

- [ ] **Task 13: 生成Routine構築（週次バッチ・当日ネタ）**
  `remotion.config.mjs`に`Config.setBrowserExecutable(...)`を設定、Routine環境のセットアップスクリプトに`ffmpeg`導入を追加（2026-08-27のone-off検証結果を反映）。型選定ロジック（`sns-video-producer-prompt.md`踏襲）・Task 2のリスクチェック・`sns_drafts`へのINSERT・Storageアップロード・バッチ完了時のSlack通知（1回の実行につき1通）を実装。スケジュールトリガー（週次+日次）を設定

- [ ] **Task 14: 修正対応Routine構築**
  APIトリガーを追加し、Task 5でスタブにしていた`/fire`呼び出しと結合する。修正内容を反映した再生成、旧レコードの`archived`化を実装

- [ ] **Task 15: 動画軽量化Routine構築**
  日次スケジュールで、期限切れ（投稿済み30日/却下7日）の`video_tier='original'`レコードを検出し、ffmpegで圧縮版に置き換えるRoutineを実装（ADR 0022）

## 検証

- [ ] **Task 16: 通しの動作確認**
  `npm run build`・`npm run test:e2e`実行。実際にRoutineを1回動かし、生成→Slack通知→管理画面での承認→英語版自動生成→投稿導線の表示、までを一気通貫でPlaywright/実機確認する。既存ページ・ルーティングへの影響が無いことを確認
