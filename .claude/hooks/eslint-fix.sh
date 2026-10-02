#!/usr/bin/env bash
# PostToolUse(Edit|Write): 変更された *.js / *.jsx に eslint --fix を適用する。
f=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
case "$f" in
  *.js|*.jsx) ;;
  *) exit 0 ;;
esac
[ -f "$f" ] || exit 0
# NODE_USE_SYSTEM_CA があると node の起動が 0.4〜1.4秒遅くなる（OS の証明書ストア待ち、BOA-657）。フックは外部へ TLS 通信しないので外す
unset NODE_USE_SYSTEM_CA
cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}" || exit 0
npx eslint --fix "$f" >/dev/null 2>&1 || true
exit 0
