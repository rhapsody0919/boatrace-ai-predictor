# コンテンツ運用フロー統合再設計

**種別**: 運用フロー・ドキュメント体系の再設計（CLAUDE.md再編・新規スクリプト・新規GitHub Actions・ブランドキット新設を含む）
**対応Linearチケット**: なし（本specから起票する）
**関連**: BOA-231（ブランド素材の一元化、本specのPhase 0と合流）

## 背景・最終ゴール

龍神レーダー（boat-ai.jp）は note / X / YouTube / TikTok / ブログ / 静的ページ（`/about`・`/faq`・`/how-to-use`・`/guide`）の6チャネルでコンテンツを展開している。これらは性質の異なる3つのフローが混在し、それぞれ別々の場当たり的なルールで運用されてきた。

- **フローA（新機能マルチチャネル展開）**: 機能実装完了→YouTube解説動画→ブログ記事化→X投稿→note投稿。現状は完全直列で、並列化できる箇所が並列化されておらず、静的ページ更新の要否判断とsns-hubへの接続がどこにも存在しない
- **フローB（sns-hub日常運用）**: `SnsHubAdmin.jsx`等が担う既存の定常SNS投稿サイクル（Phase 1稼働中）。フローAとは独立
- **フローC（既存コンテンツの品質・鮮度維持）**: 機能変更・UI変更・モデル変更のたびに静的ページ・note/ブログ過去記事・視覚素材が陳腐化しうるが、影響範囲を機械的に特定する手段が存在しない。加えて、各チャネルの画像・動画・CTAがセッションごとに場当たり的に作られ、統一感を欠く

このプロジェクトは過去に同じ形の失敗を複数回経験している（tweet-drafts下書きが14件→38件まで滞留、X集客戦略が2025-12開始1週間で自然停止）。**「人間が覚えている」ことに依存する仕組みは、遅かれ早かれ形骸化する。** 本specはこの前提に立ち、全ての新規メカニズムを「人間の記憶に依存しない」形（Claudeの実装完了チェックリストへの機械的組み込み、または能動的な通知・提示）で設計する。

最終ゴールは、6チャネル・4静的ページに閉じない形で「新機能公開」「日常運用」「既存コンテンツの鮮度・品質維持」の3つの流れを整理し、将来チャネルが増減しても壊れない構造を作ること。

現状フローA/B/C図解・8人パネル議論・設計方針の検討過程は [content-ops-flow-review（検討資料）](https://claude.ai/code/artifact/fdd6010f-afe4-480b-98be-2819dd21c36d) を参照。本specはその結論を実装可能な要件へ落としたもの。

**前提の確認**: `/about`・`/faq`・`/how-to-use`・`/guide`は本spec作成時点で別セッションにより最新化済み（現時点で陳腐化なし）。本specが扱うのは「今クリーンな状態を今後どう保つか」という仕組みの不在であり、現状の緊急な汚染ではない。

---

## 機能要件

### フローA: 新機能マルチチャネル展開

| # | 要件 | 優先度 | 受入基準 |
|---|---|---|---|
| A1 | YouTube動画とブログ記事の並列着手 | 中 | 機能実装完了（PRマージ）を単一トリガーとし、YouTube解説動画制作とブログ記事執筆が同時に着手できる運用ルールに更新する。X・note投稿は両方の完成を待つ |
| A2 | トレーサビリティ索引の新設 | 高 | 機能ごとに `docs/design/{slug}/content-index.json` を新設し、その機能に言及する静的ページ・note記事・ブログ記事・YouTube動画・X投稿のURL/パスを記録する形式を定義する |
| A3 | 索引作成の実装完了チェックリスト組み込み | 高 | 既存の「実装完了後の自動レビュー」手順（`/code-review`実行・`npm run build`・新規ルートなら`verify:sitemap`）に、「`content-index.json`の新規作成または『対象外』の明記」を追加項目として組み込む。人間が別途思い出す前提にしない |
| A4 | フローA成果物のsns-hub連携 | 中 | フローAで生成したYouTube動画・ブログ記事のメタデータを、sns-hubの型・キャラ選定ロジックが参照できる形で提示する。`sns_drafts`テーブルへの直接挿入はしない（同テーブルは「投稿直前の完成品」を前提にした設計で、素材段階のコンテンツを挿入すると管理画面の前提が壊れるため）。代わりに`content-index.json`（A2）を再利用し、`session-start-check.js`の`recentFlowAContent`で「直近21日以内に公開され、まだ活用されていない可能性のある機能」を一覧化する。x-operations-playbook.md/sns-video-producer-prompt.mdの型・キャラ選定ロジックにこの一覧を追加の題材候補源として組み込む（「新機能告知単体は選ばない」という既存ルールは変更しない） |
| A5 | 重複制作防止（着手宣言） | 低 | フローA着手時、対応するLinearチケットを `In Progress` に変更することを実装着手の手順に含める。新規の排他制御機構は作らない（実害が小さいため人間の運用に委ねると明示的に許容） |

### フローB: sns-hub日常運用

| # | 要件 | 優先度 | 受入基準 |
|---|---|---|---|
| B1 | 既存フローの維持 | — | Phase 1で稼働中のsns-hub運用ループ（週次/当日バッチ生成→管理画面レビュー→人間の手動投稿→ステータス更新）は変更しない。Phase 2（実績フィードバック）は別spec（`docs/design/sns-hub-phase2-pdca-loop/`）の範囲のまま |
| B2 | ブランドキット参照への統一 | 中 | sns-hubの動画・画像生成プロンプトが、後述のブランドキット（`docs/reference/brand-kit.md`）を参照する形に更新し、色・フォントを個別プロンプト内に直書きしない |

### フローC: 既存コンテンツの品質・鮮度維持

| # | 要件 | 優先度 | 受入基準 |
|---|---|---|---|
| C1 | ブランドキットのギャラリー化 | 高 | `docs/reference/brand-kit.md` を新設する。色・フォント・ロゴ使用ルールに加え、**「承認済み実例のギャラリー」**として、チャネル別（note/X/YouTube/TikTok/ブログ/静的ページ）に採用済みビジュアルとその選定理由・却下案の理由を記録する。今回のnoteヘッダー（案A〜Eの変遷）を最初の実例として収録する |
| C2 | ブランドキット参照の必須化 | 中 | 新しいチャネル向け画像・動画を作成する全ての制作プロンプト（`docs/operation/note-video-producer-prompt.md`・`docs/operation/sns-video-producer-prompt.md`等）に、着手前に`brand-kit.md`を参照する手順を明記する |
| C3 | ブランドキット追記の完了条件化 | 中 | 新しい画像・動画がユーザーに承認されたら、その制作タスクの完了条件として`brand-kit.md`のギャラリーに実例を追記する（後日まとめての更新にしない） |
| C4 | 視覚素材の鮮度一覧スクリプト | 中 | `scripts/maintenance/list-visual-assets-age.js` を新設し、`public/videos/`・`public/images/`配下の主要素材（`/about`ヒーロー動画等）の最終更新日を一覧化する。陳腐化の自動判定はしない（判断は人間） |
| C5 | トレーサビリティ・カバレッジチェック | 中 | `scripts/maintenance/verify-content-index-coverage.js` を新設し、`docs/design/*/content-index.json` の存在・形式を機械的に検証する（`verify-sitemap-coverage.js`と同様のパターン） |
| C6 | 品質バックログのLinearラベル運用 | 中 | Linearに `content-quality` ラベルを新設する。デザイン・CTA・画像品質について「気づいたが今は手を動かせない」課題は、このラベルで軽量起票する運用をCLAUDE.mdに明文化する（このセッションの`spawn_task`相当の代替） |
| C7 | セッション開始時チェックの統合 | 高 | `scripts/maintenance/session-start-check.js` を新設し、以下7項目を1回の実行で集約する。CLAUDE.mdの既存5節（Xツイート下書き・X動画・TikTok・選手ニュース・集客調査スキル）を、このスクリプトを呼び出す1つの指示に統合する: <br>1) tweet-drafts未投稿件数 2) X動画本日投稿状況 3) TikTok本日投稿状況 4) 選手ニュース要確認リスト 5) 集客調査スキル実行鮮度 6) `content-index.json`カバレッジ結果 7) `content-quality`ラベル未処理件数（tweet-draftsと同じ鮮度優先ペースで2〜3件提示） |
| C8 | 押す（push）層: GitHub Actions定期チェック＋Slack通知 | 中 | C4・C5・C6の機械的チェック（LLM推論不要・外部サイト閲覧不要）を新規GitHub Actionsワークフローとして定期実行し（`update-sitemap.yml`・`collect-racer-news.yml`と同パターン）、閾値超過時に既存の`SLACK_WEBHOOK_URL`（`slack-notify-pr.yml`と同経路）へ通知する。これにより「セッションが長期間開かれない」場合でも滞留が可視化される |
| C9 | CLAUDE.mdの再編 | 中 | CLAUDE.mdに「フローA」「フローB」「フローC」の3見出しを新設し、既存の細切れルール（新機能リリース時のブログ記事ルール、各種セッション開始時確認等）をそれぞれの配下に移動・統合する。ルールの削除はなく、置き場所を変えるだけで既存の挙動は変えない |
| C10 | 廃止済み用語の機械的検知 | 中 | `docs/reference/deprecated-terms.json`に廃止済み用語を一元管理し、`scripts/maintenance/check-deprecated-terms.js`が静的ページ・オンボーディングUI（`FirstVisitGuideCard.jsx`）・note下書き・ブログ記事に対してgrep検知する。意味理解による陳腐化判定はできない（完全自動判定は不可能と割り切る）が、「廃止確定済みの具体的な用語が残っていないか」は機械的に検知できる。ブログ記事の公開前チェックで既に確立していた手法の横展開 |

---

## スコープ

### やる
- 上記A1〜A5、B2、C1〜C10
- `docs/reference/brand-kit.md` の新設（初回実例としてnoteヘッダーA〜Eを収録）
- `docs/design/{slug}/content-index.json` のテンプレート新設
- `scripts/maintenance/session-start-check.js`・`list-visual-assets-age.js`・`verify-content-index-coverage.js` の新規実装
- 新規GitHub Actionsワークフロー（C8）
- Linear `content-quality` ラベルの新設
- CLAUDE.mdの再編（既存ルールの移動・統合）

### やらない（今回スコープ外）
- フローCの陳腐化「自動判定」（最終更新日の提示までとし、陳腐化の是非は人間が判断する。C4参照）
- 複数セッション並行時の厳密な排他制御（Linearステータス変更による軽い運用に留める。A5参照）
- sns-hub Phase 2（実績フィードバックループ）本体の実装（別spec `docs/design/sns-hub-phase2-pdca-loop/` の範囲のまま）
- 無人Routineによる外部サイト（X/TikTok等）の自律閲覧・投稿（技術的に不可能と確定済み。`docs/design/sns-hub-phase2-pdca-loop/spec.md`参照）
- 静的4ページ（`/about`等）の今回時点でのコンテンツ改稿（既に別セッションで最新化済みのため対象外。仕組み自体はC1〜C9で今後の陳腐化に備える）

---

## 非機能要件

- **拡張性**: 現在の6チャネル・4静的ページに固定した設計にしない。新チャネルの追加や既存チャネルの廃止が将来起きても、`session-start-check.js`・`content-index.json`・`brand-kit.md`のいずれも「項目を1つ追加/削除するだけ」で対応できる構造にする。CLAUDE.mdへの追記でスケールさせない
- **形骸化耐性**: 新設する全てのメカニズムは「人間の記憶」に依存しない。機械的に判定できるものはClaudeの実装完了チェックリストまたはGitHub Actions、判断が要るものはセッション開始時の能動チェックまたはGitHub Actions経由のSlack通知のいずれかに必ず寄せる
- **コスト**: 新規の月額固定費追加を避ける。GitHub Actions・既存Slack Webhookは追加コストなし。新規スクリプトはNode.jsのみで完結させる
- **既存機能への非干渉**: 既存のsns-hub Phase 1運用ループ、CLAUDE.md記載の他ルールの挙動を変えない（移動・統合はするが、チェック内容や頻度は変えない）
