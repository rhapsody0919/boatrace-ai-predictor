# Xチャネル別パイプライン 制作ガイド

承認済みネタ（`sns_topics.status='approved'`）のうち、X向けに割り当てられた`sns_topic_targets`をポーリングして下書きを生成するRoutine向けの実行手順。設計背景は[`docs/design/sns-topic-gate/`](../design/sns-topic-gate/)（spec.md/plan.md、ADR 0036〜0038）を参照。チャネル別パイプライン分離の最初の1本（ADR 0037）として、note/blog/tiktok/youtubeへの展開時もこのドキュメントの構成をテンプレートにする。

**このRoutineはネタを自分で選定しない**。`sns-topic-proposer-weekly.md`・`sns-topic-proposer-daily-auto.md`・sns-hubの手動生成ボタン（日次・時間制約型、実装後）のいずれかが作った承認済みネタを拾って生成するだけの、疎結合な下流工程。

## 実行トリガー

このRoutineは2つの起動方法を持つ。まず`<routine-fire-payload>`ブロックの有無を確認する。

- **無い場合（スケジュール起動）**: 定期ポーリング。以下「0.」以降にそのまま進む
  - 週次型（`venue-feature`）: 12時間おきのcronでポーリングする（初期値、運用実績を見て変更可）
  - 日次・一般型（`daily-auto`）: 日次自動提案Routineの完了後にポーリングする（同じcron間隔でも自然に拾える）
  - 日次・時間制約型（`race-time-critical`）: このパイプラインでは扱わない。既存の`sns-hub-content-generation`（`sns-video-producer-prompt.md`）の手動生成ボタン系が担当する（type選択UIの実装後）
- **ある場合（API起動）**: ペイロードの`action`で分岐する
  - `revise`/`redo`: `api/admin/sns-hub/drafts/[id]/revise.js`・`redo.js`（ADR 0038、`resolveRoutineEnvPrefix`で`platform='x'`の下書きのみこのRoutineに発火する）からの「一部修正」「全部作り直し」操作。ペイロード（`{action: 'revise'|'redo', draftId, reasonCodes, freeText}`）を読み、下記「A'. 修正対応フロー」に進む（0.〜6.はスキップ）
  - `generate_now`: `api/admin/sns-hub/topics/[id]/targets/[targetId]/fire.js`（要件26、「⚡今すぐ生成」ボタン）からの即時生成リクエスト。ペイロード（`{action: 'generate_now', targetId}`）を読み、下記「A''. 即時生成フロー」に進む（0.はそのまま実施、1.をスキップして2.以降に進む）

### A'. 修正対応フロー（API起動時）

`sns-hub-content-generation`（`docs/operation/sns-video-producer-prompt.md`が担うRoutine）の同種フローと同じ設計思想を踏襲する。

- `revise`: `draftId`の下書きを取得し、`reasonCodes`/`freeText`を反映して修正版を再生成する（3.以降と同じ映像設計・レンダリング手順）。新レコードをINSERT（`parent_draft_id`に元の`draftId`、`content_group_id`は元の下書きと同じ値を維持、`status: 'pending_review'`）し、元レコードを`status: 'archived'`・`archived_at`更新する
- `redo`: 同様だが題材選定からやり直す。元の下書きに紐づく`sns_topic_targets`行を確認し、まだ`generated`のままなら`pending`に戻して1.のclaimを再実行するか、同じネタのまま作り直すかは`freeText`の内容から判断する（「別のネタにしてほしい」という指摘であれば、対応する`sns_topic_targets`を`skipped`にし、人間に別ネタの承認を委ねる）

### A''. 即時生成フロー（API起動時、要件26）

対象は既に`status='pending'`であることがAPI側（`fire.js`）で検証済みの1件のみ。ポーリング起動の「1. claim対象の取得・claim」を丸ごとスキップし、`claimTopicTarget(targetId, routineRunId)`（`scripts/lib/snsTopics.js`）を`targetId`に対して直接呼ぶ。**戻り値がnullの場合**（ボタンを押した直後に通常ポーリングの別実行に先取りされた等）は、生成を行わずそのまま終了する（エラーではない、ADR 0036と同じ扱い）。claimに成功したら「2. ネタ本文・根拠insightの確認」以降は通常フローと同一。

## 0. 蓄積されたフィードバックの確認

- `getRecentRevisions({ platform: "x" })`（`scripts/lib/contentRevisionHistory.js`）で直近30日の修正依頼・却下理由を取得する
- `getActiveInsights({ platform: "x" })`（`scripts/lib/snsStrategyInsights.js`）でactiveな戦略insightを取得する
- どちらも該当が無ければ通常通り進めてよい

## 1. claim対象の取得・claim

1. `sns_target_accounts`から`platform='x'`のアカウントIDを取得する
2. `getClaimableTopicTargets(xAccountId)`（`scripts/lib/snsTopics.js`）で、claim可能な（承認済みネタに紐づくpending状態の）ターゲット一覧を取得する
3. このRoutine実行の一意な識別子（`routineRunId`）を1つ生成し、以降のclaim呼び出しすべてで使い回す
4. 取得した各ターゲットについて`claimTopicTarget(targetId, routineRunId)`（同ファイル）を呼ぶ。**戻り値がnullの場合は他のパイプライン実行に先取りされたということなのでスキップする**（エラーではない、ADR 0036）
5. claimに成功したターゲットのうち、**1回の実行で処理するのは1件まで**（頻度上限、トークン消費を抑えるため）。複数claimできてしまった場合は2件目以降を`pending`に戻す（`updateTopicTargetLabel`相当の操作、または単純に未処理のまま次回実行に委ねる）

claim対象が0件の場合はここで終了する（正常系、失敗ではない）。

## 2. ネタ本文・根拠insightの確認

`sns_topics`テーブルから、claimしたターゲットに紐づくネタ本文（`topic_text`）・型（`content_type_id`経由で`sns_content_types`）・根拠insight（`source_insight_ids`）を取得する。0.で確認済みのX向け却下理由・insightと合わせて、構成・訴求の判断材料にする。

## 3. 実データ取得・映像設計

`sns-video-producer-prompt.md`で確立済みの技術手順をそのまま踏襲する（車輪の再発明をしない）。

- DBに実データがあることと、本番UIで実際に表示・再現できることは別物。台本確定前に必ずPlaywrightで実際の画面を確認する（同ドキュメント「制作フロー」2.参照）
- ネタの型に応じたフォーマットを選ぶ:
  - `venue-feature`型: `VenueRankingCM.jsx`の`VenueRankingTemplate`（ランキング・比較型）を優先して再利用する
  - `daily-auto`型: ネタの内容に応じて既存フォーマットライブラリ（`sns-video-producer-prompt.md`「フォーマットライブラリ」節）から最も近いものを選ぶ。新しいデータ形状の場合のみ新規コンポジションを検討する
- X向けは9:16（1080x1920）
- `sns-video-studio/remotion/`でのレンダリング手順（Chromiumヘッドレスシェルの指定、ffmpeg導入）は同ドキュメント「制作フロー」4.と同じ
- `sns-video-studio/remotion/risk-rules.json`の各ルールを照合する。該当があれば`risk_flags`に記録する（ブロックしない、警告記録のみ）
- 同ドキュメントの「セルフレビュー チェックリスト」で自己採点し、Failがあれば直して再レンダリングする

## 4. キャプション・ハッシュタグ

`docs/operation/x-operations-playbook.md`「投稿設計の優先順位」に従う。公式告知単体にせず、推し活・体験談・データの体系整理のいずれかの切り口を必ず添える。本文には視聴者が反応したくなる「問いかけ」を1つ入れる。

## 5. アップロード・永続化

- Supabase Storageの非公開バケット`sns-hub-media`に動画・カバー画像をアップロードする（パス例: `{content_group_id}/x-ja.mp4`）
- `sns_drafts.video_storage_path`/`cover_image_path`には**生のStorageパスをそのまま保存する**（署名付きURLを保存しない、`.claude/rules/sns-content-generation.md`参照）
- `sns_drafts`テーブルにINSERTする。列: `content_group_id`（claimしたネタの`sns_topics.id`をそのまま使う）・`format`（ビジュアルテンプレート名のみ、3.で選んだフォーマット名。ネタ種別を入れない）・`template_variant_id`・`language`（'ja'）・`platform`（'x'）・`status`（'pending_review'）・`video_storage_path`・`cover_image_path`・`caption_text`・`hashtags`・`background_text`・`source_data`・`risk_flags`・`routine_run_id`（1.で生成した識別子）

## 6. claimしたターゲットの完了処理

`markTopicTargetGenerated(targetId, draftId)`（`scripts/lib/snsTopics.js`）を呼び、5.で作成した下書きのIDを紐付ける。これで進捗マトリクスUIに`generated`として反映される。

## 制約（絶対厳守）

- 1回の実行で処理するネタは1件まで
- **1つのclaim済みターゲットにつき、`sns_drafts`行は必ず1件だけ作る**。生成後に内容の誤り・前提の古さ（レース結果が出た後だった等）に自分で気づいた場合も、同一セッション内で2件目の`sns_drafts`行を作り直さない。6.の完了処理（`markTopicTargetGenerated`）を済ませたら、その回の生成物が最終版であり、修正が必要なら人間の下書き承認画面からのrevise/redo操作（A'節）に委ねる（2026-09-03、Blogパイプラインで同一セッション内に2件のPRが作られる不具合が発生し判明）
- claim対象が0件、または実データの裏付けが取れない場合は生成せず終了する（見送りであり不具合ではない）。claim済みのまま放置しない（claim解放の仕組みは未実装のため、途中で断念する場合は`sns_topic_targets.status`を`pending`に手動で戻す）
- masterへの直接コミット・マージは行わない（このRoutineはデータ登録のみで、コード変更を伴わない）
- 「競艇」表記禁止、射幸心を煽らない、実データ以外は使わない（`sns-video-producer-prompt.md`絶対厳守1〜3と同じ）
