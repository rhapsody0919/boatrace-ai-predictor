#!/usr/bin/env bash
# PreToolUse(Bash): GitHub Environments の承認（pending_deployments）と保護ルールの変更、
# 本番 DB の適用ワークフロー（db-apply）の起動を Claude から実行させない。
# 本番 DB の1タップ承認（docs/operation/db-apply.md）はユーザー本人の操作が前提。
# Claude の gh はユーザーと同じアカウントでログインしているため、API で承認できてしまう。
# それを技術的に塞ぐ（2026-10-02 ユーザー承認、second-opinion-reviewer の指摘2）。
input=$(cat)
case "$input" in
  *pending_deployments*|*"/environments"*|*"gh workflow run db-apply"*|*"workflows/db-apply.yml/dispatches"*)
    echo "本番 DB の適用ワークフローの起動・承認と、GitHub Environments の変更はユーザー本人が行う（docs/operation/db-apply.md）。Claude からは実行しない。" >&2
    exit 2
    ;;
esac
exit 0
