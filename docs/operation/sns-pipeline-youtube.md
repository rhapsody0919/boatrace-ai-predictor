# YouTubeチャネル別パイプライン 制作ガイド

承認済みネタ（`sns_topics.status='approved'`）のうち、YouTube向けに割り当てられた`sns_topic_targets`をポーリングして動画下書きを生成するRoutine向けの実行手順。設計背景は[`docs/design/sns-topic-gate/`](../design/sns-topic-gate/)（spec.md/plan.md、ADR 0036〜0038）を参照。`docs/operation/sns-pipeline-x.md`と同じ構成をテンプレートにしている。

**このRoutineは下書き（`sns_drafts`、`status='pending_review'`）を作るところまでが責務**。承認後の実際のYouTubeへのアップロード・公開は、既存の`api/admin/sns-hub/drafts/[id]/publish-youtube.js`（YouTube Data API v3、ADR 0035）が承認操作をトリガーに自動で行う。このRoutine自身はYouTubeへの投稿を一切行わない。

## 実行トリガー

- 週次型（`venue-feature`）: 1時間おきのcronでポーリングする（2026-09-05、初期値の12時間おきから変更）
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

**YouTube向けはShorts（9:16、1080x1920、尺15〜30秒）で構成する**（2026-09-05変更。旧方針の16:9・12〜15秒は、YouTubeアルゴリズム調査（`docs/reference/youtube-algorithm-and-growth-notes.md`）でロングフォーム（週次ケイデンス・セッション貢献重視）ともShorts（完視聴率重視）とも評価軸が噛み合わない中途半端な出力だったと判明したため。ロングフォーム化は深い企画・シリーズ構成・週1〜3本の継続制作能力がゼロから必要になるのに対し、Shorts化は既存のX/TikTok向け制作基盤（フック構成・縦型テンプレート）をほぼそのまま流用でき、YouTube唯一の強みであるAPI自動投稿（承認後`publish-youtube.js`が自動実行）を活かした高頻度投稿とも相性が良いため、Shorts化をユーザーと合意した）。

`sns-video-producer-prompt.md`で確立済みの技術手順を踏襲する（`sns-pipeline-x.md`の「3.」と同じレンダリング手順・同じ9:16テンプレート群がそのまま使える）。

- ネタの型に応じたフォーマットを選ぶ（`venue-feature`型は`VenueRankingTemplate`系を優先）
- `sns-video-studio/remotion/risk-rules.json`を照合し、該当があれば`risk_flags`に記録する
- `sns-video-producer-prompt.md`の「セルフレビュー チェックリスト」で自己採点する。**尺の基準（12〜15秒）はTikTok/X向けの目安であり、YouTube Shorts側は完視聴率を最大化する目的の範囲内で15〜30秒まで許容する**（尺そのものをPass/Fail項目として絶対視しない。詳細は`sns-video-producer-prompt.md`の該当セクション参照）

## 4. カバー画像の生成

**Shorts化に伴い、専用サムネイル（Remotion別コンポジション）の生成ステップを廃止する**（2026-09-05）。TikTok/Xと同様、`ffmpeg -vf "select='eq(n\,0)'" -vframes 1`で動画のframe=0を書き出し、それを`cover_image_path`として使う（`sns-video-producer-prompt.md`セルフレビューチェックリスト「frame=0で主要テキスト・マスコットが完全に見えているか」を参照、3.の映像設計時点で確認済みであること）。旧`COMPOSITION_IDS.youtubeThumbnail`（1280×720、16:9）は新しいShorts比率と合わなくなったため、このRoutineでは使用しない。

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
- **非認証ギャンブルサイトへの誘導が無いか・的中率表現が利益保証と誤解されないかを自己点検する**（2026-09-05追加、`docs/reference/youtube-algorithm-and-growth-notes.md`の反映候補を実装。TikTokの`sns-pipeline-tiktok.md`と同種のポリシーチェックをYouTube側にも明記）
- **このRoutineはYouTubeへの実際の投稿・公開は一切行わない**（承認時に`publish-youtube.js`が自動で行う）
