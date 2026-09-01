# タスク分解

依存順に並べる。`⚠️`は自律進行モードでも実行前にユーザー確認が必要なタスク（不可逆操作・実運用中UIの破壊的変更・ユーザー自身のログインが必要な設定）。

## 基盤（スキーマ・共通ロジック）

- [ ] 1. `docs/db-migration/042_content_drafts_columns.sql`をSupabaseへ適用 ⚠️（本番DBへの変更。`SUPABASE_ACCESS_TOKEN`要確認）
- [x] 2. `scripts/lib/contentTopics/`実装（レジストリ+4モジュール: 新機能/会場特性/データ知見/成績）— 動作確認済み（new-feature:0件/venue-characteristic:96件/data-insight:17件/daily-result:0件、いずれも想定通り）
- [x] 3. `data/analysis/content-topics/`履歴JSON初期化 — 実装は遅延生成方式（`recordUsage`初回呼び出し時に自動作成）のため、事前の個別初期化は不要と判断
- [x] 4. `scripts/lib/contentChannels/channelMatrix.js`実装（ネタ種別→チャネル対応表）— 動作確認済み
- [x] 5〜6・8. **設計を修正**: ブログ/note本文の執筆・品質採点は決定的なJS関数にできない（LLM判断そのもののため）。既存の`sns-video-producer-prompt.md`等と同じ形式の運用プロンプト文書として実装した: [`docs/operation/content-multi-channel-pipeline-prompt.md`](../../operation/content-multi-channel-pipeline-prompt.md)（ネタ選定・チャネル選定・ブログ執筆・note変換・多層品質レビュー・下書き永続化・履歴更新の手順を網羅）。当初`renderer.js`/`contentQualityReview.js`という実装方針を計画していたが、実装段階で「文章生成・品質判断はコードにできない」ことを踏まえ方針転換
- [ ] 7. YouTubeサムネイル生成のRemotion still実行スクリプト（`scripts/lib/contentChannels/youtubeThumbnail.js`、Remotion CLI呼び出しのみのため決定的コードとして実装可能。ただしサムネイル用Remotionコンポジション自体が未作成——先にコンポジションを用意する必要あり）

## Routine

- [ ] 9. 新規Routine `content-multi-channel-pipeline`のプロンプト作成・one-offテスト実行（タスク2〜8の動作確認）
- [ ] 10. one-offテスト結果を確認し、問題なければ毎晩cron実行として標準運用に組み込む ⚠️（標準運用化の最終判断）
- [ ] 11. 既存Routine`sns-hub-content-generation`の`generate-daily`/`generate-evergreen`にYouTube対応を追加（`api/admin/sns-hub/generate.js`の`VALID_PLATFORMS`に`"youtube"`追加）

## 管理画面

- [ ] 12. `SnsHubAdmin.jsx`のタブ構成をプラットフォーム軸に再構成 ⚠️（実運用中の画面への破壊的変更、`screens.md`で確認事項として明記済み）
- [ ] 13. `TextDraftPreview`（ブログ/note下書きプレビュー）実装
- [ ] 14. `CopyToClipboardButton`実装
- [ ] 15. `ThumbnailPreview`実装
- [ ] 16. `RevisionPanel`の`REVISION_REASONS`にblog/note向け理由コード追加
- [ ] 17. `GENERATE_PLATFORM_OPTIONS`に`youtube`追加

## 外部連携（承認アクション）

- [ ] 18. `GITHUB_MERGE_TOKEN`発行（Fine-grained PAT、ADR 0034） ⚠️（ユーザー自身のGitHubアカウント操作が必要）
- [ ] 19. `api/admin/sns-hub/merge-blog-pr.js`実装
- [ ] 20. `BlogApproveAction`コンポーネント実装・`snsHubService.js`に`mergeBlogPr()`追加
- [ ] 21. Google Cloud ConsoleでYouTube Data API v3有効化・OAuth同意・リフレッシュトークン取得（ADR 0035） ⚠️（ユーザー自身のGoogleログインが必要）
- [ ] 22. `api/admin/sns-hub/publish-youtube.js`実装
- [ ] 23. `YouTubeApproveAction`コンポーネント実装・`snsHubService.js`に`publishYoutube()`追加

## 品質監査・調査ループ

- [ ] 24. `session-start-check.js`に`checkContentQualityAudit()`追加（FR4b、公開済みコンテンツの抜き打ち監査）
- [ ] 25. `scripts/lib/snsStrategyInsights.js`の呼び出し元（`/growth-pdca`等）でblog/noteスコープのinsight書き込みに対応

## ドキュメント更新

- [ ] 26. `docs/reference/brand-kit.md`にblog/note向けの制作ルール節を追加（着手前の参照先として）
- [ ] 27. `.claude/CLAUDE.md`フローAにこのパイプラインの運用手順を追記
- [ ] 28. `docs/operation/`にGitHub PAT・YouTubeリフレッシュトークンのローテーション手順を追加

## 検証

- [ ] 29. `npm run build`成功確認
- [ ] 30. E2Eスモークテスト実行（既存の管理画面ルーティングに影響が無いか）
- [ ] 31. 実際に1サイクル（ネタ選定→生成→自己採点→管理画面表示→承認→公開）を通しで確認
