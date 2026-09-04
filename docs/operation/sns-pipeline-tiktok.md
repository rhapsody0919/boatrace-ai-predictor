# TikTokチャネル別パイプライン 制作ガイド

承認済みネタ（`sns_topics.status='approved'`）のうち、TikTok向けに割り当てられた`sns_topic_targets`をポーリングして下書きを生成するRoutine向けの実行手順。設計背景は[`docs/design/sns-topic-gate/`](../design/sns-topic-gate/)（spec.md/plan.md、ADR 0036〜0038）を参照。`docs/operation/sns-pipeline-x.md`と同じ構成をテンプレートにする。

**このRoutineはネタを自分で選定しない**。`sns-topic-proposer-weekly.md`・`sns-topic-proposer-daily-auto.md`が、扱う題材の型（`sns_topic_categories.category_key`）を分類し、その型のTikTok設定（`sns_topic_category_channels`、sns-hub「ネタ型設定」画面でユーザーが編集）に従って作った承認済みネタを拾って生成するだけの、疎結合な下流工程（2026-09-03、以前のchannelMatrix.js + isGamblingRelevantフラグから型×チャネルのデータ駆動設定に変更）。

このRoutineがclaimできるのは、対応する型のTikTok設定がON、または人間がsns-hub「ネタ承認」画面のチャネルトグルで個別にpendingへ変更したターゲットのみ。

## 実行トリガー

このRoutineは2つの起動方法を持つ。まず`<routine-fire-payload>`ブロックの有無を確認する。

- **無い場合（スケジュール起動）**: 定期ポーリング
  - 週次型（`venue-feature`）: 12時間おきのcronでポーリングする（初期値、運用実績を見て変更可）
  - 日次・一般型（`daily-auto`）: 日次自動提案Routineの完了後にポーリングする（同じcron間隔でも自然に拾える）
  - 日次・時間制約型（`race-time-critical`）: このパイプラインでは扱わない。既存の`sns-hub-content-generation`（`sns-video-producer-prompt.md`）の手動生成ボタン系が担当する
- **ある場合（API起動）**: ペイロードの`action`で分岐する
  - `redo`: `api/admin/sns-hub/drafts/[id]/redo.js`（ADR 0038、`resolveRoutineEnvPrefix`で`platform='tiktok'`の下書きのみこのRoutineに発火する）からの修正指摘操作（2026-09-04、旧「一部修正」`revise.js`と統合済み）。ペイロード（`{action: 'redo', draftId, reasonCodes, freeText}`）を読み、`sns-pipeline-x.md`の「A'. 修正対応フロー」と同じ思想で対応する（0.〜6.はスキップ）
  - `generate_now`: `api/admin/sns-hub/topics/[id]/targets/[targetId]/fire.js`（要件26、「⚡今すぐ生成」ボタン）からの即時生成リクエスト。ペイロード（`{action: 'generate_now', targetId}`）を読み、`sns-pipeline-x.md`の「A''. 即時生成フロー」と同じ思想で対応する（1.をスキップして2.以降に進む）

## 0. 蓄積されたフィードバックの確認

- `getRecentRevisions({ platform: "tiktok" })`（`scripts/lib/contentRevisionHistory.js`）で直近30日の修正依頼・却下理由を取得する
- `getActiveInsights({ platform: "tiktok" })`（`scripts/lib/snsStrategyInsights.js`）でactiveな戦略insightを取得する
- どちらも該当が無ければ通常通り進めてよい

## 1. claim対象の取得・claim

`sns-pipeline-x.md`の「1.」と同じ手順。`platform='tiktok'`のアカウントIDで`getClaimableTopicTargets()`を呼ぶ。1回の実行で処理するのは1件まで。

## 2. ネタ本文・根拠insightの確認・TikTok可否の最終セルフチェック

`sns-pipeline-x.md`の「2.」と同じ手順に加えて、**このRoutine自身でもう一度TikTok可否を確認する**（提案Routine側の判定を無条件に信用しない、二重チェック）。

- claimしたネタの`content_type_id`・題材から、対応する`sns_topic_categories`行を確認する。`active=false`（廃止済み、例: 対決煽り型）の型に該当する内容だと分かった場合は、`sns_topic_category_channels`の設定に関わらず**必ず生成せずskipする**
- `docs/operation/sns-video-producer-prompt.md`絶対厳守13の判断基準（「この数字・情報は、視聴者が今日の賭け目を選ぶ判断材料に直結するか？」）にYesと言える内容なら、**このターゲットは生成せず`markTopicTargetSkipped(targetId, reason)`でskip_reasonに理由を記録して終了する**（claimしたまま放置しない）
- 迷う場合も安全側（skip）に倒す

## 3. 実データ取得・映像設計

`sns-pipeline-x.md`の「3.」と同じ手順を踏襲する。

- TikTok向けも9:16（1080x1920）
- `sns-video-studio/remotion/risk-rules.json`の各ルールを照合する。該当があれば`risk_flags`に記録する（ブロックしない、警告記録のみ）
- 同ドキュメントの「セルフレビュー チェックリスト」で自己採点し、Failがあれば直して再レンダリングする

## 4. キャプション・ハッシュタグ

`docs/operation/sns-viral-copywriter-prompt.md`のTikTok向けセクションに従う（未整備の場合は`x-operations-playbook.md`の「投稿設計の優先順位」に準じる）。

## 5. アップロード・永続化

- Supabase Storageの非公開バケット`sns-hub-media`に動画・カバー画像をアップロードする（パス例: `{content_group_id}/tiktok-ja.mp4`）
- `sns_drafts.video_storage_path`/`cover_image_path`には**生のStorageパスをそのまま保存する**（署名付きURLを保存しない、`.claude/rules/sns-content-generation.md`参照）
- `sns_drafts`テーブルにINSERTする。列: `content_group_id`（claimしたネタの`sns_topics.id`をそのまま使う）・`format`（ビジュアルテンプレート名のみ、3.で選んだフォーマット名）・`template_variant_id`・`language`（'ja'）・`platform`（'tiktok'）・`status`（'pending_review'）・`video_storage_path`・`cover_image_path`・`caption_text`・`hashtags`・`background_text`・`source_data`・`risk_flags`・`routine_run_id`

## 6. claimしたターゲットの完了処理

`markTopicTargetGenerated(targetId, draftId)`（`scripts/lib/snsTopics.js`）を呼び、5.で作成した下書きのIDを紐付ける。

## 制約（絶対厳守）

- 1回の実行で処理するネタは1件まで
- **1つのclaim済みターゲットにつき、`sns_drafts`行は必ず1件だけ作る**（`sns-pipeline-x.md`と同じ制約、2026-09-03の重複生成インシデントを踏まえる）
- claim対象が0件、または実データの裏付けが取れない場合は生成せず終了する（見送りであり不具合ではない）
- **2.のTikTok可否セルフチェックで疑わしいと判断したら、必ずskipする**。「賭けの結果に影響する統計・インサイト」を扱うコンテンツはガイドライン違反での削除・アカウント制限に直結する実績があるため、他チャネル以上に保守的に判断する（`docs/operation/tiktok-posting-operations.md`D・F節参照）
- **このRoutineはTikTokへの実際の投稿・公開は一切行わない**（TikTokには公開APIが無いため、承認後は`docs/operation/tiktok-posting-operations.md`B節の手順で人間の確認を経て手動アップロードする）
- masterへの直接コミット・マージは行わない（このRoutineはデータ登録のみで、コード変更を伴わない）
- 「競艇」表記禁止、射幸心を煽らない、実データ以外は使わない
