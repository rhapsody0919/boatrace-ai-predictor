# SNSマーケティングハブ Phase 1: タスク分解

`spec.md`・`plan.md`・`screens.md`に基づくタスク一覧。依存順に並べてある。各タスクは目安として1コミット〜1PRで完結する粒度。

## 基盤（データ・インフラ）

- [x] **Task 1: Supabaseマイグレーション適用**
  `docs/db-migration/035_sns_marketing_hub_schema.sql`をSupabase Dashboardで実行する。4テーブル（`sns_drafts`・`sns_draft_metrics`・`sns_template_variants`・`sns_approvers`）作成、RLS有効化（publicポリシーなし、ADR 0021）。`sns_approvers`に初期データ「本人」を投入
  （2026-08-27完了。Supabase MCPのアクセストークンが失効中のため私からの直接確認は未実施、ユーザー実行報告に基づく）

- [x] **Task 2: リスクチェックルールファイルの新設**
  `sns-video-studio/remotion/risk-rules.json`を新設し、`sns-video-producer-prompt.md`・`tiktok-posting-operations.md`（E節）・`docs/reference/i18n-glossary.md`等に散在する禁止パターン（ギャンブル連想表現、廃止済みモデル名、「競艇」表記、射幸心煽り表現）を抽出して初版を作成した。各ルールに`platforms`を持たせ、TikTokガイドライン違反インシデントに基づく「本命/対決/VS」等はTikTok・YouTube限定でXは対象外とする設計に変更（2026-08-27、ユーザー指摘を反映）

- [x] **Task 3: Basic認証Middleware実装**
  プロジェクトルートに`middleware.js`を新設（このプロジェクトはTypeScript未使用のため`.ts`ではなく`.js`に変更）。`config.matcher`で`/admin/sns-hub`・`/admin/sns-hub/:path*`・`/api/admin/sns-hub/:path*`を対象に設定。認証情報は環境変数`SNS_HUB_BASIC_AUTH_USER`/`SNS_HUB_BASIC_AUTH_PASSWORD`（未設定時はfail-closed）
  （2026-08-27完了。`vercel dev`はログインが必要で代行不可のため、Node scriptでmiddleware関数を直接呼び出すロジック検証で代替: 認証ヘッダなし/誤った認証情報/Basic以外のスキームは拒否、正しい認証情報は通過、全4ケースPASS。vercel.jsonのrewriteとの実地共存確認はTask 16に持ち越し）

## APIレイヤー

- [x] **Task 4: 下書き一覧・承認者一覧の取得API**
  `api/admin/sns-hub/drafts/index.js`（GET、`status`クエリでフィルタ）・`api/admin/sns-hub/approvers/index.js`（GET）を実装。service role keyでSupabaseにアクセス（ADR 0021）。動画/カバー画像は非公開Storageバケット`sns-hub-media`（2026-08-27作成）から都度署名付きURLを発行して返す
  （2026-08-27完了。Supabase MCPトークン復旧を確認し、実際のSupabaseに対してハンドラー関数を直接呼び出して検証: approversは実データ「本人」を返却、draftsはstatusフィルタ含め正常、POSTは405、いずれもPASS）

- [x] **Task 5: 承認・修正・作り直しアクションAPI**
  `api/admin/sns-hub/drafts/[id]/{approve,revise,redo}.js`（POST）を実装。共通処理は`api/_lib/snsHubHelpers.js`に切り出し（`_`prefixディレクトリはVercelのルーティング対象外）。`fireRoutine()`はRoutine未構築の間、対応する環境変数（`SNS_HUB_ROUTINE_FIRE_URL`/`_FIRE_TOKEN`）が無ければ`{fired: false}`を返して処理を継続する設計にし、Task13〜14で実際のRoutineができ次第、環境変数を設定するだけで結合できるようにした
  （2026-08-27完了。テスト用下書き行を実際に作成し8パターン検証: 承認正常系/二重承認防止(409)/修正正常系/不正reasonCodes(400)/作り直し正常系/approverId必須(400)/存在しないid(404)/ステータス遷移、全てPASS。テストデータは削除済み）

- [x] **Task 6: 投稿済み反映・指標入力API**
  `api/admin/sns-hub/drafts/[id]/{mark-posted,metrics}.js`（POST）を実装。指標は`views`/`likes`/`saves`/`shares`/`impressions`のバリデーション付き
  （2026-08-27完了。実データで6パターン検証: 投稿済み反映正常系/二重実行防止(409)/指標入力正常系/不正metricName(400)/非数値value(400)/postedでない下書きへの入力防止(409)、全てPASS。`sns_draft_metrics`のON DELETE CASCADEも確認）

## フロントエンド

- [x] **Task 7: ルーティング・サービス層**
  `src/AppRouter.jsx`に`/admin/sns-hub`ルートを追加。`src/services/snsHubService.js`を新設し、Task 4〜6のAPIを呼ぶ薄いラッパー関数群を実装

- [x] **Task 8: SnsHubAdminページ本体**
  `src/pages/admin/SnsHubAdmin.jsx`・`.css`を新設。ヘッダー・3タブ（承認待ち/投稿準備完了/投稿済み）のナビゲーション枠組み、ローディング/エラー状態（`AdminRules.jsx`パターン踏襲、色は`design-tokens.css`のCSS変数を使用）
  （2026-08-27完了。`npm run build`成功。ブラウザ実機確認で1件バグ発見・修正: `npm run dev`（Vite）はVercel Edge Functionsを実行できずAPIが期待通り応答しないため、`snsHubService.js`の`request()`がJSON解析失敗時にクラッシュしていた。JSON解析失敗を明示的なエラーとして投げるよう修正し、エラー状態UIに正しく落ちることをデスクトップ・モバイル両方で確認)

- [x] **Task 9: DraftCard・VideoPreview・RiskWarningBadge実装**
  `SnsHubAdmin.jsx`内のサブコンポーネントとして実装（動画再生・プラットフォーム/言語バッジ・テンプレートバリアント表示・リスク警告バッジ・意図/背景・キャプション表示）。動画未生成時は「動画準備中」のフォールバック表示
  （2026-08-27完了。`npm run build`成功。`npm run dev`ではAPIが実行できないため、`snsHubService.js`を一時的にモックデータに差し替えてブラウザ実機確認（バッジ・リスク警告・タブ切り替え・空状態、いずれも正常）後、モックは完全に削除して元に戻したことを確認済み）

- [x] **Task 10: 承認・修正アクション実装**
  DraftCardにアクションボタン（✅/📝/❌）・承認者選択チップ（タップ選択式）・`RevisionPanel`（定型理由チップ＋自由記述）を実装し、Task 5のAPIと接続。既存`Toast`/`useToast`でフィードバック表示。アクションはpending_review状態の下書きにのみ表示（API側のステータス検証と一致）
  （2026-08-27完了。`npm run build`成功。モックデータ+JavaScript経由のクリック操作で検証: 修正パネルの開閉、理由チップ選択によるバリデーション（未選択時は送信不可→選択で解除）、送信失敗時のエラートースト表示、いずれも正常。ブラウザのマウススクロール操作がこのセッションで不安定だったためJS直接実行で代替）

- [x] **Task 11: PostingActionLinks・webShare.js実装**
  `src/utils/webShare.js`（`canShareVideo()`/`shareVideoFile()`）を新設。`PostingActionLinks`をDraftCard内に実装（動画ダウンロード・キャプションコピー・Xはキャプション事前入力URL・TikTok/YouTubeは固定URL・iOS Safari+Web Share API対応時は共有ボタンに切り替え・投稿済みにするボタン）
  （2026-08-27完了。`npm run build`成功。モック+JS実行で検証: Xリンクのキャプション事前入力URLエンコード・ダウンロードリンク・投稿済みボタンのAPI連携、いずれも正常。**検証中に実バグを1件発見・修正**: キャプションコピー失敗時に未処理のPromise rejectionが発生していたため、try/catchと成功/失敗のインライン表示に変更）

- [x] **Task 12: PostedTab・TikTokMetricsForm実装**
  `status: posted`かつ`platform: tiktok`の下書きに`TikTokMetricsForm`（再生数/いいね数/保存数/シェア数の数値入力）を表示し、Task 6のAPIと接続
  （2026-08-27完了。`npm run build`成功。モック+JS実行で検証: フィールド4種の描画・入力・送信→ローカルフィードバック表示・API呼び出し連携、いずれも正常）

## Claude Code Routine

- [x] **Task 13: 生成Routine構築（週次バッチ・当日ネタ）** ／ **Task 14: 修正対応Routine構築（統合）**
  Routine「`sns-hub-content-generation`」（ID: `trig_01WW4Kc6vd7WtV9SXWJcFGis`）を作成。日次スケジュール（`0 23 * * *` UTC = 8:00 JST）で起動し、プロンプト内で「月曜なら週次バッチ、それ以外は当日ネタ」を判定する設計にした（1つのRoutineに複数のcron設定を持たせる方式ではなく、日次実行の中で曜日分岐する方式を採用。理由: RemoteTrigger作成APIが`cron_expression`を1つしか受け付けないため）。同じRoutineが`<routine-fire-payload>`の有無で「A. 生成フロー」「B. 修正対応フロー（translate/revise/redo）」を分岐する設計とし、Task13・14を1つのRoutineに統合した（plan.mdの未確定事項1点を解消）
  **未完了の手作業**: このRoutineにAPIトリガーを追加する作業（`claude.ai/code/routines`のWeb UIでの「Add trigger」→「API」→トークン生成）は、CLI/API経由では実行できない仕様のため私では完了できない。追加後に得られるURL・トークンを`SNS_HUB_ROUTINE_FIRE_URL`/`SNS_HUB_ROUTINE_FIRE_TOKEN`としてVercel環境変数に設定する必要がある（ユーザー確認事項として後述）
  **意図的に無効化状態で作成**: 本番Supabaseへの自律書き込み・Slack通知を伴うため、プロンプト内容のレビュー後にユーザー自身が有効化する運用とした

- [x] **Task 15: 動画軽量化Routine構築**
  Routine「`sns-hub-video-compaction`」（ID: `trig_01JXV2cDnzEBHxS2zvrCbLLy`）を作成。日次スケジュール（`0 18 * * *` UTC = 3:00 JST）。ADR 0022の方針通り完全削除ではなく軽量版への置き換え。こちらもAPIトリガー不要で完結するが、Storageファイルを不可逆に上書きするため同様に無効化状態で作成
  （作成時、プロンプト文中で「軽量化」を「軍量化」と誤字したため`update`で修正済み）

- [ ] **Task 15: 動画軽量化Routine構築**
  日次スケジュールで、期限切れ（投稿済み30日/却下7日）の`video_tier='original'`レコードを検出し、ffmpegで圧縮版に置き換えるRoutineを実装（ADR 0022）

## 検証

- [x] **Task 16: 通しの動作確認（範囲限定）**
  `npm run build`成功。`npm run test:e2e`実行: 897件中896件成功・1件失敗（`レースページ再設計（BOA-168）`、`.predict-btn`のタイムアウト）。**この失敗はSNSハブと無関係**と判断: `AppRouter.jsx`への変更はルート追加1行のみでレース関連コンポーネントに一切触れておらず、再実行しても同じ箇所で一貫して失敗する（実データのレース開催状況等、既存の別要因によるものと推測）
  **完全な一気通貫確認は未実施**: 実際にRoutineを起動しての生成→承認→投稿までのライブ確認は、(1) Routineが意図的に無効化状態、(2) APIトリガーの追加がユーザーの手作業待ち、(3) `npm run dev`ではVercel Edge Functionsが動かずAPI連携を確認できない、という制約により本タスクの範囲では実施できなかった。実際の動作確認はVercelへのデプロイ後に持ち越し
