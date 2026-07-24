---
description: SDD Step 3 — docs/design/{機能slug}/tasks.md（タスク分解）を作成する
argument-hint: "<機能slug（kebab-case）>"
---

引数 `$ARGUMENTS` は機能slug（kebab-case）。以降 `{slug}` と表記する。

`docs/design/{slug}/spec.md`・`docs/design/{slug}/plan.md` と（UI機能なら）`docs/design/{slug}/screens.md` から `docs/design/{slug}/tasks.md` を作成する。

1タスク=1まとまり、チェックボックス形式、依存順に並べる。各タスクは目安として「1コミット〜1PRで完結する粒度」に分解する（大きすぎる場合は分割、些末すぎる場合は統合）。
