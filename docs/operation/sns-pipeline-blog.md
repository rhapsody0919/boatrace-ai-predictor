# Blogチャネル別パイプライン 制作ガイド

承認済みネタ（`sns_topics.status='approved'`）のうち、blog向けに割り当てられた`sns_topic_targets`をポーリングして記事下書き（Draft PR）を生成するRoutine向けの実行手順。設計背景は[`docs/design/sns-topic-gate/`](../design/sns-topic-gate/)（spec.md/plan.md、ADR 0036〜0038）を参照。`docs/operation/sns-pipeline-x.md`と同じ構成をテンプレートにしている。

**このRoutineはネタを自分で選定しない**。`sns-topic-proposer-weekly.md`・`sns-topic-proposer-daily-auto.md`が作った承認済みネタを拾って生成するだけの、疎結合な下流工程。

**noteパイプライン（`sns-pipeline-note.md`）はこのRoutineが生成した記事本文に依存する**（note下書きはblog記事をnote形式に変換して作る、既存の`content-multi-channel-pipeline-prompt.md`の設計を踏襲）。そのため、このRoutineは他チャネルより先に処理されることが望ましいが、厳密な順序保証はしない（noteパイプライン側がblog未完了時にスキップ・再試行する設計、`sns-pipeline-note.md`参照）。

## 実行トリガー

- 週次型（`venue-feature`）: 12時間おきのcronでポーリングする
- 日次・一般型（`daily-auto`）: 日次自動提案Routineの完了後にポーリングする
- API起動（revise/redo）: `api/admin/sns-hub/drafts/[id]/revise.js`・`redo.js`（`platform='blog'`の下書きのみ）

## 0. 蓄積されたフィードバックの確認

- `getRecentRevisions({ platform: "blog" })`（`scripts/lib/contentRevisionHistory.js`）
- `getActiveInsights({ platform: "blog" })`（`scripts/lib/snsStrategyInsights.js`）
- どちらも該当が無ければ通常通り進めてよい

## 1. claim対象の取得・claim

`docs/operation/sns-pipeline-x.md`の「1. claim対象の取得・claim」と同じ手順。`platform='blog'`のアカウントIDで`getClaimableTopicTargets()`を呼ぶ。1回の実行で処理するのは1件まで。

## 2. ネタ本文・根拠insightの確認

claimしたターゲットに紐づく`sns_topics.topic_text`・型・`source_insight_ids`を確認する（`sns-pipeline-x.md`の「2.」と同じ）。

## 3. ブログ本文の執筆

`.claude/CLAUDE.md`フローA-3の既存ルールに従う:
- 本文2,000〜3,500字目安、h2/h3で構造化
- 「よくある質問」セクション（`### 質問文`+回答形式、`## よくある質問`見出し必須）
- 「競艇」表記禁止（本文は「ボートレース」）
- 実データに基づく記述（`scripts/lib/supabaseClient.js`パターンで取得）
- 既存記事（`public/blog/`配下の同系統記事）を参考に構成・文体を揃える
- 0.で確認済みの却下理由・戦略insightを構成・訴求の判断に反映する

## 4. カバー画像の生成

`scripts/lib/contentChannels/coverImageStrategy.js`の`getCoverImageStrategy(topic)`で調達方法を判定する。

- **`{ type: "screenshot", path }`**: `scripts/lib/contentChannels/captureScreenshot.js`の`captureScreenshot()`でPlaywright撮影（1200×630）
- **`{ type: "data-card" }`**（会場特性・成績ネタは基本こちら）: `scripts/lib/contentChannels/renderCoverCard.js`の`renderCoverCard()`で`DataQuoteCard`をレンダリング（`COMPOSITION_IDS.blogOrNote`、1200×630）。`docs/reference/brand-kit.md`「YouTube / ブログ / note カバー画像・サムネイル」の制作ルールに従う
- 保存先は`public/images/blog/{slug}.jpg`（Draft PRに含める）

## 5. 品質自己レビュー

`.claude/CLAUDE.md`「ブログ記事の公開前品質チェック」の6項目（数値・データ整合性、現行仕様との整合性、検索意図の網羅性、用語・表記ルール、多言語間の一貫性、構造要件）で自己採点する。Failがあれば直して再採点する。Passするまで次に進まない。

## 6. 下書きの永続化（Draft PR）

- `sns_drafts`テーブルにINSERTする。`content_group_id`はclaimしたネタの`sns_topics.id`をそのまま使う。列: `platform`（'blog'）・`format`（4.で判定したカバー画像戦略の`type`、`'screenshot'`または`'data-card'`）・`title`・`caption_text`（本文）・`cover_image_path`・`status`（'pending_review'）・`routine_run_id`
- `git checkout -b`→ファイル作成（`public/blog/{slug}.md`）→コミット→push→`gh pr create --draft`（`master`をベースブランチにする）。作成したPR URLを`pr_url`列に保存する。4.のカバー画像も同じPRに含める

## 7. claimしたターゲットの完了処理

`markTopicTargetGenerated(targetId, draftId)`（`scripts/lib/snsTopics.js`）を呼ぶ。

## 制約（絶対厳守）

- 1回の実行で処理するネタは1件まで
- claim対象が0件、または実データの裏付けが取れない場合は生成せず終了する
- masterへの直接コミットは行わない（Draft PRのみ）
- 「競艇」表記禁止（本文は「ボートレース」）
