#!/usr/bin/env bash
# PreToolUse(Bash): `gh pr merge` を止めるべきか判定する。
# 判定ロジックと、なぜGitHubのブランチ保護ではなくここで止めるのかは
# scripts/maintenance/guard-pr-merge.js の冒頭コメントを参照。
#
# matcher が Bash 全体なので、このフックは ls も npm も含むすべてのBash呼び出しで走る。
# 毎回 node を起動すると1ターンに数十回ぶんの起動コストが積み上がるため、
# "merge" を含まない入力はシェルの側で捨てる。
# node が無い・スクリプトが無い場合も素通しする（ゲートの不調で作業を止めない）。
input=$(cat)
case "$input" in
  *merge*) ;;
  *) exit 0 ;;
esac

# NODE_USE_SYSTEM_CA があると node の起動が 0.4〜1.4秒遅くなる（OS の証明書ストア待ち、BOA-657）。フックは外部へ TLS 通信しないので外す
unset NODE_USE_SYSTEM_CA
script="$CLAUDE_PROJECT_DIR/scripts/maintenance/guard-pr-merge.js"
[ -f "$script" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0
printf '%s' "$input" | node "$script"
