#!/usr/bin/env bash
# PreToolUse(Bash): `gh pr merge` を止めるべきか判定する。
# 判定ロジックと、なぜGitHubのブランチ保護ではなくここで止めるのかは
# scripts/maintenance/guard-pr-merge.js の冒頭コメントを参照。
#
# node が無い・スクリプトが無い場合は素通しする（ゲートの不調で作業を止めない）。
script="$CLAUDE_PROJECT_DIR/scripts/maintenance/guard-pr-merge.js"
[ -f "$script" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0
exec node "$script"
