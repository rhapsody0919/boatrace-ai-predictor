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
input=$(cat)
case "$input" in
  *pending_deployments*|*approveDeployments*|*"/environments"*|*"gh workflow run"*|*"/dispatches"*|*"gh auth token"*)
    echo "本番 DB の適用ワークフローの起動・承認と、GitHub Environments の変更、ワークフローの手動起動はユーザー本人が行う（docs/operation/db-apply.md）。Claude からは実行しない。" >&2
    exit 2
    ;;
esac
exit 0
