#!/usr/bin/env bash
# SessionStart: 現在のブランチとgit statusを可視化する。
# 前タスクのfeatureブランチを流用したまま作業し、並行セッションの成果物を
# 誤削除したインシデント（2026-08-13〜14）の再発防止。
cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0

branch=$(git branch --show-current 2>/dev/null)
[ -z "$branch" ] && exit 0

status=$(git status --short 2>/dev/null)

echo "## Git状態（セッション開始時の自動チェック）"
echo "現在のブランチ: $branch"
if [ "$branch" != "master" ]; then
  echo "注意: masterではないブランチです。今回のタスクと無関係なブランチの可能性があるため、このタスクに関係すると確認できない限り、新規タスクではmasterから新しくブランチを切ること。"
fi
if [ -n "$status" ]; then
  echo ""
  echo "未コミットの変更があります（他セッションの作業中の可能性があるため、内容を確認せずに変更・削除しないこと）:"
  echo "$status"
fi
