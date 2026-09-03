# Noteチャネル別パイプライン 制作ガイド

承認済みネタ（`sns_topics.status='approved'`）のうち、note向けに割り当てられた`sns_topic_targets`をポーリングしてnote下書きを生成するRoutine向けの実行手順。設計背景は[`docs/design/sns-topic-gate/`](../design/sns-topic-gate/)（spec.md/plan.md、ADR 0036〜0038）を参照。`docs/operation/sns-pipeline-x.md`と同じ構成をテンプレートにしている。

**このRoutineは`sns-pipeline-blog.md`が生成したブログ本文に依存する**（note下書きはブログ記事をnote形式に変換して作る設計、既存の`content-multi-channel-pipeline-prompt.md`の設計を踏襲）。ブログ側がまだ生成していない場合は本Routineは**生成せず、claimしたターゲットを`pending`に戻して次回ポーリングに委ねる**（note-YouTube動画の依存関係と同じ「未完了ならスキップ」方式、2026-09-03合意）。

**新機能ネタ（`new-feature`型）の場合のみ、動画埋め込み型（`docs/operation/note-video-producer-prompt.md`）を使う**。本Routineが現時点で扱う型（`venue-feature`/`daily-auto`）は画像＋本文型のみを対象とする。将来`new-feature`型の週次/日次提案が追加された場合は、この節を拡張して`note-video-producer-prompt.md`の制作フローに分岐させる。

## 実行トリガー

- 週次型（`venue-feature`）: 12時間おきのcronでポーリングする
- 日次・一般型（`daily-auto`）: 日次自動提案Routineの完了後にポーリングする
- API起動（revise/redo）: `api/admin/sns-hub/drafts/[id]/revise.js`・`redo.js`（`platform='note'`の下書きのみ）

## 0. 蓄積されたフィードバックの確認

- `getRecentRevisions({ platform: "note" })`（`scripts/lib/contentRevisionHistory.js`）
- `getActiveInsights({ platform: "note" })`（`scripts/lib/snsStrategyInsights.js`）

## 1. claim対象の取得・claim

`docs/operation/sns-pipeline-x.md`の「1.」と同じ手順。`platform='note'`のアカウントIDで`getClaimableTopicTargets()`を呼ぶ。1回の実行で処理するのは1件まで。

## 2. ブログ本文の生成状況を確認（依存関係チェック）

claimしたターゲットの`topic_id`と同じ`sns_topics.id`（`sns_drafts.content_group_id`経由）を持つ、`platform='blog'`の`sns_drafts`行を確認する。

- **見つからない場合**: `updateTopicTargetLabel`相当の操作で、claimしたターゲットの`status`を`pending`に戻し（再度ポーリング対象になる）、`claimed_by`/`claimed_at`をクリアする。今回は何も生成せず終了する（エラーではない、正常系）
- **見つかった場合**: そのブログ記事本文を3.以降の入力として使う

## 3. note下書きへの変換

1. 2.で取得したブログ本文を、`convert_to_note_markdown.py`と同じ変換ロジックでnote向けフォーマットに変換する（見出し記法・埋め込み構文の違いを吸収。完全一致はさせない）
2. カバー画像は、ブログ側の`sns_drafts.cover_image_path`と同じ画像を使う（同一ネタのため使い回してよい、`docs/reference/brand-kit.md`のトーン統一目的とも合致）
3. タグを付与する

## 4. 下書きの永続化

`sns_drafts`テーブルにINSERTする。`content_group_id`はブログ行・claimしたネタの`sns_topics.id`と同じ値を使う。列: `platform`（'note'）・`format`（ブログ行と同じ、'screenshot'または'data-card'）・`title`・`caption_text`（note本文）・`cover_image_path`・`status`（'pending_review'）・`routine_run_id`

## 5. claimしたターゲットの完了処理

`markTopicTargetGenerated(targetId, draftId)`（`scripts/lib/snsTopics.js`）を呼ぶ。

## 制約（絶対厳守）

- 1回の実行で処理するネタは1件まで
- ブログ本文が未生成の場合は生成せず、ターゲットを`pending`に戻す（claimしたまま放置しない）
- 「競艇」表記禁止（本文は「ボートレース」）
- 本文に画像を必ず含める（文字だけの下書きにしない）
