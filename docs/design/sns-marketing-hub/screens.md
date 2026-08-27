# SNSマーケティングハブ Phase 1: 画面・コンポーネント洗い出し

`spec.md`（Phase 1: 承認・多言語化・投稿橋渡し基盤）を実現するために必要な画面・コンポーネントの一覧。

## 方針（コンポーネント再利用チェック）

- **既存の`src/pages/admin/AdminRules.jsx`のページ構成パターン（ヘッダー＋タブナビゲーション＋タブコンテンツ、サブコンポーネントは同一ファイル内に定義）をそのまま踏襲する**。このパターンはstate管理・ローディング/エラー表示・タブ切り替えの実装がすでに検証済みで、今回のUIとも構造が一致するため
- 今回新設するコンポーネント（DraftCard、RevisionPanel等）は本機能専用で、他ページでの再利用は見込めない（App.jsx・RaceDetail.jsx等、他ページとのUIパターン重複は無し）。そのため`component-reuse.md`の「他ページでも使う可能性があるならコンポーネント化する」の基準に照らし、独立ファイルに切り出さず`AdminRules.jsx`同様に1ファイル内のサブコンポーネントとして実装する
- 色は全て`src/styles/design-tokens.css`の既存トークン（`--color-success-*`/`--color-warning-*`/`--color-error-*`/`--color-info-*`/`--color-gray-*`)を使う。リスク警告バッジは`--color-warning-*`、承認済みは`--color-success-*`、却下/エラーは`--color-error-*`を割り当てる。新規CSSが必要なのはレイアウト部分のみ（カードグリッド、動画プレイヤーの9:16アスペクト比固定、タップ操作を意識したボタンサイズ等）
- フィードバック表示（承認完了・送信エラー等のトースト通知）は既存の`src/components/Toast.jsx`（`useToast`フック）をそのまま再利用する。新規のトースト実装はしない

## 画面

### 1. SnsHubAdmin（新規ページ）
- パス: `/admin/sns-hub`（`src/AppRouter.jsx`に`<Route path="admin/sns-hub" element={<SnsHubAdmin />} />`を追加、既存の`admin/rules`と同列）
- ファイル: `src/pages/admin/SnsHubAdmin.jsx` + `SnsHubAdmin.css`
- 役割: ヘッダー（タイトル・トップへ戻るリンク）＋タブナビゲーション（3タブ）＋タブコンテンツ。Basic認証はアプリ側ではなく`middleware.ts`（Vercel Edge Middleware、後述）で保護するため、このコンポーネント自体は認証ロジックを持たない
- 新規/既存: 新規ページ。ヘッダー・タブ切り替えの実装パターンは`AdminRules.jsx`を踏襲（コンポーネント自体の共有はしない、パターンのみ踏襲）

## タブ（SnsHubAdmin内のサブコンポーネント、AdminRules.jsxのOverviewTab等と同じ位置付け）

### 2. ReviewTab（承認待ち）
- 役割: `status: pending_review`または`revision_requested`の下書きを一覧表示。各下書きを`DraftCard`でレンダリング。0件時は空状態メッセージ（`AdminRules.jsx`の`TodayTab`空状態パターンを踏襲）。`archived`ステータスの下書き（却下・旧バージョン）はどのタブにも表示しない
- 新規/既存: 新規

### 3. ReadyToPostTab（投稿準備完了）
- 役割: `status: approved`（多言語化進行中）〜`ready_to_post`（英語版まで生成完了）の下書きを一覧表示。各下書きに`PostingActionLinks`を表示し、投稿完了後は「投稿済みにする」ボタン（`status`を`posted`に更新）を提供
- 新規/既存: 新規

### 4. PostedTab（投稿済み）
- 役割: `status: posted`の下書きを一覧表示。投稿日時・プラットフォームを表示し、TikTok投稿には`TikTokMetricsForm`で再生数・いいね数等を手動入力できる
- 新規/既存: 新規

## コアコンポーネント（SnsHubAdmin.jsx内のサブコンポーネント）

### 5. DraftCard
- 役割: 下書き1件を表示するカード。`VideoPreview`・意図/ペルソナ背景テキスト・対象プラットフォーム/言語バッジ・**使用テンプレート/デザインバリアント表示**（例:「会場攻略型 / デザインB」、テンプレートバリアントレジストリ参照。デザイン改善・A/Bテストの比較材料として、どの下書きがどのバリアントかを一覧で分かるようにする）・`RiskWarningBadge`（該当時のみ）・アクションボタン群（✅承認 / 📝一部修正 / ❌全部作り直し）。各アクション実行時は**承認者選択チップ**（タップ選択式、自由入力は不可。初期選択肢は「本人」のみのマスタをSupabaseで管理し、将来の担当者追加は選択肢を増やすだけで対応する）を先に選ばせる。「一部修正」タップで`RevisionPanel`をカード内にインライン展開する（モーダルは使わない。既存に汎用Modalコンポーネントが無く、新規に作るコストがモバイル操作性向上という目的に対して過剰なため。インライン展開の方がスマホでの操作もシンプル）
- 新規/既存: 新規。ReviewTab・ReadyToPostTabの両方から使うため、カード自体はSnsHubAdmin.jsx内で共通化する（表示するアクション群は`status`に応じて出し分け）

### 6. VideoPreview
- 役割: Supabase Storageの署名付きURLを受け取り`<video controls playsInline>`でインライン再生する薄いラッパー。9:16アスペクト比のCSSを適用し、スマホでも画面内に収まるようにする
- 新規/既存: 新規（DraftCard・ReadyToPostTabの両方で動画再生が必要なため、小さく共通化する）

### 7. RiskWarningBadge
- 役割: リスク自動チェックで検出された警告（ギャンブル連想表現・廃止済みモデル名・「競艇」表記等）をバッジ表示する。`--color-warning-text`/`--color-warning-light`を使用。クリックで該当箇所の詳細をツールチップ的に展開（簡易実装、モーダル不要）
- 新規/既存: 新規。`AdminRules.jsx`の`recovery-badge`/`bet-type-badge`と同じ「styled span」の実装パターンを踏襲

### 8. RevisionPanel
- 役割: 「一部修正」選択時にDraftCard内で展開するインラインパネル。定型理由チップ（複数選択可: 時制表現の誤り／ギャンブル連想表現／誤字・データの誤り／トーン調整／型・題材の変更）＋自由記述テキストエリア＋送信ボタン。送信すると対象RoutineのAPIトリガーを叩き、下書きの`status`を`revision_requested`に更新する
- 新規/既存: 新規

### 9. PostingActionLinks
- 役割: 承認済み下書きに対する投稿導線。「動画をダウンロード」ボタン、「キャプション＋ハッシュタグをコピー」ボタン、プラットフォームごとのリンク（X: `x.com/intent/post?text=...`でキャプション事前入力、TikTok: `tiktok.com/tiktokstudio/upload`、YouTube: 該当アップロードURL）。iOS SafariかつWeb Share API対応時は「共有」ボタンを優先表示し、非対応時はダウンロードボタンにフォールバックする（`canShareVideo()`ヘルパーで判定、後述）
- 新規/既存: 新規

### 10. TikTokMetricsForm
- 役割: 再生数・いいね数・保存数等を数値入力する簡易フォーム（PostedTab内、TikTok投稿の下書きにのみ表示）。1箇所でしか使わないため独立コンポーネント化はせずPostedTab内に直接実装する
- 新規/既存: 新規

## 既存コンポーネントの再利用

### 11. Toast / useToast（既存、そのまま再利用）
- `src/components/Toast.jsx`。承認完了・修正送信完了・エラー発生時のフィードバック表示に使う。新規のトースト実装はしない

## UIではないが画面洗い出しに伴い発生する新規ファイル

### 12. middleware.ts（新規、プロジェクトルート）
- 役割: `/admin/sns-hub`パスへのBasic認証。Vercel Edge Middleware（`vercel/examples`の`edge-middleware/basic-auth-password`パターンを踏襲）。`config.matcher`で対象パスを限定し、既存の`vercel.json`のSPA向けrewriteとは独立して動作する
- UIコンポーネントではないため`docs/design/sns-marketing-hub/tasks.md`（`/step3`）側で実装タスク化する

### 13. snsHubService.js（新規、サービス層）
- 役割: Supabaseへの下書き一覧取得・状態更新（承認/修正指摘/作り直し/投稿済み反映）・TikTok指標保存のクエリ関数群。`src/services/`配下に配置（既存の`ruleMatchService.js`・`adminRuleService.js`と同じ置き場所）
- UIコンポーネントではないため`/step2`（システム設計）で詳細を詰める

### 14. webShare.js（新規、小規模ユーティリティ）
- 役割: `navigator.canShare()`で動画ファイル共有への対応可否を判定するヘルパー関数（`canShareVideo(file)`）。iOS Safariでの信頼性懸念（`spec.md`参照）を踏まえ、必ずフォールバック分岐とセットで使う
- 置き場所: `src/utils/`配下

### 15. 動画バイナリ軽量化Routine（新規、UIなし）
- 役割: 投稿済み30日・却下/アーカイブ済み7日を経過した動画バイナリを、Supabase Storage上で低圧縮・低画質の軽量版に置き換える定期Routine（`spec.md`要件15、完全削除はしない）。管理画面のUIには現れない。PostedTab等で古い投稿の動画を再生する際は軽量版が表示される（振り返り用途としては十分な画質）

## 未確定事項（spec.mdから持ち越し、画面設計時に一部確定）

- **テンプレートバリアントレジストリのテーブル構造・命名（型・バリアント名・有効フラグ等の項目）は`/step2`で設計する**。DraftCardでの表示形式（バッジか、詳細展開部分に置くか）も`/step2`後に画面デザインとして確定する
- 修正指摘の定型理由チップの文言は本ドキュメントの案（時制表現の誤り／ギャンブル連想表現／誤字・データの誤り／トーン調整／型・題材の変更）で確定とする
- タブの並び順・デフォルト表示タブ（ReviewTabを既定にする想定）は`/step2`で最終確認する
- DraftCardのアクションボタンの具体的な配置・タップ領域のサイズ（モバイル操作性）は実装時にPlaywrightでの実機確認を経て微調整する
