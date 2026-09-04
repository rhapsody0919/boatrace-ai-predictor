# YouTubeチャネル別パイプライン 制作ガイド

承認済みネタ（`sns_topics.status='approved'`）のうち、YouTube向けに割り当てられた`sns_topic_targets`をポーリングして動画下書きを生成するRoutine向けの実行手順。設計背景は[`docs/design/sns-topic-gate/`](../design/sns-topic-gate/)（spec.md/plan.md、ADR 0036〜0038）を参照。`docs/operation/sns-pipeline-x.md`と同じ構成をテンプレートにしている。

**このRoutineは下書き（`sns_drafts`、`status='pending_review'`）を作るところまでが責務**。承認後の実際のYouTubeへのアップロード・公開は、既存の`api/admin/sns-hub/drafts/[id]/publish-youtube.js`（YouTube Data API v3、ADR 0035）が承認操作をトリガーに自動で行う。このRoutine自身はYouTubeへの投稿を一切行わない。

## 実行トリガー

- 週次型（`venue-feature`）: 12時間おきのcronでポーリングする
- 日次・一般型（`daily-auto`）: 日次自動提案Routineの完了後にポーリングする
- API起動（修正指摘）: `api/admin/sns-hub/drafts/[id]/redo.js`（2026-09-04、旧revise.jsと統合済み）（`platform='youtube'`の下書きのみ）
- API起動（今すぐ生成、要件26）: `api/admin/sns-hub/topics/[id]/targets/[targetId]/fire.js`からのペイロード（`{action: 'generate_now', targetId}`）。`status='pending'`であることは検証済みの1件のみが対象。「1. claim対象の取得・claim」を丸ごとスキップし、`claimTopicTarget(targetId, routineRunId)`（`scripts/lib/snsTopics.js`）を`targetId`に対して直接呼ぶ（`docs/operation/sns-pipeline-x.md`の「A''. 即時生成フロー」と同じ思想）。戻り値がnullなら生成せず終了する（ADR 0036）

## 0. 蓄積されたフィードバックの確認

- `getRecentRevisions({ platform: "youtube" })`（`scripts/lib/contentRevisionHistory.js`）
- `getActiveInsights({ platform: "youtube" })`（`scripts/lib/snsStrategyInsights.js`）

## 1. claim対象の取得・claim

`docs/operation/sns-pipeline-x.md`の「1.」と同じ手順。`platform='youtube'`のアカウントIDで`getClaimableTopicTargets()`を呼ぶ。1回の実行で処理するのは1件まで。

## 2. ネタ本文・根拠insightの確認

`sns-pipeline-x.md`の「2.」と同じ。

## 3. 実データ取得・映像設計

`sns-video-producer-prompt.md`で確立済みの技術手順を踏襲する（`sns-pipeline-x.md`の「3.」と同じレンダリング手順）。**YouTube向けは16:9（1920x1080）**（X/TikTokの9:16とは別に構成する。同じ動画を無理に流用しない）。

- ネタの型に応じたフォーマットを選ぶ（`venue-feature`型は`VenueRankingTemplate`系を優先）
- `sns-video-studio/remotion/risk-rules.json`を照合し、該当があれば`risk_flags`に記録する
- `sns-video-producer-prompt.md`の「セルフレビュー チェックリスト」で自己採点する

## 4. サムネイルの生成

`scripts/lib/contentChannels/renderCoverCard.js`の`COMPOSITION_IDS.youtubeThumbnail`（1280×720）で生成する。3.の動画と同じ実データ・見出しを使い、チャネル間で見た目がバラバラにならないようにする（`content-multi-channel-pipeline-prompt.md`の既存手順と同じ）。

## 5. アップロード・永続化

- Supabase Storageの非公開バケット`sns-hub-media`に動画・サムネイルをアップロードする（パス例: `{content_group_id}/youtube-ja.mp4`）
- `sns_drafts.video_storage_path`/`cover_image_path`には**生のStorageパスをそのまま保存する**（署名付きURLを保存しない、`.claude/rules/sns-content-generation.md`参照）
- `sns_drafts`テーブルにINSERTする。列: `content_group_id`（claimしたネタの`sns_topics.id`）・`format`（ビジュアルテンプレート名のみ）・`template_variant_id`・`language`（'ja'）・`platform`（'youtube'）・`status`（'pending_review'）・`video_storage_path`・`cover_image_path`・`caption_text`・`hashtags`・`background_text`・`source_data`・`risk_flags`・`routine_run_id`

## 6. claimしたターゲットの完了処理

`markTopicTargetGenerated(targetId, draftId)`（`scripts/lib/snsTopics.js`）を呼ぶ。

## 制約（絶対厳守）

- 1回の実行で処理するネタは1件まで
- **1つのclaim済みターゲットにつき、`sns_drafts`行は必ず1件だけ作る**。生成後に内容の誤りに自分で気づいた場合も、同一セッション内で2件目を作り直さない。6.の完了処理（`markTopicTargetGenerated`）を済ませたら、その回の生成物が最終版であり、修正は人間の下書き承認画面からの修正指摘操作に委ねる（2026-09-03、Blogパイプラインで同種の不具合が発生し判明。本パイプラインにも同じ制約を横展開）
- claim対象が0件、または実データの裏付けが取れない場合は生成せず終了する
- 「競艇」表記禁止、射幸心を煽らない、実データ以外は使わない
- **このRoutineはYouTubeへの実際の投稿・公開は一切行わない**（承認時に`publish-youtube.js`が自動で行う）
