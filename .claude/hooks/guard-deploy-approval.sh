#!/usr/bin/env bash
# PreToolUse(Bash): GitHub Environments の承認（pending_deployments）と保護ルールの変更、
# 本番 DB の適用ワークフロー（db-apply）の起動を Claude から実行させない。
# 本番 DB の1タップ承認（docs/operation/db-apply.md）はユーザー本人の操作が前提。
# Claude の gh はユーザーと同じアカウントでログインしているため、API で承認できてしまう。
# それを技術的に塞ぐ（2026-10-02 ユーザー承認、second-opinion-reviewer の指摘2）。
#
# 文字列の照合なので言い換えを全ては塞げない（docs/operation/db-apply.md「Claude（AI）は起動・承認しない」）。
# 照合する書き方:
#   承認        REST の pending_deployments、GraphQL の approveDeployments、Environments の API
#   起動        gh workflow run（ワークフロー名・表示名・数値 ID を問わない）、REST の .../dispatches
#   別経路      gh auth token（同じアカウントのトークンを取り出して node・curl から API を呼ぶ）
#
# 審査の素通り（2026-11-06、admin の bypass を外す決定。ADR-0097 の追記、system-architect の審査 P1-1）:
# Claude の素の gh はオーナー（admin、CODEOWNERS の持ち主）なので、bypass を外しても、オーナーの名義の承認や
# ruleset の書き換えで審査を越えられる。次を止める（読み取りの gh api は止めない）。
#   承認        gh pr review の --approve / -a、REST の pulls/N/reviews への書き込み、GraphQL の addPullRequestReview・submitPullRequestReview
#   ruleset     REST の /rulesets・/branches/…/protection への書き込み（-X・--method・-f・-F・--field・--raw-field・--input）、
#               GraphQL の createRepositoryRuleset・updateRepositoryRuleset・deleteRepositoryRuleset
#   bypass      gh pr merge の --admin。作成の App の鍵（RYUJIN_MAKER_KEY_FILE、既定 ~/.config/ryujin/ryujin-maker.pem）が
#               置かれた後だけ止める（置かれる前は ryujin-maker の名義でマージできないので、今までの道を残す）
# 照合は tool_input.command（jq で取り出し、改行を空白に寄せたもの）に対して行う。検証: scripts/maintenance/verify-guard-deploy-approval.js
input=$(cat)
case "$input" in
  *pending_deployments*|*approveDeployments*|*"/environments"*|*"gh workflow run"*|*"/dispatches"*|*"gh auth token"*)
    echo "本番 DB の適用ワークフローの起動・承認と、GitHub Environments の変更、ワークフローの手動起動はユーザー本人が行う（docs/operation/db-apply.md）。Claude からは実行しない。" >&2
    exit 2
    ;;
esac

# 審査の素通りの照合は、関係する語を含む呼び出しだけにする（毎回の Bash で grep を起こさない）
case "$input" in
  *review*|*merge*|*uleset*|*protection*|*PullRequestReview*|*push*) ;;
  *) exit 0 ;;
esac
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null | tr '\n' ' ')
[ -n "$cmd" ] || cmd=$input

deny_review() {
  echo "PR の承認・admin の bypass でのマージ・ruleset とブランチ保護の変更は Claude から実行しない（審査を素通りしないため。ADR-0097 の 2026-11-06 の追記）。マージは /merge-pr の手順で ryujin-maker の名義で行い、承認は審査の App（review.yml）かオーナー本人が付ける。" >&2
  exit 2
}
has() { printf '%s' "$cmd" | grep -Eq "$1"; }
end='([[:space:]"'"'"'=;&|)\\]|$)'
if has "gh[[:space:]]+pr[[:space:]]+review.*[[:space:]](--approve|-a)$end"; then deny_review; fi
if has 'addPullRequestReview|submitPullRequestReview|(create|update|delete)RepositoryRuleset'; then deny_review; fi
if has '/rulesets|/branches/[^[:space:]]*/protection|/pulls/[0-9]+/reviews'; then
  if has "(-X|--method)[[:space:]=]*[\"']?(PUT|PATCH|POST|DELETE)|[[:space:]](-[fF]|--field|--raw-field|--input)"; then deny_review; fi
fi
key=${RYUJIN_MAKER_KEY_FILE:-$HOME/.config/ryujin/ryujin-maker.pem}
if [ -f "$key" ] && has "gh[[:space:]]+pr[[:space:]]+merge.*[[:space:]]--admin$end"; then deny_review; fi

# Claude の push は claude/ の枝だけ（このリポジトリのときだけ見る）。他の接頭辞の枝は Vercel が Preview を作り
# 本番 DB の管理者キーを持って動き、review.yml も審査しない（2026-11-06、/code-review の指摘）。
# 今の枝が claude/ で始まるか、コマンドに claude/ の refspec があれば通す
if has "(^|[[:space:];&|(])git([[:space:]]+-[cC][[:space:]]+[^[:space:]]+)*[[:space:]]+push([[:space:]]|$)"; then
  dir=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
  [ -n "$dir" ] || dir=$PWD
  case "$(git -C "$dir" remote get-url origin 2>/dev/null)" in
    *rhapsody0919/boatrace-ai-predictor*)
      branch=$(git -C "$dir" branch --show-current 2>/dev/null)
      case "$branch" in
        claude/*) ;;
        *)
          if ! has "[[:space:]:]claude/"; then
            echo "このリポジトリへの Claude の push は claude/ の枝だけにする（今の枝: ${branch:-不明}）。git branch -m claude/<名前> に直してから push する（AGENTS.md の枝の表、/create-pr）。" >&2
            exit 2
          fi
          ;;
      esac
      ;;
  esac
fi
exit 0
