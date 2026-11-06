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
# ruleset の書き換えで審査を越えられる。次を止める。
#   承認        gh pr review の --approve / -a、REST の pulls/N/reviews への書き込み、GraphQL の addPullRequestReview・submitPullRequestReview
#   bypass      gh pr merge の --admin
#   ruleset     REST の /rulesets・/branches/…/protection への書き込み（-X・--method・-f・-F・--field・--raw-field・--input）、
#               GraphQL の createRepositoryRuleset・updateRepositoryRuleset・deleteRepositoryRuleset
#   読み取り（gh api の GET）は止めない。検証: scripts/maintenance/verify-guard-deploy-approval.js
input=$(cat)
case "$input" in
  *pending_deployments*|*approveDeployments*|*"/environments"*|*"gh workflow run"*|*"/dispatches"*|*"gh auth token"*)
    echo "本番 DB の適用ワークフローの起動・承認と、GitHub Environments の変更、ワークフローの手動起動はユーザー本人が行う（docs/operation/db-apply.md）。Claude からは実行しない。" >&2
    exit 2
    ;;
esac

deny_review() {
  echo "PR の承認・admin の bypass でのマージ・ruleset とブランチ保護の変更は Claude から実行しない（審査を素通りしないため。ADR-0097 の 2026-11-06 の追記）。マージは /merge-pr の手順で ryujin-maker の名義で行い、承認は審査の App（review.yml）かオーナー本人が付ける。" >&2
  exit 2
}
write_flag='(-X|--method)[[:space:]=]*"?(PUT|PATCH|POST|DELETE)|[[:space:]](-f|-F|--field|--raw-field|--input)[[:space:]=]'
if printf '%s' "$input" | grep -Eq 'gh[[:space:]]+pr[[:space:]]+review([^;&|]*)[[:space:]](--approve|-a)([[:space:]"]|$)'; then deny_review; fi
if printf '%s' "$input" | grep -Eq 'gh[[:space:]]+pr[[:space:]]+merge[^;&|]*[[:space:]]--admin([[:space:]"=]|$)'; then deny_review; fi
if printf '%s' "$input" | grep -Eq 'addPullRequestReview|submitPullRequestReview|(create|update|delete)RepositoryRuleset'; then deny_review; fi
if printf '%s' "$input" | grep -Eq '/rulesets|/branches/[^[:space:]"]*/protection|/pulls/[0-9]+/reviews'; then
  if printf '%s' "$input" | grep -Eq "$write_flag"; then deny_review; fi
fi
exit 0
