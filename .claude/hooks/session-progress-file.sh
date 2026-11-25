#!/usr/bin/env bash
# SessionStart・Stop: claude/ の枝の作業ごとに進捗の一枚（リポジトリの外 ~/.config/ryujin/progress/<枝>.md）を持たせる。
# 判定と根拠は scripts/maintenance/session-progress-file.js の冒頭の注釈。止めるのは Stop で1回だけ、読んだだけのセッションは止めない。
# 記録できない・node が無い場合は黙って素通しする（作業を止めない）。
# NODE_USE_SYSTEM_CA があると node の起動が遅くなる（BOA-657）。外部へ通信しないので外す
unset NODE_USE_SYSTEM_CA
script="$CLAUDE_PROJECT_DIR/scripts/maintenance/session-progress-file.js"
[ -f "$script" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0
exec node "$script" "$1"
