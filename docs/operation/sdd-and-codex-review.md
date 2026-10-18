# SDD開発フロー・別ベンダーによる審査

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
- SDD は機能単位で使う。プロジェクト全体の立ち上げ文書は置かない

## 別ベンダーによる審査（Claude と Codex）

作った側と別のベンダーのモデルが審査する。Claude と Codex に共通する規約の正本は `AGENTS.md`。Codex がリポジトリのルート直下を読むので、`AGENTS.md` はルートに置く。

| PR | 作る側 | 審査する側 | 審査の手段 |
|---|---|---|---|
| Claude の PR（`claude/*` 等） | Claude | Codex（正） | GitHub の `@codex review`。観点は `AGENTS.md` の「Review guidelines」「Code Review Rules」 |
| Codex の PR（`codex/*`） | Codex | Claude | 鍵を持つ側で `claude -p` を Bash なしで実行する。Codex の自己検証の結果は合否の根拠にしない |

- Claude のセルフレビュー（`/code-review`）は、Codex の審査の前に行う
- `second-opinion-reviewer`（`.claude/agents/`）は、Codex が止まっているときの代わりとしてだけ使う
- Codex には `src/` の画面の作業を回さない（`codex/*` には Vercel Preview が無く、画面を確かめられないため）
- マージは、機械と審査役が CI の見張り・再実行（1回まで）・審査を済ませた PR を、オーケストレーターが「マージ可」の束としてまとめて行う。手順と段階は `.claude/skills/orchestrate/SKILL.md` に従う
- 手元で Codex に diff を審査させる旧方式（`/codex-review`）は削除した

## レビュー系コマンドの使い分け

| コマンド | 対象 | 用途 |
|---------|------|------|
| `/code-review` | 自分の作業ブランチの diff | Claude のセルフレビュー（必須） |
| `@codex review`（GitHub の PR コメント） | Claude の PR | Codex による別ベンダーの審査 |

## 既知の制約

- `.claude/hooks/block-secrets.sh` はファイル名（basename）のみで判定する。`credentials/` ディレクトリ配下でもファイル名自体に `.env`/`.pem`/`credentials` を含まないファイルは保護対象外
- Codex は `AGENTS.md` だけを読む。Claude と Codex に共通する規約は `AGENTS.md` を正本にし、`.claude/` には Claude に固有のもの（サブエージェント・フック・アプリ）だけを置く
