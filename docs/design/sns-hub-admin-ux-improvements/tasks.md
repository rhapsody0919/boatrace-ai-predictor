# SNSハブ管理画面 UX改善 — タスク分解

`spec.md`・`screens.md`・`plan.md`を実装可能な単位に分解。依存順に並べており、上から順に`/step4`で実装する。バックエンド/フロントエンドの分離はPhase 2実装（PR #423〜424等）の運用を踏襲。

- [x] **タスク1: 「一部修正」送信ボタンのバリデーション修正（課題1）**
  - `RevisionPanel`の`canSubmit`を`reasonCodes.length > 0 || freeText.trim().length > 0`に修正（mode==="revise"時）
  - `api/admin/sns-hub/drafts/[id]/revise.js`のバリデーションを「`reasonCodes`または`freeText`のいずれか必須」に緩和
  - 受入基準: 自由記述のみ入力した状態で送信ボタンが有効になり、実際に送信できる

- [x] **タスク2: ダウンロードボタンのfetch+blob化（課題5）**
  - `src/utils/webShare.js`に`downloadVideoBlob(videoUrl, fileName)`を追加
  - `PostingActionLinks`の`<a href download>`をボタン+`onClick`ハンドラに置き換え、ローディング表示・エラーハンドリングを追加
  - iOS Safariの`shareState.canShare`分岐は変更しない
  - 受入基準: PC・Android等で動画が再生されずダウンロードされる。iOS共有導線は従来通り

- [x] **タスク3: 処理中バッジ＋手動更新ボタン（課題2）**
  - `ProcessingStatusBadge`コンポーネント新設（`updated_at`からの経過時間で「処理中」/「時間がかかっています」を出し分け、閾値30分は定数化）
  - `DraftCard`で`status==='revision_requested'`時にバッジを表示
  - `SnsHubAdmin`本体に手動更新ボタンを追加し、`loadDrafts()`を再実行
  - 受入基準: revise/redo後、元の下書きに処理中バッジが表示される。更新ボタンで最新状態を取得できる。30分超で警告表示に変わる

- [x] **タスク4: insight登録のバックエンド対応（課題4-a）**
  - `api/_lib/snsHubHelpers.js`に`createInsight(payload)`を新設（`updateDraft`と同じRESTパターン）
  - `docs/db-migration/040_sns_strategy_insights_source_comment.sql`を作成（コメント更新のみ）
  - `api/admin/sns-hub/drafts/[id]/revise.js`・`redo.js`に、`saveAsInsight===true`かつ`freeText`入力時の`createInsight()`呼び出しを追加（`platform`/`format`/`language`は対象下書きから引き継ぎ、`source: "revision-feedback"`）
  - 受入基準: `saveAsInsight: true`でrevise/redoを呼ぶと`sns_strategy_insights`に`status='proposed'`のレコードが作成される。既存の週次昇格処理に影響を与えない

- [x] **タスク5: insight登録のフロントエンド対応（課題4-b、タスク1・4に依存）** — **2026-09-04、下記の通り進化済み**
  - `RevisionPanel`に「この指摘を今後の生成方針に反映する」チェックボックスを追加（state: `saveAsInsight`）
  - `DraftCard`の`onRevise`/`onRedo`呼び出しに`saveAsInsight`を透過
  - `snsHubService.js`の`reviseDraft`/`redoDraft`にペイロード追加
  - 受入基準: チェックボックスを選択して送信すると、タスク4のAPIが正しく呼ばれる。未選択時は従来通り
  - **2026-09-04追記**: 当初は`platform`/`format`/`language`を対象下書きから自動継承する設計だったが、ユーザーとのアーキテクチャ議論（`docs/design/sns-topic-gate/`とは別スレッド）を経て、①「一部修正」「全部作り直し」を単一の修正指摘フローに統合、②単一チェックボックスを「反映期間（今回限り/恒久ルール化）」＋「適用範囲（このチャネルのみ/全チャネル共通）」の明示的な2軸選択に拡張、に発展させた。バックエンドは引き続き本タスクの`createInsight()`をそのまま利用。詳細は`src/pages/admin/SnsHubAdmin.jsx`の`RevisionPanel`（`mode="draft-feedback"`）参照

- [x] **タスク6: フォーマットカタログのバックエンド（課題3-a）**
  - `api/admin/sns-hub/template-variants/index.js`新設（`insights/index.js`と同じ薄いGETラッパー、`format, created_at`でソート）
  - `snsHubService.js`に`getTemplateVariants()`を追加
  - 受入基準: `sns_template_variants`の全件が取得できる

- [x] **タスク7: フォーマットカタログのフロントエンド（課題3-b、タスク6に依存）**
  - `src/data/snsFormatCatalogContent.js`新設（ADR 0031の静的キュレーションデータ、`docs/operation/sns-video-producer-prompt.md`・`x-operations-playbook.md`・`docs/reference/sns-brand-guideline.md`の要約＋GitHubリンク）
  - `TemplateVariantList`・`DocReferenceSection`・`CatalogTab`コンポーネント新設
  - `TABS`定数に`{id:"catalog", label:"フォーマットカタログ"}`追加、`SnsHubAdmin`本体で`getTemplateVariants()`を`loadDrafts()`に組み込み、`activeTab==="catalog"`時に`CatalogTab`をレンダリング
  - 受入基準: 「フォーマットカタログ」タブで型一覧とドキュメント要約・リンクが確認できる

## 追加スコープ（本ドキュメント作成後、実運用フィードバックを受けて追加）

上記タスク1〜7の完了後、本番運用で発生した追加要望・不具合をこのdesign docのタスクとしては起票せず、都度小さめのPRで対応した。

- **下書きの汎用アーカイブ/非表示機能・カタログのフォーマット別折りたたみ表示・プラットフォームバッジ色分け・生成日時/再生成表示**（PR #446）
- **管理画面からの生成Routine手動起動**（「当日ネタを今すぐ生成」「会場攻略型などを今すぐ生成」の2ボタン、PR #448）
- **承認時のtranslate自動発火停止・postedのアーカイブ制限・カタログ表のダークモード可読性修正**（PR #451、詳細は`docs/operation/sns-marketing-strategy.md`の意思決定ログ2026-08-31を参照）
- **「一部修正」「全部作り直し」を単一の修正指摘フローに統合＋「制作仕様の変更要望」経路（Linear起票）を新設**（要件84/85、タスク5の発展として上記に追記済み。sns-hub UI上でのデザイン・BGM等の抜本的な作り込みは行わない方針も`.claude/CLAUDE.md`フローBに明記。詳細な設計判断・アーキテクチャ議論は`docs/design/sns-topic-gate/`とは別スレッドで、本design doc群には未整理のまま実装優先で進めた）
