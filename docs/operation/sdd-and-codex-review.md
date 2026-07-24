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

**2026-07時点で見送り中。** 導入は検討したが、以下の理由から現時点では有効化しない判断とした（判断の記録）。

- 移植元の hakumei-app 自身、この仕組みを「一時中断」している（`decisions.md` に導入経緯はあるが、実運用の CLAUDE.md では codex-review ステップがコメントアウトされ、Claude セルフレビューのみで運用中）
- boatAI の既存セルフレビュー（`/code-review`、複数角度の並列サブエージェント方式）が実際に効果を上げている（BOA-130/131/132 等で実行時バグを複数発見・修正済み）
- Codex 利用には ChatGPT Plus/Pro 等のサブスクリプション契約が前提（月額固定costがかかる）。boatAI は基本的に単独開発のため、複数人開発で効くはずの「独立した第三者視点」のメリットが薄い
- boatAI のリスク上限（予測表示バグ・SEO・モバイルUX）は hakumei（テナント分離・AWS課金事故等）より低い

仕組み自体（スクリプト・コマンド・`AGENTS.md`）はセットアップ済みで残してある。将来、契約する理由ができた場合（大規模リファクタ・重大事故の再発防止等）は下記の手順でそのまま使える。

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

- Codex はレビュー観点を `AGENTS.md`（リポジトリルート）から読む。boatAI 固有の危険ゾーン（Supabase ページネーション、i18n 言語プレフィックス、モバイルタッチイベント、「競艇」禁止用語等）を記載済み。`.claude/rules/code-style.md` 等と一部内容が重複するのは意図的（`AGENTS.md` 単体でレビュー基準が完結するようにするため、hakumei-app の設計を踏襲）。ルール変更時は `.claude/rules/` 側を正としつつ、`AGENTS.md` にも反映を忘れないこと
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

## レビュー系コマンドの使い分け

| コマンド | 対象 | 用途 |
|---------|------|------|
| `/code-review` | 自分の作業ブランチの diff | Claude によるセルフレビュー（既存フローの必須ステップ） |
| `/codex-review [base]` | 自分の作業ブランチの diff | Codex による第三者セカンドオピニオン（大規模・高リスクな変更で追加実施） |
| `/review-pr {PR番号}` | 他者が作成した任意の PR | ルール準拠チェックしつつ GitHub にレビューコメントを投稿 |

## 既知の制約

- `.claude/hooks/block-secrets.sh` はファイル名（basename）のみで判定する。`credentials/` ディレクトリ配下でもファイル名自体に `.env`/`.pem`/`credentials` を含まないファイルは保護対象外
- 翻訳リソース等と同様、`AGENTS.md` の記載は手動同期が必要（`.claude/rules/` の自動読み込みとは異なり、Codex はこのファイルだけを読む）
