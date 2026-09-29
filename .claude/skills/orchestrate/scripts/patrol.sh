#!/usr/bin/env bash
# オーケストレーションの見回り。オープンPRの状態を取り、前回との差分を出す。
# あわせて、マージ順の台帳の未解消の制約・生成物/再録画ワークフローの失敗・master の CI の失敗を出す。
#
# 使い方: bash "$(git rev-parse --show-toplevel)/.claude/skills/orchestrate/scripts/patrol.sh"
# 前回のスナップショットは $(git rev-parse --git-common-dir)/orchestrator/ に置く（全 worktree で共通、コミットしない）。
set -u

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(git -C "$here" rev-parse --show-toplevel 2>/dev/null)" || {
  echo "NG: git リポジトリの中に置かれていません（${here}）" >&2
  exit 1
}
cd "$repo" || exit 1
common="$(git rev-parse --path-format=absolute --git-common-dir)"
state_dir="$common/orchestrator"
mkdir -p "$state_dir"
now_file="$state_dir/patrol-now.tsv"
prev_file="$state_dir/patrol-prev.tsv"

# 直近14日（macOS の date と GNU date の両方に対応）
since="$(date -u -v-14d +%Y-%m-%d 2>/dev/null || date -u -d '14 days ago' +%Y-%m-%d)"

git fetch -q origin 2>/dev/null || echo "注意: git fetch に失敗（origin/master が古い可能性あり）"

# gh が失敗したとき（認証切れ・ネットワーク）に、空のスナップショットで前回分を上書きしないよう、
# パイプにせず終了コードを見てから書く
pr_ok=1
if prs="$(gh pr list --state open --limit 50 \
  --json number,title,mergeStateStatus,isDraft,headRefOid,updatedAt,statusCheckRollup \
  --jq ".[] | select(.updatedAt > \"$since\") | [.number, .mergeStateStatus, (if .isDraft then \"draft\" else \"ready\" end), .headRefOid[0:8], ([.statusCheckRollup[]? | select(.name==\"e2e\" or .name==\"verify\") | \"\(.name)=\(.conclusion // .status)\"] | sort | join(\",\")), .title[0:60]] | @tsv")"; then
  printf '%s\n' "$prs" | sed '/^$/d' | sort -n >"$now_file"
else
  pr_ok=0
fi

echo "## master HEAD: $(git log origin/master --oneline -1)"
echo "## 直近1時間の master へのマージ"
git log origin/master --since='1 hour ago' --format='  %h %s' | head -10
echo "## オープンPR（${since} 以降に更新されたもの）"
if [ "$pr_ok" -eq 1 ]; then
  cat "$now_file"
  if [ -f "$prev_file" ]; then
    echo "## 前回からの変化"
    diff <(cut -f1-5 "$prev_file") <(cut -f1-5 "$now_file") | grep '^[<>]' || echo "  変化なし"
  fi
  cp "$now_file" "$prev_file"
else
  echo "  NG: gh pr list に失敗（前回のスナップショットは残した。gh auth status を確認）"
fi

# マージ順の台帳。merge-order.js list の出力は「#901 ← #902, #903 の後」「#905（制約なし）」の形
echo "## マージ順の台帳: 未解消の制約"
if ! ledger_out="$(node scripts/maintenance/merge-order.js list 2>&1)"; then
  echo "  台帳を読めない: $ledger_out"
  ledger_out=""
fi
unresolved=0
while IFS= read -r line; do
  case "$line" in "#"*) ;; *) continue ;; esac
  read -r -a nums <<<"$(printf '%s' "$line" | grep -oE '#[0-9]+' | tr -d '#' | tr '\n' ' ')"
  pr="${nums[0]}"
  self_state="$(gh pr view "$pr" --json state --jq .state 2>/dev/null || echo '?')"
  if [ "$self_state" = "MERGED" ] || [ "$self_state" = "CLOSED" ]; then
    echo "  #$pr は ${self_state}（台帳から remove してよい）"
    continue
  fi
  pending=""
  for pre in "${nums[@]:1}"; do
    s="$(gh pr view "$pre" --json state --jq .state 2>/dev/null || echo '?')"
    [ "$s" = "MERGED" ] || pending="$pending #$pre($s)"
  done
  if [ -n "$pending" ]; then
    echo "  #$pr は先行PRが未マージ:$pending"
    unresolved=$((unresolved + 1))
  fi
done <<<"$ledger_out"
[ "$unresolved" -eq 0 ] && echo "  なし"

# 生成物の再生成・E2E 再録画ワークフローの失敗
for wf in regenerate-generated-docs.yml e2e-rerecord.yml; do
  # e2e-rerecord.yml は #913 のマージ前は存在しない
  git cat-file -e "origin/master:.github/workflows/$wf" 2>/dev/null || continue
  echo "## $wf の直近の失敗（${since} 以降）"
  out="$(gh run list --workflow "$wf" --status failure --created ">=$since" --limit 5 \
    --json createdAt,headBranch,url --jq '.[] | "  \(.createdAt) \(.headBranch) \(.url)"' 2>&1)"
  echo "${out:-  なし}"
done

# master の CI（push で走るもの）の失敗
echo "## master の CI の直近の失敗（${since} 以降、push）"
out="$(gh run list --branch master --event push --status failure --created ">=$since" --limit 5 \
  --json workflowName,createdAt,headSha,url --jq '.[] | "  \(.createdAt) \(.workflowName) \(.headSha[0:8]) \(.url)"' 2>&1)"
echo "${out:-  なし}"
