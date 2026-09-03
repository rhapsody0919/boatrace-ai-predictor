# Xチャネル別パイプライン 制作ガイド

承認済みネタ（`sns_topics.status='approved'`）のうち、X向けに割り当てられた`sns_topic_targets`をポーリングして下書きを生成するRoutine向けの実行手順。設計背景は[`docs/design/sns-topic-gate/`](../design/sns-topic-gate/)（spec.md/plan.md、ADR 0036〜0038）を参照。チャネル別パイプライン分離の最初の1本（ADR 0037）として、note/blog/tiktok/youtubeへの展開時もこのドキュメントの構成をテンプレートにする。

**このRoutineはネタを自分で選定しない**。`sns-topic-proposer-weekly.md`・`sns-topic-proposer-daily-auto.md`・sns-hubの手動生成ボタン（日次・時間制約型、実装後）のいずれかが作った承認済みネタを拾って生成するだけの、疎結合な下流工程。

## 実行トリガー

- 週次型（`venue-feature`）: 12時間おきのcronでポーリングする（初期値、運用実績を見て変更可）
- 日次・一般型（`daily-auto`）: 日次自動提案Routineの完了後にポーリングする（同じcron間隔でも自然に拾える）
- 日次・時間制約型（`race-time-critical`）: このパイプラインでは扱わない。既存の`sns-hub-content-generation`（`sns-video-producer-prompt.md`）の手動生成ボタン系が担当する（type選択UIの実装後）

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
- claim対象が0件、または実データの裏付けが取れない場合は生成せず終了する（見送りであり不具合ではない）。claim済みのまま放置しない（claim解放の仕組みは未実装のため、途中で断念する場合は`sns_topic_targets.status`を`pending`に手動で戻す）
- masterへの直接コミット・マージは行わない（このRoutineはデータ登録のみで、コード変更を伴わない）
- 「競艇」表記禁止、射幸心を煽らない、実データ以外は使わない（`sns-video-producer-prompt.md`絶対厳守1〜3と同じ）
