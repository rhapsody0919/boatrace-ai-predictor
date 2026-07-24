---
description: SDD Step 4 — docs/design/{機能slug}/tasks.md の次の未完タスクを実装する
argument-hint: "<機能slug（kebab-case）>"
---

`docs/design/$1/tasks.md` の次の未完タスクを実装する。

まず計画を提示し、承認後に着手する。実装前に検証方法を決める（boatai には単体テストフレームワークが無いため、Playwright での動作確認手順、または `/verify` スキルでの実機確認を想定する。DBスキーマ変更なら `docs/db-migration/` の手順検証も含める）。

`docs/design/$1/spec.md`・`plan.md`・`screens.md`（あれば）から逸脱しない。プロジェクト CLAUDE.md・`.claude/rules/` のルールを厳守する。

タスク完了後は `docs/design/$1/tasks.md` の該当チェックボックスにチェックを入れる。全タスク完了後は、プロジェクト CLAUDE.md の既存フロー（`/code-review` セルフレビュー → 必要なら `/codex-review` → PR作成・報告 → ユーザー承認後マージ）に進む。
