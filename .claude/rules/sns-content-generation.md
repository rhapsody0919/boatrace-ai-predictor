---
paths:
  - "sns-video-studio/**"
  - "note-articles/**"
  - "public/blog/**"
  - "src/pages/admin/SnsHubAdmin*"
  - "src/pages/admin/sns-hub/**"
  - "scripts/lib/contentChannels/**"
  - "scripts/lib/contentTopics/**"
  - "scripts/lib/snsStrategyInsights.js"
  - "scripts/lib/contentRevisionHistory.js"
  - "docs/operation/sns-*"
---

# SNSコンテンツ生成パイプライン 横断ルール

SNS投稿コンテンツ（ブログ/note/X/YouTube）を生成するすべてのClaude Code Routineが対象。SNS向けの生成物を触るときに読み込まれる（上の`paths`）。

**このファイルに書くのはチャネル横断で常に適用される技術ルールのみ**。特定チャネル固有のルールはここに書かず、各チャネル専用のプロンプトファイル（`docs/operation/`配下）に書く。ここに混在させると、無関係なチャネルへの誤適用を招く。

## 生成前に必ず確認する既存基盤

新しいコンテンツを生成する前に、以下を必ず確認する。片方のパイプラインだけ実装され他方に伝播しない不具合が繰り返し起きている。

- **`getRecentRevisions()`**（`scripts/lib/contentRevisionHistory.js`）: 過去の修正・却下理由を確認し、同じ指摘を繰り返さないようにする。戻り値は`revisionReasonFreetext`等キャメルケース（DBの生列名`revision_reason_freetext`のスネークケースと混同しない）
- **`getActiveInsights({platform, format, language})`**（`scripts/lib/snsStrategyInsights.js`）: `status='active'`な戦略insightを取得し、構成・訴求の判断に反映する。生成対象のplatform/format/languageに一致するもの（scopeがnullで全体適用のものも含む）を必ず確認する

## テキストのフィット処理

見出し・タイトルテキストをビジュアルに配置する際は、`fitHeadline()`（`docs/reference/brand-kit.md`参照）を使う。`whiteSpace: nowrap`による見切れや、手動の`fontSize`調整による独自ヒューリスティックは使わない。

## 主要ビジュアル要素の左右バランス

棒グラフ・比較図等の主要ビジュアル要素は、**理由が明記された意図的デザイン（`docs/reference/brand-kit.md`参照。例: 会場攻略・データ一覧型の「案A」）でない限り**、必ずflexで中央寄せ・左右バランスの取れた配置にする。詳細・対象外の一覧・既存の再利用コンポーネントは`docs/reference/brand-kit.md`「主要ビジュアル要素の左右バランス」参照。masterへコードをコミットしないパイプライン（venue-feature型等）は、既存の部品でカバーできない形状にその場限りのコードを書きがちなので、生成のたびに実行される`sns-video-producer-prompt.md`「セルフレビュー チェックリスト」でも毎回確認する。

## Supabase Storageのパス規約

`sns_drafts.video_storage_path`・`cover_image_path`には**生のStorageパス**（例: `{content_group_id}/x-ja.mp4`）を保存する。署名付きURLをそのまま保存しない。読み取り側は`signStoragePath()`/`signStoragePaths()`（`api/_lib/snsHubHelpers.js`）で都度署名する。

## リスクチェック

`sns-video-studio/remotion/risk-rules.json`（**パスに`remotion/`を含む**、`sns-video-studio/risk-rules.json`ではない）の各ルールを照合し、該当があれば`risk_flags`に記録する（ブロックしない、警告記録のみ）。決定的なコードチェックは`scripts/lib/riskRules.js`の`checkRiskRules(text, platform)`を使う。

## 用語・表記ルール

`.claude/rules/code-style.md`準拠（「競艇」使用禁止等）。SNS投稿本文にも例外なく適用する。

SNS投稿のハッシュタグの例外は、`.claude/rules/code-style.md` の「例外2」に従う。
