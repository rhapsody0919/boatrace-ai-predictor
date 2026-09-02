# コンテンツ運用フロー統合再設計: タスク分解

`spec.md`・`plan.md`に基づくタスク一覧。依存順に並べてある。各タスクは目安として1コミット〜1PRで完結する粒度。

## 基盤（ドキュメント・スキーマ）

- [ ] **Task 1: `docs/reference/brand-kit.md`新設**
  トークン（色・フォント・ロゴパス）＋チャネル別ギャラリー構成で新設。noteヘッダー（案C2却下・header-e採用・icon-a採用）を最初の実例として記載する（spec.md C1）

- [ ] **Task 2: `content-index.json`テンプレート新設**
  `docs/design/_template/content-index.json`をテンプレートとして配置し、plan.mdのスキーマをコメント付きで記載する（spec.md A2）

## スクリプト

- [ ] **Task 3: `check-content-index-coverage.js` + `verify-content-index-coverage.js`**
  既存`docs/design/*/content-index.json`の必須キー検証ロジックを実装。CLIラッパーは`verify-sitemap-coverage.js`と同じ形（exit code 1で失敗を返す）にする（spec.md C5）

- [ ] **Task 4: `check-visual-asset-age.js`**
  `public/videos/`・`public/images/`配下の主要素材の最終更新日（gitのlog依存ではなくファイルの更新日時、またはgit blame日時）を一覧化する（spec.md C4）

- [ ] **Task 5: `check-quality-backlog.js` + Linear `content-quality`ラベル新設**
  Linear MCPで`content-quality`ラベルを新設。ラベル付きIssueを取得し、起票日の古い順に上位2〜3件を返すロジックを実装（spec.md C6）

- [ ] **Task 6: `session-start-check.js`**
  Task 3〜5の出力に加え、既存5項目（tweet-drafts未投稿件数・X動画本日投稿状況・TikTok本日投稿状況・選手ニュースpending件数・集客調査スキル鮮度）の判定ロジックを、現状CLAUDE.mdの文章指示から実際のスクリプトへ書き起こす。1回の実行で7項目のJSONを返す（spec.md C7）

## GitHub Actions

- [ ] **Task 7: `content-ops-nightly-check.yml`新設**
  Task 3・4・5を夜間cronで実行し、閾値超過時（視覚素材90日超・品質バックログ10件超・content-index形式エラーあり）のみ既存`SLACK_WEBHOOK_URL`へ通知する（spec.md C8）

## CLAUDE.md再編

- [ ] **Task 8: フローA/B/C見出しの新設と既存ルールの移動**
  plan.mdの対応表に従い、既存6節（新機能リリース時のブログ記事ルール・セッション開始時確認5節・sitemap登録ルール）を移動・統合する。5つの「セッション開始時確認」節は本文を`session-start-check.js`実行の1行に置き換える（spec.md C9）

- [ ] **Task 9: フローA関連ルールの更新**
  「YouTube動画とブログ記事の並列着手」（A1）・「実装完了チェックリストへのcontent-index.json追加」（A3）をフローA節に明記する

## 制作プロンプトの更新

- [ ] **Task 10: 各種制作プロンプトへのブランドキット参照追加**
  `docs/operation/note-video-producer-prompt.md`・`docs/operation/sns-video-producer-prompt.md`・`docs/operation/sns-viral-copywriter-prompt.md`の冒頭に、着手前の`brand-kit.md`参照を必須手順として追記する（spec.md C2）。承認後のギャラリー追記（C3）も同様に完了条件として明記する

## 検証

- [ ] **Task 11: 動作確認**
  `node scripts/maintenance/session-start-check.js`を実行し、実際のリポジトリ状態に対して7項目全てが正しい値を返すことを確認する。`verify-content-index-coverage.js`は既存`docs/design/*/`ディレクトリに対してPASSすることを確認する（まだ`content-index.json`が存在しないため0件PASSでよい）
