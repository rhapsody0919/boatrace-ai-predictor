---
description: SDD Step 4 — docs/design/{機能slug}/tasks.md の次の未完タスクを実装する
argument-hint: "<機能slug（kebab-case）>"
---

引数 `$ARGUMENTS` は機能slug（kebab-case）。以降 `{slug}` と表記する。

`docs/design/{slug}/tasks.md` の次の未完タスクを実装する。

まず計画を提示し、承認後に着手する。実装前に検証方法を決める（boatai には単体テストフレームワークが無いため、Playwright での動作確認手順、または `/verify` スキルでの実機確認を想定する。DBスキーマ変更なら `docs/db-migration/` の手順検証も含める）。

`docs/design/{slug}/spec.md`・`plan.md`・`screens.md`（あれば）から逸脱しない。プロジェクト CLAUDE.md・`.claude/rules/` のルールを厳守する。

タスク完了後は、`/implement` と同様に並列エージェントでビルド検証・品質チェックを行ってから `docs/design/{slug}/tasks.md` の該当チェックボックスにチェックを入れる（`.claude/commands/implement.md` の並列検証パターンに揃える）。

全タスク完了後は `/create-pr` で PR を作成し、プロジェクト CLAUDE.md の既存フロー（`/code-review` セルフレビュー → 大規模・高リスクな変更は `/codex-review` → PRコメント・チャット本文への報告 → ユーザー承認後マージ）に進む。
