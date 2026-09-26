#!/usr/bin/env bash
# PostToolUse(Edit|Write): セッションが長くなったら切り出しの判断を促す。
# 判定と根拠は scripts/maintenance/session-progress.js の冒頭コメントを参照。
#
# 記録できない・node が無い場合は黙って素通しする（作業を止めない）。
script="$CLAUDE_PROJECT_DIR/scripts/maintenance/session-progress.js"
[ -f "$script" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0
exec node "$script"
