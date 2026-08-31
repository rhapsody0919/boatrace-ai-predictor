# SNSハブ管理画面 UX改善 — システム設計

`spec.md`・`screens.md`で確定した5課題の実装方針。UI機能のため対象は`src/pages/admin/SnsHubAdmin.jsx`とその周辺（サービス層・API・DB）に限定される。

## データ設計

### 1. `sns_strategy_insights.source`（課題4）— マイグレーション不要と判明

`docs/db-migration/039_sns_strategy_insights.sql`を確認したところ、`source`列は`VARCHAR(20) NOT NULL`で、ネイティブENUM型でもCHECK制約でもなく、有効値（`'own-metrics' | 'external-research'`）はコメントで文書化されているのみ（アプリケーション側で担保）。したがって`'revision-feedback'`という新しい値を書き込むこと自体に**スキーマ変更は不要**（spec.md未確定事項4は解消）。`source`はユーザー入力ではなくAPI側が固定文字列として書き込む値のため、サーバー側の値検証も不要。

このコメントの更新のみ、新規マイグレーションファイル`docs/db-migration/040_sns_strategy_insights_source_comment.sql`で以下を追記する（実データへの影響なし、ドキュメント目的）:

```sql
COMMENT ON COLUMN sns_strategy_insights.source IS
  '''own-metrics'' | ''external-research'' | ''revision-feedback''（revise/redo時のユーザー自由記述由来、ADR未作成・spec.md要件4参照）';
```

### 2. `revision_requested`の経過時間判定（課題2）

新規カラムは不要。既存の`sns_drafts.updated_at`（`updateDraft()`実行時に自動更新される）を「revision_requestedへの遷移時刻」の近似値として使う。`revise.js`/`redo.js`は`updateDraft(id, {status: "revision_requested", ...})`を呼んだ直後に`updated_at`が更新されるため、以降このレコードが再度更新されない限り経過時間の起点として使える。

### 3. `sns_template_variants`（課題3）— 既存テーブルをそのまま読み取り専用で利用

新規カラム不要。既存の`format`・`variant_name`・`composition_name`・`active`・`created_by`（039で追加済み）をそのまま一覧表示に使う。

## コンポーネント構成・データフロー

### 課題1: `RevisionPanel`のバリデーション修正

```
RevisionPanel.canSubmit = mode === "redo" || reasonCodes.length > 0 || freeText.trim().length > 0
```

API側 `api/admin/sns-hub/drafts/[id]/revise.js`:
```
if ((!Array.isArray(reasonCodes) || reasonCodes.length === 0) && !freeText?.trim()) {
  return jsonResponse({ error: "reasonCodesまたはfreeTextのいずれかが必須です" }, 400);
}
```
`reasonCodes`が空配列でも許容するよう、以降の`invalidCodes`チェックは`reasonCodes`が存在する場合のみ実行するよう分岐を調整する。

### 課題2: 処理中バッジ＋手動更新ボタン

- `DraftCard`: `draft.status === "revision_requested"`のとき、既存の`draft-card-badges`内に`ProcessingStatusBadge`を追加表示
  ```
  const minutesElapsed = (Date.now() - new Date(draft.updated_at)) / 60000;
  const isStale = minutesElapsed > 30; // 目安30分、閾値は定数化
  ```
  `isStale`が`false`なら「処理中」、`true`なら「時間がかかっています（Routineの状況を確認してください）」を表示。色は両方とも既存`--color-warning`系トークンを使うが、`isStale`時はテキストのみ変える（新規トークン不要）
- `SnsHubAdmin`本体: `tab-navigation`の右側（または直下）に「🔄 更新」ボタンを追加。クリックで既存の`loadDrafts()`を呼ぶだけ（新規ロジック不要、既存関数の再利用）

### 課題3: フォーマットカタログタブ

- `TABS`定数に`{id: "catalog", label: "フォーマットカタログ"}`を追加
- `SnsHubAdmin`: `activeTab === "catalog"`のとき`CatalogTab`をレンダリング。既存の`loadDrafts()`に`getTemplateVariants()`の呼び出しを追加し、`templateVariants` stateとして保持
- `CatalogTab({ templateVariants })`:
  - セクション1「型一覧」: `TemplateVariantList`が`templateVariants`をフォーマット別にグルーピングして表示（型名・variant_name・composition_name・作成者バッジ(human/routine)・稼働状態）
  - セクション2「デザイン・ペルソナ方針」: `DocReferenceSection`が`src/data/snsFormatCatalogContent.js`（ADR 0031で新設、静的キュレーションデータ）をレンダリング。各エントリ: `{title, summary, docPath, docLabel}` → GitHubリンク付きカードとして表示
- 新規API: `api/admin/sns-hub/template-variants/index.js`（`insights/index.js`と同じ薄いGETラッパー、`sns_template_variants`を`format, created_at`でソートして返す）
- 新規service関数: `getTemplateVariants()`（`getInsights()`と同じパターン）

### 課題4: revise/redoの自由記述を選択的にinsight化

- `RevisionPanel`: `freeText`のtextarea下に「この指摘を今後の生成方針に反映する」チェックボックス（state: `saveAsInsight`）を追加。`onSubmit`のpayloadに含める
- `DraftCard`: `onRevise`/`onRedo`の呼び出しに`saveAsInsight`をそのまま透過
- `snsHubService.js`: `reviseDraft`/`redoDraft`のペイロードに`saveAsInsight`を追加
- API `revise.js`/`redo.js`: `saveAsInsight === true`かつ`freeText`が入力されている場合、`updateDraft`実行後（`fireRoutine`呼び出しの前後どちらでもよいが、Routine起動をブロックしないよう並行実行）に`createInsight()`を呼ぶ
  ```js
  if (body.saveAsInsight && freeText?.trim()) {
    await createInsight({
      platform: draft.platform,
      language: draft.language,
      format: draft.format,
      insight_text: freeText.trim(),
      evidence: `revise操作(content_group_id=${draft.content_group_id})でのユーザー指摘: ${freeText.trim()}`,
      source: "revision-feedback",
      research_method: "manual",
      status: "proposed",
    });
  }
  ```
  `platform`/`format`/`language`は対象下書きの値をそのまま引き継ぐため「特定できないケース」（spec.md未確定事項3）は実質発生しない（`sns_drafts`はこの3列が`NOT NULL`のため、`getDraftById`で取得した時点で必ず値がある）
- `api/_lib/snsHubHelpers.js`に`createInsight(payload)`を新設（`updateDraft`と同じPOST/RESTパターン）

### 課題5: ダウンロードボタンのfetch+blob化

- `src/utils/webShare.js`に`downloadVideoBlob(videoUrl, fileName)`を追加:
  ```js
  export async function downloadVideoBlob(videoUrl, fileName = "video.mp4") {
    const response = await fetch(videoUrl);
    if (!response.ok) throw new Error(`動画の取得に失敗しました: ${response.status}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  }
  ```
- `PostingActionLinks`: 既存の`<a href={draft.video_url} download>`をボタンに置き換え、`onClick`で`downloadVideoBlob`を呼ぶ。呼び出し中は`downloading` stateで「⏳ ダウンロード準備中...」を表示し、完了/失敗でリセット。失敗時は既存`copyFeedback`と同じ表示パターンでエラーメッセージを出す
- iOS Safariの`shareState.canShare`分岐はそのまま維持（変更しない）

## 既存サービス層・共通ライブラリとの連携

- `snsHubService.js`: `getTemplateVariants()`新設、`reviseDraft`/`redoDraft`の引数拡張のみ。既存関数のシグネチャ破壊的変更は無い（`saveAsInsight`はoptionalなプロパティとして追加）
- `api/_lib/snsHubHelpers.js`: `createInsight()`新設。既存の`updateDraft`と対になる書き込みヘルパー
- `src/utils/webShare.js`: `downloadVideoBlob()`追加。既存の`canShareVideo`/`shareVideoFile`とは独立した関数（既存関数の変更なし）

## 運用上の留意点

- カタログの`src/data/snsFormatCatalogContent.js`は、`docs/operation/sns-video-producer-prompt.md`等が更新されたら手動で同期する必要がある（ADR 0031）。同期を忘れると内容が陳腐化するが、自動検知の仕組みは今回作らない（spec.mdスコープ外）。将来のドキュメント更新時に「カタログも更新したか」をレビュー観点に加えることが望ましいが、これは運用ルールの追加であり本タスクの実装範囲外
