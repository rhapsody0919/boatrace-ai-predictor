# SDD開発フロー・Codexセカンドオピニオンレビュー

hakumei-app プロジェクトの Claude Code 開発スタイルを boatAI 向けに移植したもの（2026-07 導入）。

## 使い分け: 既存フロー vs SDD

| フロー | 対象 | 起動 |
|--------|------|------|
| 既存（Linear チケット直接実装） | 仕様が明確で小〜中規模のチケット | `/implement {チケットID}` |
| SDD（仕様書駆動） | 仕様に曖昧さが残る・設計判断が重要な大規模機能 | `/step1-spec {slug} [チケットID]` から順に |

迷ったら「仕様を書き下さないと設計判断を誤りそうか」で判断する。ほとんどの機能追加・改修は既存フローで十分。

## SDD の手順

```
/step1-spec {機能slug} [Linearチケット番号]   → docs/design/{slug}/spec.md
/step1-screens {機能slug}                     → docs/design/{slug}/screens.md（UI機能のみ）
/step2 {機能slug}                              → docs/design/{slug}/plan.md
/step3 {機能slug}                              → docs/design/{slug}/tasks.md
/step4 {機能slug}                              → tasks.md の次の未完タスクを実装（繰り返し）
```

- `{機能slug}` は kebab-case（例: `venue-comparison-widget`）
- 成果物は `docs/design/{slug}/` にまとまる。機能が実装・マージされたら `docs/design/` の既存ルール（採用済み設計書の置き場）にそのまま従う
- 重要な技術判断は `docs/adr/` にも ADR として残す（`docs/adr/0000-template.md` をコピー、`0001-` から採番）
- hakumei-app と異なり、boatAI にはプロジェクト全体の凍結された `inception/`（新規クライアント案件の立ち上げ文書）は存在しない。boatAI は稼働中の自社プロダクトのため、機能単位の SDD のみを採用している

## Codex セカンドオピニオンレビュー

`/code-review`（Claude 自己レビュー）に加えて、OpenAI Codex に PR diff を第三者レビューさせる追加チェック。

### セットアップ（初回のみ）

```
npm i -g @openai/codex   # グローバルインストール（推奨。無くても npx 経由で動く）
codex login              # ChatGPT アカウントでログイン
```

`! codex login` の形でターミナルコマンドとして実行する（インタラクティブなログインのため）。

### 使い方

PR 作成後、`/code-review` を通してから `/codex-review` を実行する。

```
/codex-review           # base=master でレビュー
/codex-review develop   # base ブランチを指定する場合
```

- Codex はレビュー観点を `AGENTS.md`（リポジトリルート）から読む。boatAI 固有の危険ゾーン（Supabase ページネーション、i18n 言語プレフィックス、モバイルタッチイベント、「競艇」禁止用語等）を記載済み
- Codex はコードを書き換えない（read-only）。指摘への対応は必ず Claude が行う
- Critical/High の指摘が0件になる（approve）まで、最大5ラウンド自動でループする
- **hakumei-app と異なり、boatAI では収束後も自動マージしない**。マージの最終承認は引き続きユーザーが行う（プロジェクト CLAUDE.md の既存ルールを維持）
- コミット・PR本文への `Co-Authored-By: Claude` 署名は boatAI では規約違反ではない（Claude Code の標準運用のため）。Codex がこれを指摘した場合は `AGENTS.md` の記載により無視される想定だが、万一指摘された場合は反論として扱ってよい

### トラブルシューティング

| エラー | 原因 | 対処 |
|--------|------|------|
| `codex が未認証` | `codex login` 未実施 | `! codex login` を実行 |
| `PR が未作成` | PR 作成前に実行した | 先に `gh pr create`（または `/create-pr`） |
| `codex も npx も見つからない` | Node/npm 環境の問題 | `npm i -g @openai/codex` |
