#!/usr/bin/env bash
# オーケストレーター（/orchestrate を起動したセッション）の記録と、compact 後の状態の再注入。
# 手順と状態ファイルの形式は .claude/skills/orchestrate/SKILL.md。
#
# 1本で3つのイベントを受ける（hook_event_name で分岐）。
#   UserPromptSubmit          : prompt の先頭が /orchestrate なら、このセッションを state.md に記録する
#   UserPromptExpansion(matcher orchestrate): command_name が "orchestrate" なら同上（/orchestrate を直接打った経路。
#                               UserPromptSubmit の prompt が展開後の本文で届いた場合の保険）
#   PostToolUse(matcher Skill): tool_input.skill が "orchestrate" なら同上
#   SessionStart(matcher compact): session_id が state.md の orchestrator_session と一致するときだけ、
#                               state.md の全文と見回りの要約を additionalContext で返す
#
# UserPromptSubmit は全プロンプトで走るので、"orchestrate" を含まない入力はシェルの文字列照合で捨てる。
# jq が無い・git が使えない・状態ファイルが無い場合は、何も出さずに exit 0（作業を止めない）。
# 状態ファイル: $(git rev-parse --git-common-dir)/orchestrator/state.md（コミットしない、全 worktree で共通）
input=$(cat)

case "$input" in
  *orchestrate* | *'"SessionStart"'*) ;;
  *) exit 0 ;;
esac

command -v jq >/dev/null 2>&1 || exit 0

hook_event=$(printf '%s' "$input" | jq -r '.hook_event_name // empty' 2>/dev/null)
case "$hook_event" in
  UserPromptSubmit | UserPromptExpansion | PostToolUse) event=record ;;
  SessionStart)
    [ "$(printf '%s' "$input" | jq -r '.source // empty' 2>/dev/null)" = compact ] || exit 0
    event=inject
    ;;
  *) exit 0 ;;
esac

root="${CLAUDE_PROJECT_DIR:-$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)}"
[ -n "$root" ] || root="$PWD"
common=$(git -C "$root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
state="$common/orchestrator/state.md"

session_id=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
# 状態ファイルに書く値なので、UUID に使われる文字以外を含むものは受け取らない
case "$session_id" in
  '' | *[!A-Za-z0-9_-]*) exit 0 ;;
esac

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

template() {
  cat <<EOF
orchestrator_session: $1
updated: $2

## レーン

| レーン名 | セッション名 | 今の作業 | 作業列 |
|---|---|---|---|

## ユーザー確認待ち

## マージ順の制約

## 保留・注意
EOF
}

if [ "$event" = record ]; then
  case "$hook_event" in
    UserPromptSubmit)
      prompt=$(printf '%s' "$input" | jq -r '.prompt // empty' 2>/dev/null)
      # 先頭の空白は許す。/orchestrate の直後は終端か空白だけ（/orchestrate-foo は別物）
      prompt="${prompt#"${prompt%%[![:space:]]*}"}"
      case "$prompt" in
        /orchestrate | "/orchestrate "* | /orchestrate$'\n'* | /orchestrate$'\t'*) ;;
        *) exit 0 ;;
      esac
      ;;
    UserPromptExpansion)
      name=$(printf '%s' "$input" | jq -r '.command_name // empty' 2>/dev/null)
      [ "$name" = orchestrate ] || exit 0
      ;;
    PostToolUse)
      skill=$(printf '%s' "$input" | jq -r '.tool_input.skill // empty' 2>/dev/null)
      [ "$skill" = orchestrate ] || exit 0
      ;;
    *) exit 0 ;;
  esac

  mkdir -p "$common/orchestrator" 2>/dev/null || exit 0
  previous=""
  [ -f "$state" ] && previous=$(sed -n 's/^orchestrator_session:[[:space:]]*//p' "$state" | head -1)
  ts=$(now)
  tmp="$state.tmp.$$"
  if [ -f "$state" ]; then
    # 最初の見出しより前の orchestrator_session・updated だけを差し替え、残り（レーン表など）はそのまま残す
    {
      printf 'orchestrator_session: %s\nupdated: %s\n' "$session_id" "$ts"
      awk '/^## /{body=1} body || !/^(orchestrator_session|updated):/' "$state"
    } >"$tmp" && mv "$tmp" "$state"
  else
    template "$session_id" "$ts" >"$tmp" && mv "$tmp" "$state"
  fi
  rm -f "$tmp" 2>/dev/null
  # UserPromptSubmit と UserPromptExpansion の両方が走っても、知らせるのは記録が変わった1回だけ
  if [ "$hook_event" != PostToolUse ] && [ "$previous" != "$session_id" ]; then
    echo "オーケストレーターの状態ファイル: ${state}（このセッションを orchestrator_session に記録した）"
  fi
  exit 0
fi

# SessionStart: 記録されたオーケストレーターのセッションでだけ注入する
[ -f "$state" ] || exit 0
recorded=$(sed -n 's/^orchestrator_session:[[:space:]]*//p' "$state" | head -1)
[ "$recorded" = "$session_id" ] || exit 0

{
  echo "このセッションはオーケストレーター（/orchestrate）。compact 前の状態を $state から再注入する。"
  echo "手順は .claude/skills/orchestrate/SKILL.md。見回りの定期実行（CronCreate）が残っているか CronList で確かめ、無ければ作り直す。"
  echo "見回り: bash \"\$(git rev-parse --show-toplevel)/.claude/skills/orchestrate/scripts/patrol.sh\""
  echo "  オープンPRの状態と前回との差分、マージ順の台帳の未解消の制約、regenerate-generated-docs.yml・e2e-rerecord.yml の失敗、master の CI の失敗を出す。"
  echo ""
  echo "---- state.md ----"
  head -c 8000 "$state"
} | jq -Rs '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: .}}'
exit 0
