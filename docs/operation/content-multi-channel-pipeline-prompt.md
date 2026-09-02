# ネタ駆動マルチチャネルコンテンツパイプライン 制作ガイド

毎晩1本、ネタを選定してブログ・note（・将来的にX/TikTok/YouTube）へ展開するRoutine向けの実行手順。設計の背景は[`docs/design/content-multi-channel-pipeline/`](../design/content-multi-channel-pipeline/)（spec.md/screens.md/plan.md）を参照。X/TikTok/YouTubeの当日ネタ動画生成は別レーン（既存の`sns-hub-content-generation` Routine）が担当するため、このガイドの対象外。

**着手前に必ず[`docs/reference/brand-kit.md`](../reference/brand-kit.md)のギャラリーを確認すること**。既存の採用実例と矛盾する独自デザインを作らない。

## 0. 直近の却下理由の確認（2026-09-02追加）

`getRecentRevisions({ platform: "blog" })`・`getRecentRevisions({ platform: "note" })`（`scripts/lib/contentRevisionHistory.js`）で直近30日の修正依頼・却下理由を取得し、同じ間違いを繰り返さないよう生成方針に反映する。理由コード（`revision_reason_codes`）だけでなく`revisionReasonFreetext`（自由記述）も必ず読む。該当が無ければ通常通り進めてよい。

同じ理由が3回以上累積した場合はGitHub Actions（`content-ops-nightly-check.yml`）が自動でLinearにcontent-qualityラベル付きIssueを起票する（`scripts/maintenance/content-ops-checks/check-revision-escalation.js`）ため、このRoutine側で追加の対応は不要。

## 1. ネタ選定

`scripts/lib/contentTopics/index.js`の`collectAllCandidates()`を呼び、4系統（新機能/会場特性/データ知見/成績）の候補を集める。

- 新機能ネタが1件でもあれば最優先（機会ベースのため、出た時に逃さない）
- 無ければ他3系統から選ぶ。データ知見・会場特性は各モジュールが未使用優先で候補をソート済みなので、先頭から選べばよい
- **頻度上限は系統合計で1晩1本**（spec.md非機能要件、品質が安定したと判断されるまでの初期運用値）
- 実データが必要な系統（データ知見・成績）で、Supabase接続失敗等により実データを検証できない場合は、**そのネタを見送り、翌日以降に再試行する**。プレースホルダーでの生成はしない（FR4）。これは「良いネタが無いから見送る」（design上明確に却下された考え方）とは別物——データ欠如という技術的な非該当条件

## 2. チャネル選定

`scripts/lib/contentChannels/channelMatrix.js`の`getChannelsForTopic(sourceId)`で、選んだネタが展開すべきチャネル一覧を取得する。

## 3. ブログ本文の執筆

`.claude/CLAUDE.md`フローA-3の既存ルールに従う:
- 本文2,000〜3,500字目安、h2/h3で構造化
- 「よくある質問」セクション（`### 質問文`+回答形式、`## よくある質問`見出し必須）
- 「競艇」表記禁止（本文は「ボートレース」）
- 実データに基づく記述（`scripts/lib/supabaseClient.js`パターンで取得。取得できない場合は1.の見送りルールに従う）
- 既存記事（`public/blog/`配下の同系統記事）を参考に構成・文体を揃える

執筆前に`getActiveInsights({ platform: "blog" })`（`scripts/lib/snsStrategyInsights.js`）でactive状態のinsightを取得し、構成・訴求の判断に反映する（`/growth-pdca`ステップ7・ADR 0027参照。Search Console/GA4実績から導かれた「こう書くと効く」という知見が蓄積される設計）。insightが無ければ通常通り進めてよい。

## 4. note下書きの作成

1. 3.のブログ本文をもとに、`convert_to_note_markdown.py`と同じ変換ロジックでnote向けフォーマットに変換する（見出し記法・埋め込み構文の違いを吸収。ブログ本文と完全一致はさせない、ADR 0032参照）
2. 本文に画像、または新機能ネタの場合はYouTube動画リンクを必ず含める（文字だけの下書きにしない）。画像は5.で生成したカバー画像を使う
3. タグを付与する

## 5. カバー画像の生成（2026-09-02追加、旧「画像は人間が用意する」を置き換え）

`scripts/lib/contentChannels/coverImageStrategy.js`の`getCoverImageStrategy(topic)`で、選んだネタに対する調達方法を判定する。

- **`{ type: "screenshot", path }`**（新機能・データ知見ネタ）: `scripts/lib/contentChannels/captureScreenshot.js`の`captureScreenshot()`で、ローカルdevサーバー（`npm run dev`起動済み前提）の該当パスをPlaywrightで撮影する。ブログ用は1200×630のビューポートで撮影する
- **`{ type: "data-card" }`**（会場特性・成績ネタ）: `scripts/lib/contentChannels/renderCoverCard.js`の`renderCoverCard()`で`DataQuoteCard`（[`sns-video-studio/remotion/src/DataQuoteCard.jsx`](../../sns-video-studio/remotion/src/DataQuoteCard.jsx)）をレンダリングする。`COMPOSITION_IDS.blogOrNote`（1200×630、ブログ/note共通）を使う。**制作ルール（`docs/reference/brand-kit.md`「YouTube / ブログ / note カバー画像・サムネイル」参照、必須）**:
  - `headline`は本文の要点を15〜20字程度に要約したもの。表記ルール（「競艇」禁止等）に従う
  - `statValue`/`statLabel`には、**可能な限り**本文で使った実データの根拠数値（レース数・日数・会場数等、例:`"13,386レース"`/`"直近90日・24会場の実績データ"`）を入れる。定性的なネタ（会場特性の説明等）で該当する数値が無い場合は空文字列でよい（`caption`のみで表現する）
  - サイト名・タグライン・見出しゴールド固定・改行崩れ防止は`DataQuoteCard`自体が内蔵しているため、呼び出し側で追加対応は不要
- 保存先は`public/images/blog/{slug}.jpg`（Draft PRに含める）

## 6. 品質自己レビュー（FR4、多層防御）

1. **生成と採点を別ロール・別視点で行う**: 3.4で生成した内容を、初めて読む第三者として批判的に検証する。以下6項目（`.claude/CLAUDE.md`「ブログ記事の公開前品質チェック」と同一）:
   - 数値・データ整合性（元データから再計算し一致を確認する。目視のみで済ませない）
   - 現行仕様との整合性（`node scripts/maintenance/check-deprecated-terms.js`で機械確認）
   - 検索意図の網羅性
   - 用語・表記ルール
   - 多言語間の一貫性（該当する場合）
   - 構造要件（文字数・画像・FAQ）
2. Failがあれば人間に見せる前に自分で修正し、1に戻って再採点する。Passするまで次のステップに進まない

## 7. 下書きの永続化

`sns_drafts`テーブルに以下の形でINSERTする（ADR 0032）:
- 同一ネタから派生するblog行・note行は同じ`content_group_id`を共有
- `platform`: `'blog'` / `'note'`
- `format`: ネタのsourceId（`new-feature`/`venue-characteristic`/`data-insight`/`daily-result`）
- `title`・`caption_text`（本文）・`hashtags`（noteタグ）・`cover_image_path`または`embed_video_url`
- `status`: `'pending_review'`

ブログ行は同時にDraft PRも作成する（`git checkout -b`→ファイル作成→コミット→push→`gh pr create --draft`。2026-09-01のフローA Routine化検証で確立済みの手順と同じ）。作成したPR URLを`pr_url`列に保存する。5.で生成したカバー画像も同じPRに含める。

## 8. 使用履歴の更新

会場特性・データ知見ネタを使った場合、対応する`recordUsage()`関数（`venueCharacteristicSource.js`/`dataInsightSource.js`）を呼び、履歴JSONに使用日時を追記する。

## 制約（絶対厳守）

- 頻度上限（1晩1本）を超えて生成しない
- 6.の採点でFailのまま次に進まない
- masterへの直接コミット・マージは行わない、Draft PRのみ
- カバー画像は5.の仕組み（スクリーンショットまたはDataQuoteCard）で必ず用意する。人間が事前に用意した画像への依存はしない
