# Noteチャネル別パイプライン 制作ガイド

承認済みネタ（`sns_topics.status='approved'`）のうち、note向けに割り当てられた`sns_topic_targets`をポーリングしてnote下書きを生成するRoutine向けの実行手順。設計背景は[`docs/design/sns-topic-gate/`](../design/sns-topic-gate/)（spec.md/plan.md、ADR 0036〜0038）を参照。`docs/operation/sns-pipeline-x.md`と同じ構成をテンプレートにしている。

**このRoutineは`sns-pipeline-blog.md`が生成したブログ本文に依存する**（note下書きはブログ記事をnote形式に変換して作る設計）。ブログ側がまだ生成していない場合は本Routineは**生成せず、claimしたターゲットを`pending`に戻して次回ポーリングに委ねる**（note-YouTube動画の依存関係と同じ「未完了ならスキップ」方式、2026-09-03合意）。

**YouTube動画URLについて（2026-09-03追加）**: noteはURLをそのまま貼ると自動でプレイヤーが展開され、文章だけの下書きより視覚的にわかりやすくなる。ただし**生成時点でYouTube公開を待つブロッキング依存にはしない**（YouTube側は人間の承認が必要なため、待つと生成が大幅に遅れる）。同じネタのYouTube下書きが承認・公開済みであれば、sns-hub管理画面の投稿導線（「YouTube動画URLをコピー」ボタン）で人間が投稿時にコピーして本文に貼り付けられる。このRoutine自身が本文中にURLを埋め込む必要は無い。

**新機能ネタ（`new-feature`型）の場合のみ、動画埋め込み型（`docs/operation/note-video-producer-prompt.md`）を使う**。本Routineが現時点で扱う型（`venue-feature`/`daily-auto`）は画像＋本文型のみを対象とする。将来`new-feature`型の週次/日次提案が追加された場合は、この節を拡張して`note-video-producer-prompt.md`の制作フローに分岐させる。

**note下書きの承認・公開ペースについて（2026-09-05追加）**: `docs/reference/note-algorithm-and-growth-notes.md`の調査により、noteは投稿頻度の期待値がX（1日4本以下）・TikTok（1日6本上限）と全く異なり、**週2回程度**が読者・レコメンド双方の観点で目安とされる。本Routine自身のポーリング頻度（1時間おき等）は下書きの**生成**ペースであり、下書きが溜まること自体は問題ない。sns-hub管理画面で下書きを**承認・公開する側**が、週2回程度のペースを目安に間引いて選ぶことを想定する（生成された下書きを機械的に全件即承認しない）。

## 実行トリガー

- 週次型（`venue-feature`）: 1時間おきのcronでポーリングする（2026-09-05、初期値の12時間おきから変更）
- 日次・一般型（`daily-auto`）: 日次自動提案Routineの完了後にポーリングする
- API起動（修正指摘）: `api/admin/sns-hub/drafts/[id]/redo.js`（2026-09-04、旧revise.jsと統合済み）（`platform='note'`の下書きのみ）
- API起動（今すぐ生成、要件26）: `api/admin/sns-hub/topics/[id]/targets/[targetId]/fire.js`からのペイロード（`{action: 'generate_now', targetId}`）。`status='pending'`であることは検証済みの1件のみが対象。「1. claim対象の取得・claim」を丸ごとスキップし、`claimTopicTarget(targetId, routineRunId)`（`scripts/lib/snsTopics.js`）を`targetId`に対して直接呼ぶ（`docs/operation/sns-pipeline-x.md`の「A''. 即時生成フロー」と同じ思想）。戻り値がnullなら生成せず終了する（ADR 0036）

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

1. 2.で取得したブログ本文を、`convert_to_note_markdown.py`と同じ変換ロジックでnote向けフォーマットに変換する（見出し記法・埋め込み構文の違いを吸収。完全一致はさせない）。**ブログ本文をそのまま機械変換するだけで終わらせず、note側の一次情報性重視の評価方針（`docs/reference/note-algorithm-and-growth-notes.md`）に合わせて、実データ・独自分析であることが伝わる一人称寄りの導入文に調整する**（2026-09-05追加）
2. **タイトルは15〜25文字程度に収める**（2026-09-05追加、`note-algorithm-and-growth-notes.md`より。ブログ側のタイトルをそのまま流用せず、note向けに短縮・調整する）
3. カバー画像は、ブログ側の`sns_drafts.cover_image_path`と同じ画像を使う（同一ネタのため使い回してよい、`docs/reference/brand-kit.md`のトーン統一目的とも合致）
4. **ハッシュタグは2〜4個、ジャンル大タグ（`#ボートレース` `#ボートレース予想`等）と龍神レーダー独自タグを組み合わせる**（2026-09-05追加、`note-algorithm-and-growth-notes.md`より。「競艇」表記はハッシュタグでも使わない、TikTokと同じ理由）

## 4. 下書きの永続化

`sns_drafts`テーブルにINSERTする。`content_group_id`はブログ行・claimしたネタの`sns_topics.id`と同じ値を使う。列: `platform`（'note'）・`format`（ブログ行と同じ、'screenshot'または'data-card'）・`title`・`caption_text`（note本文）・`cover_image_path`・`status`（'pending_review'）・`routine_run_id`

## 5. claimしたターゲットの完了処理

`markTopicTargetGenerated(targetId, draftId)`（`scripts/lib/snsTopics.js`）を呼ぶ。

## 制約（絶対厳守）

- 1回の実行で処理するネタは1件まで
- **1つのclaim済みターゲットにつき、`sns_drafts`行は必ず1件だけ作る**。生成後に内容の誤りに自分で気づいた場合も、同一セッション内で2件目を作り直さない。5.の完了処理（`markTopicTargetGenerated`）を済ませたら、その回の生成物が最終版であり、修正は人間の下書き承認画面からの修正指摘操作に委ねる（2026-09-03、Blogパイプラインで同種の不具合が発生し判明。本パイプラインにも同じ制約を横展開）
- ブログ本文が未生成の場合は生成せず、ターゲットを`pending`に戻す（claimしたまま放置しない）
- 「競艇」表記禁止（本文は「ボートレース」）
- 本文に画像を必ず含める（文字だけの下書きにしない）
