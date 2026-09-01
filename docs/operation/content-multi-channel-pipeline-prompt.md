# ネタ駆動マルチチャネルコンテンツパイプライン 制作ガイド

毎晩1本、ネタを選定してブログ・note（・将来的にX/TikTok/YouTube）へ展開するRoutine向けの実行手順。設計の背景は[`docs/design/content-multi-channel-pipeline/`](../design/content-multi-channel-pipeline/)（spec.md/screens.md/plan.md）を参照。X/TikTok/YouTubeの当日ネタ動画生成は別レーン（既存の`sns-hub-content-generation` Routine）が担当するため、このガイドの対象外。

**着手前に必ず[`docs/reference/brand-kit.md`](../reference/brand-kit.md)のギャラリーを確認すること**。既存の採用実例と矛盾する独自デザインを作らない。

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

## 4. note下書きの作成

1. 3.のブログ本文をもとに、`convert_to_note_markdown.py`と同じ変換ロジックでnote向けフォーマットに変換する（見出し記法・埋め込み構文の違いを吸収。ブログ本文と完全一致はさせない、ADR 0032参照）
2. 本文に画像、または新機能ネタの場合はYouTube動画リンクを必ず含める（文字だけの下書きにしない）
3. タグを付与する

## 5. 品質自己レビュー（FR4、多層防御）

1. **生成と採点を別ロール・別視点で行う**: 3.4で生成した内容を、初めて読む第三者として批判的に検証する。以下6項目（`.claude/CLAUDE.md`「ブログ記事の公開前品質チェック」と同一）:
   - 数値・データ整合性（元データから再計算し一致を確認する。目視のみで済ませない）
   - 現行仕様との整合性（`node scripts/maintenance/check-deprecated-terms.js`で機械確認）
   - 検索意図の網羅性
   - 用語・表記ルール
   - 多言語間の一貫性（該当する場合）
   - 構造要件（文字数・画像・FAQ）
2. Failがあれば人間に見せる前に自分で修正し、1に戻って再採点する。Passするまで次のステップに進まない

## 6. 下書きの永続化

`sns_drafts`テーブルに以下の形でINSERTする（ADR 0032）:
- 同一ネタから派生するblog行・note行は同じ`content_group_id`を共有
- `platform`: `'blog'` / `'note'`
- `format`: ネタのsourceId（`new-feature`/`venue-characteristic`/`data-insight`/`daily-result`）
- `title`・`caption_text`（本文）・`hashtags`（noteタグ）・`cover_image_path`または`embed_video_url`
- `status`: `'pending_review'`

ブログ行は同時にDraft PRも作成する（`git checkout -b`→ファイル作成→コミット→push→`gh pr create --draft`。2026-09-01のフローA Routine化検証で確立済みの手順と同じ）。作成したPR URLを`pr_url`列に保存する。

## 7. 使用履歴の更新

会場特性・データ知見ネタを使った場合、対応する`recordUsage()`関数（`venueCharacteristicSource.js`/`dataInsightSource.js`）を呼び、履歴JSONに使用日時を追記する。

## 制約（絶対厳守）

- 頻度上限（1晩1本）を超えて生成しない
- 5.の採点でFailのまま次に進まない
- masterへの直接コミット・マージは行わない、Draft PRのみ
- 画像・スクリーンショットの自動取得は対象外（別途`docs/design/content-multi-channel-pipeline/spec.md`の未確定事項を参照。今のところ画像が必要なネタは人間が用意するか、YouTube動画リンクで代替する）
