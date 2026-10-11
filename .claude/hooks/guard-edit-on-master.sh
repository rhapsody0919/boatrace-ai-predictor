#!/usr/bin/env bash
# PreToolUse(Edit|Write|NotebookEdit): メインの作業ツリーが master のとき、その配下のファイル編集を止める。
# 新規タスクは git worktree で作業ツリーを分ける（グローバル規約）。並行セッションが同じ作業ツリーを
# 共有して他セッションの成果物を誤削除したインシデント（2026-08-13）の再発防止。
# 対象外: 別の作業ツリー（.claude/worktrees/ 配下など）、リポジトリ外（~/.claude の memory 等）、.git/ 配下。
# jq が無い環境では素通しする（他のフックと同じ）。
command -v jq >/dev/null 2>&1 || exit 0
input=$(cat)
f=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)
[ -z "$f" ] && exit 0
case "$f" in
  /*) ;;
  *)
    cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
    [ -z "$cwd" ] && exit 0
    f="$cwd/$f"
    ;;
esac

# 新規ファイル・新規ディレクトリでも判定できるよう、存在する最も近い祖先から git に聞く
dir=$(dirname "$f")
while [ ! -d "$dir" ]; do
  parent=$(dirname "$dir")
  [ "$parent" = "$dir" ] && exit 0
  dir="$parent"
done
dir=$(cd "$dir" 2>/dev/null && pwd -P) || exit 0

# .git/ 配下（git 管理の内部）は作業ツリーではないので対象外
case "/$dir/" in
  */.git/*) exit 0 ;;
esac

top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || exit 0
common=$(git -C "$dir" rev-parse --git-common-dir 2>/dev/null) || exit 0
main=$(cd "$dir" 2>/dev/null && cd "$common" 2>/dev/null && cd .. && pwd -P) || exit 0
top=$(cd "$top" 2>/dev/null && pwd -P) || exit 0

# 別の作業ツリー（worktree）の編集は対象外
[ "$top" = "$main" ] || exit 0

branch=$(git -C "$main" branch --show-current 2>/dev/null)
[ "$branch" = "master" ] || exit 0

echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"master 上の直接編集は禁止。git worktree（EnterWorktree 等）で作業ツリーを分けて作業する。並行セッションの変更との混線・誤削除（2026-08-13）の再発防止。"}}'
exit 0
