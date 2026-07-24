#!/usr/bin/env bash
# PostToolUse(Edit|Write): 変更された *.js / *.jsx に eslint --fix を適用する。
f=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
case "$f" in
  *.js|*.jsx) ;;
  *) exit 0 ;;
esac
[ -f "$f" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}" || exit 0
npx eslint --fix "$f" >/dev/null 2>&1 || true
exit 0
