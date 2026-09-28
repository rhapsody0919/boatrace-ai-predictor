---
description: SDD Step 3 — docs/design/{機能slug}/tasks.md（タスク分解）を作成する
argument-hint: "<機能slug（kebab-case）>"
---

引数 `$ARGUMENTS` は機能slug（kebab-case）。以降 `{slug}` と表記する。

`docs/design/{slug}/spec.md`・`docs/design/{slug}/plan.md` と（UI機能なら）`docs/design/{slug}/screens.md` から `docs/design/{slug}/tasks.md` を作成する。

1タスク=1まとまり、チェックボックス形式、依存順に並べる。各タスクは目安として「1コミット〜1PRで完結する粒度」に分解する（大きすぎる場合は分割、些末すぎる場合は統合）。

## 完了後の次アクション（`/step4`の事前条件）

tasks.md を書き終えたら、`/step4`に進む前に次を行う（`.claude/rules/sdd-workflow.md`）。

1. `design-reviewer` に設計レビューを依頼する（全機能）
2. UI機能（screens.md がある）なら、`acceptance-test-writer` に **spec.md と screens.md のパスだけ**を渡して `e2e/acceptance/{slug}.spec.js` を書かせる。plan.md・tasks.md は渡さない。1と並行でよい
3. 両者の結果（レビュー指摘・受け入れE2Eが挙げた仕様の曖昧点）をユーザーに報告し、spec.md・screens.md を直した場合は受け入れE2Eを書き直させる
