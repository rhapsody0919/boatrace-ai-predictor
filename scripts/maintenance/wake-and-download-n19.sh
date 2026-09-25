#!/bin/bash
# N19（racelist-backfill）の夜間自動再開スクリプト（BOA-353）
#
# 使い方: bash scripts/maintenance/wake-and-download-n19.sh "2026-09-25 22:00"
# nohup + disown で起動し、Claude Codeのセッション・アカウント切替に依存せず
# 独立プロセスとして動く（過去、セッション終了とともにこのスクリプトが
# 道連れで死んだ実績があるため、2026-09-25にnohup化した）。
#
# ブランチ切り替えは行わない（docs/applied-093のまま実行する。旧版はmasterへ
#   checkoutしてしまい、進行中のdocsブランチ作業を壊すリスクがあった）。
set -e
target=$(TZ=Asia/Tokyo date -j -f "%Y-%m-%d %H:%M" "$1" +%s) || exit 1
caffeinate -i -t $(( target - $(date +%s) + 30 )) &
while [ "$(date +%s)" -lt "$target" ]; do sleep 30; done
echo "=== $(TZ=Asia/Tokyo date '+%F %H:%M') JST: download開始 ==="
cd /Users/terukina/boatrace-ai-predictor/.claude/worktrees/docs-orchestration-integrate

current_branch="$(git branch --show-current)"
if [ "$current_branch" != "docs/applied-093" ]; then
  echo "中断: 想定外のブランチです（現在: $current_branch、想定: docs/applied-093）。他セッションの作業中の可能性があるため中断します"
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "中断: 作業ツリーに未コミットの変更があります（他セッションの作業中の可能性）"
  git status --porcelain
  exit 1
fi

# racelist-backfill.jsがPR #799の修正(motor_boat_marker異常の非致命化)を含むか確認する。
# 含まない場合はmasterから同期する(ブランチは切り替えず、ファイルだけ取得)
if ! grep -q "motor_boat_marker:" scripts/maintenance/racelist-backfill.js; then
  echo "racelist-backfill.jsが古いためmasterから同期します"
  git fetch origin master 2>&1
  git checkout origin/master -- scripts/maintenance/racelist-backfill.js
  git commit -m "fix: racelist-backfill.jsをmasterのPR #799修正版に同期する(自動再開時)" scripts/maintenance/racelist-backfill.js
  git push origin docs/applied-093
fi

node --env-file=.env.local scripts/maintenance/racelist-backfill.js download
echo "=== download終了。ステータス ==="
node --env-file=.env.local scripts/maintenance/racelist-backfill.js status
