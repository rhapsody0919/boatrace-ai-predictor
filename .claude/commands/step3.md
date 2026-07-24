---
description: SDD Step 3 — docs/design/{機能slug}/tasks.md（タスク分解）を作成する
argument-hint: "<機能slug（kebab-case）>"
---

`docs/design/$1/spec.md`・`docs/design/$1/plan.md` と（UI機能なら）`docs/design/$1/screens.md` から `docs/design/$1/tasks.md` を作成する。

1タスク=1まとまり、チェックボックス形式、依存順に並べる。各タスクは目安として「1コミット〜1PRで完結する粒度」に分解する（大きすぎる場合は分割、些末すぎる場合は統合）。
