# タスク分解

依存順に並べる。`⚠️`は自律進行モードでも実行前にユーザー確認が必要なタスク（不可逆操作・実運用中UIの破壊的変更・ユーザー自身のログインが必要な設定）。

## 基盤（スキーマ・共通ロジック）

- [x] 1. `docs/db-migration/042_content_drafts_columns.sql`をSupabaseへ適用 — ユーザー実施済み、`sns_drafts`に`title`/`embed_video_url`/`pr_url`列の存在を確認済み（2026-09-01）
- [x] 2. `scripts/lib/contentTopics/`実装（レジストリ+4モジュール: 新機能/会場特性/データ知見/成績）— 動作確認済み（new-feature:0件/venue-characteristic:96件/data-insight:17件/daily-result:0件、いずれも想定通り）
- [x] 3. `data/analysis/content-topics/`履歴JSON初期化 — 実装は遅延生成方式（`recordUsage`初回呼び出し時に自動作成）のため、事前の個別初期化は不要と判断
- [x] 4. `scripts/lib/contentChannels/channelMatrix.js`実装（ネタ種別→チャネル対応表）— 動作確認済み
- [x] 5〜6・8. **設計を修正**: ブログ/note本文の執筆・品質採点は決定的なJS関数にできない（LLM判断そのもののため）。既存の`sns-video-producer-prompt.md`等と同じ形式の運用プロンプト文書として実装した: [`docs/operation/content-multi-channel-pipeline-prompt.md`](../../operation/content-multi-channel-pipeline-prompt.md)（ネタ選定・チャネル選定・ブログ執筆・note変換・多層品質レビュー・下書き永続化・履歴更新の手順を網羅）。当初`renderer.js`/`contentQualityReview.js`という実装方針を計画していたが、実装段階で「文章生成・品質判断はコードにできない」ことを踏まえ方針転換
- [x] 7. YouTubeサムネイル生成のRemotion still実行スクリプト — 当初想定していた`youtubeThumbnail.js`単体ではなく、`renderCoverCard.js`（task 34）＋`DataQuoteCard-YouTubeThumbnail`コンポジション（task 32）として実装済みだったと2026-09-02判明。実際にこの仕組みで`technique-consistency-youtube-thumb.jpg`を生成し使用済み（動作確認済み）

## Routine

- [x] 9. 新規Routine `content-multi-channel-pipeline`のプロンプト作成・one-offテスト実行 — 完走を確認（2026-09-01）。新機能ネタ0件のためデータ知見系（出目分布タブ）を選定→blog/note/xチャネルを選定→実データ（過去90日24会場13,386走）で執筆→`race_results`テーブルから独立再計算し数値完全一致を確認→`sns_drafts`に実INSERT（`content_group_id`共有、`pr_url`列も正しく保存）→Draft [PR #471](https://github.com/rhapsody0919/boatrace-ai-predictor/pull/471)作成まで成功。検証後PRはクローズ、DB行は削除依頼済み
- [ ] 10. one-offテスト結果を確認し、問題なければ毎晩cron実行として標準運用に組み込む ⚠️（標準運用化の最終判断）
- [x] 11. 既存Routine`sns-hub-content-generation`の`generate-daily`/`generate-evergreen`にYouTube対応を追加（`api/admin/sns-hub/generate.js`の`VALID_PLATFORMS`に`"youtube"`追加）

## 管理画面

- [x] 12. `SnsHubAdmin.jsx`のタブ構成をプラットフォーム軸に再構成 — ユーザー承認済み。TikTok/X/YouTube/Note/Blog/戦略メモ/フォーマットカタログの7タブ＋ステータス副フィルタで実装、モックデータでの表示検証済み（screenshot確認済み）
- [x] 13. `TextDraftPreview`（ブログ/note下書きプレビュー）実装 — 表示検証済み
- [x] 14. `CopyToClipboardButton`実装
- [x] 15. `ThumbnailPreview`実装 — 表示検証済み
- [x] 16. `RevisionPanel`の`REVISION_REASONS`にblog/note向け理由コード追加（`CONTENT_REVISION_REASONS`）
- [x] 17. `GENERATE_PLATFORM_OPTIONS`に`youtube`追加 — 表示検証済み

## 外部連携（承認アクション）

- [x] 18. `GITHUB_MERGE_TOKEN`発行（Fine-grained PAT、ADR 0034） — 発行・Vercel登録完了（2026-09-02）
- [x] 19. `api/admin/sns-hub/drafts/[id]/merge-blog-pr.js`実装（実クレデンシャル未設定のため実行時テストは未実施、コードレベルの実装完了）
- [x] 20. `BlogApproveAction`コンポーネント実装・`snsHubService.js`に`mergeBlogPr()`追加 — ボタン文言・確認ダイアログ込みで表示検証済み
- [x] 21. Google Cloud ConsoleでYouTube Data API v3有効化・OAuth同意・リフレッシュトークン取得（ADR 0035） — 完了（2026-09-02）。当初デスクトップアプリ型クライアントでOAuth Playground認可を試み`redirect_uri_mismatch`が発生、ウェブアプリケーション型クライアント（`content-pipeline-youtube-upload-web`）を作り直して解決。`YOUTUBE_CLIENT_ID`/`YOUTUBE_CLIENT_SECRET`/`YOUTUBE_REFRESH_TOKEN`をVercelに登録済み
- [x] 22. `api/admin/sns-hub/drafts/[id]/publish-youtube.js`実装（実クレデンシャル未設定のため実行時テストは未実施。動画サイズが大きい場合Edge Function実行時間制約に抵触する可能性がありコード内に注記済み）
- [x] 23. `YouTubeApproveAction`コンポーネント実装・`snsHubService.js`に`publishYoutube()`追加 — 表示検証済み

## 品質監査・調査ループ

- [x] 24. `session-start-check.js`に`checkContentQualityAudit()`追加（FR4b、公開済みコンテンツの抜き打ち監査）— 直近60日公開のブログ記事から未監査優先で1〜2件提示、動作確認済み
- [x] 25. `scripts/lib/snsStrategyInsights.js`の呼び出し元（`/growth-pdca`等）でblog/noteスコープのinsight書き込みに対応 — `createInsight`自体は`platform`列に制約が無く元々対応済みだったため、`/growth-pdca`にステップ7（小施策のinsight登録、platform:'blog'/'note'）を追加、生成側プロンプト（3.ブログ本文執筆）に`getActiveInsights({platform:"blog"})`参照を追加して閉じたループにした

## ドキュメント更新

- [x] 26. `docs/reference/brand-kit.md`にblog/note向けの制作ルール節を追加（着手前の参照先として）— 既存ルールへの参照リンクを一元化する形で追加
- [x] 27. `.claude/CLAUDE.md`フローAにこのパイプラインの運用手順を追記（`docs/operation/content-multi-channel-pipeline-prompt.md`への参照込み）
- [x] 28. `docs/operation/content-pipeline-token-setup-guide.md`にGitHub PAT・YouTube OAuthの取得手順を追加（ローテーション運用の記載は今後の課題として残す）

## 検証

- [x] 29. `npm run build`成功確認 — 成功（2026-09-02、task 18/21実装分含む再確認）
- [x] 30. E2Eスモークテスト実行（既存の管理画面ルーティングに影響が無いか）— 886件成功・16件失敗、失敗は全てこのworktreeにSupabase接続情報が無いことによる既存ページの実行時エラーで今回の変更と無関係（admin関連の失敗なし、2026-09-02再確認）
- [ ] 31. 実際に1サイクル（ネタ選定→生成→自己採点→管理画面表示→承認→公開）を通しで確認 — Blog/YouTube自動公開の実クレデンシャルでのエンドツーエンド検証。実際にPRをマージ・動画を公開する不可逆操作を伴うため、実行前にユーザーへの確認が必要

## チャネル品質検証の準備（2026-09-02、構造的な穴を先に閉じる）

「1チャネルずつクオリティを検証する」着手前レビューで、FR3（画像/動画必須要件）とFR5（却下フィードバックの反映）が実装上未完だったことが判明（PR #471は「内容の質は問わず」の配管検証のみで、画像0枚・content-index.json無しだった）。cronの本格運用化（task 10）前に以下を実装した。

- [x] 32. `sns-video-studio/remotion/src/DataQuoteCard.jsx`新設 — 実画面スクリーンショットが無いネタ（会場特性・成績）向けのカバー画像/YouTubeサムネイル静止画。ユーザーレビュー3往復を経て確定（詳細は`docs/reference/brand-kit.md`「YouTube / ブログ / note カバー画像・サムネイル」参照）
- [x] 33. `sns-video-studio/remotion/src/textFit.js`新設 — 見出しの改行崩れ（熟語途中での折り返り）防止。canvas.measureTextで実測しフォントサイズ自動縮小＋助詞等の安全な位置でのみ改行
- [x] 34. `scripts/lib/contentChannels/coverImageStrategy.js`・`captureScreenshot.js`・`renderCoverCard.js`実装 — ネタ種別ごとのカバー画像調達方法（スクリーンショット/DataQuoteCard）の判定・実行、動作確認済み
- [x] 35. `scripts/lib/contentRevisionHistory.js`・`scripts/maintenance/content-ops-checks/check-revision-escalation.js`実装 — 却下フィードバック（`revision_reason_codes`）の恒久反映。生成前に直近30日分を必ず参照、同一理由が3回累積したら`content-ops-nightly-check.yml`が自動でLinear起票（既存の`content-quality`ラベル運用に合流、`check-quality-backlog.js`が拾う）
- [x] 36. `content-multi-channel-pipeline-prompt.md`にステップ0（却下理由確認）・ステップ5（カバー画像生成）を追加、「画像は人間が用意する」制約を撤去
- [x] 37. ブログ承認→PRマージ画面に、承認前にDraft PR（Vercel Preview含む）へのリンクを表示する — `TextDraftPreview`にタイトル直下でPRリンクを表示、モックデータで表示確認済み

## TikTokギャンブルポリシー対応（2026-09-02、BOA-237）

Xチャネル検証完了後、TikTokチャネル検証に着手する直前に、既存フォーマットの大半がTikTok広告ポリシー（賭けの結果に影響する統計・インサイトの規制）に抵触して新規制作停止になっていたことが判明（`docs/proposal/tiktok-non-gambling-content-ideas.md`）。channelMatrix.jsの「会場攻略型TikTokローテーションに乗る」という前提コメントが誤りだった状態（BOA-237）を含めて対応。

- [x] 38. `channelMatrix.js`をネタ種別単位からネタ単位のTikTok判定に変更 — 既存4系統（新機能・会場特性・データ知見・成績）はCHANNEL_MATRIX上でTikTokを含めず、`getChannelsForTopic(sourceId, {isGamblingRelevant: false})`で個別ネタごとに例外的に安全と判定した場合のみ追加できるようにした。既定は安全側（TikTok除外）
- [x] 39. 常磐（evergreen）ネタ種別3系統を新設 — `competition-trivia`（競技解説・技術トリビア）・`overseas-intro`（海外向けKyotei入門、英語字幕）・`service-trust`（サービス信頼性・スケール訴求）。成績・確率を扱わない設計のため既定でTikTokを含める。案5「観戦体験型」は実レース映像素材が必要で現行のRemotionベース制作フローでは作れないため見送り
- [x] 40. `spec.md`のFR1・FR2を更新 — 新設3系統・`new-feature`のライフハック型拡張・ネタ単位TikTok判定の設計をドキュメント化
- [ ] 41. 新設3系統の候補生成ロジック（`scripts/lib/contentTopics/`への`xxxSource.js`追加・`index.js`のレジストリ登録）・Remotionコンポジションテンプレートを実装（今回は設計・チャネルマトリクスまで。3系統ともまだ`topicSources`に登録されておらず、実際に候補が出てくる状態ではない）
- [x] 42. `docs/proposal/tiktok-non-gambling-content-ideas.md`の「現状の運用方針」節を更新（統合しない方針→統合済みに変更）— 完了。BOA-237のクローズはLinear未認証のため今回は未実施、次回セッションで対応
- [x] 43. `newFeatureSource.js`を拡張し、`missingContentIndex`（新規ルート検知）だけでなく既存機能（言語切替・レース間ナビゲーション・選手ニュース・会場ガイド）の使い方紹介も候補として出せるようにした。各候補に`isGamblingRelevant`フィールドを持たせ（新規ルート由来はtrue=安全側、ライフハック候補はfalse=TikTok可）、`content-multi-channel-pipeline-prompt.md`のチャネル選定手順にもこのフィールドを`getChannelsForTopic`へ渡す手順を追記。動作確認済み（候補4件、いずれも`isGamblingRelevant: false`で出力）
