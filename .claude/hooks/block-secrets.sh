#!/usr/bin/env bash
# PreToolUse(Edit|Write): 機密ファイルへの書き込みをブロックする。
# .env / .env.local / .env.* および *.pem / *credentials* を対象。ただし *.example は許可。
f=$(jq -r '.tool_input.file_path // empty')
base=$(basename "$f")
case "$base" in
  *.example) exit 0 ;;
esac
case "$base" in
  .env|.env.*|*.pem|*credentials*)
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"機密ファイル ('"$base"') への直接書き込みはブロックされています。値が必要なら .env.local を手動編集するか、Vercel環境変数経由で扱ってください。"}}'
    exit 0 ;;
esac
exit 0
