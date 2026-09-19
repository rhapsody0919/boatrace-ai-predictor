#!/usr/bin/env bash
# GitHub Actionsのジョブ内で作ったコミットを、masterの更新と競合しても失敗しないように push する（BOA-360）。
#
# 背景: 取得系ワークフローは「取得結果のJSONをコミットして master へ直接 push」する設計。
#   従来の `git pull --rebase` → `git push` は、pull と push の間（数百ミリ秒）に他のPRが
#   master へマージされると `! [rejected] master -> master (fetch first)` で失敗した
#   （2026-09-18 scrape-venue-motor-stats）。
#
# 動作: 次を最大 PUSH_MAX_ATTEMPTS 回（既定5回）繰り返す。force push は使わない。
#   1. origin の同ブランチを fetch する
#   2. push すべきローカルコミットが無ければ、何もせず成功で終了する
#   3. origin の先端へ rebase する（作業ツリーに未コミットの変更があっても止まらないよう autostash）
#   4. push する。競合（non-fast-forward）等で失敗したら、待機して 1. からやり直す
#
# 終了コード:
#   0: push 完了、または push 対象なし
#   1: リトライ上限まで push できなかった（ネットワーク・権限・競合し続ける更新頻度など）
#   2: rebase がコンフリクトした（同じファイルを別の変更が更新している）。
#      自動解決はせず、リトライもせずに失敗させる（どちらの内容が正しいか機械的に決められないため）
#
# 環境変数（テスト用途。通常は既定値のままでよい）:
#   PUSH_MAX_ATTEMPTS      最大試行回数（既定 5）
#   PUSH_RETRY_SLEEP_BASE  待機秒数の基準（既定 3。n回目の失敗後に n×基準 秒待つ）
#
# 前提: git の user.name / user.email は呼び出し側で設定済みであること（rebase でコミットを作り直すため）。

set -uo pipefail

MAX_ATTEMPTS="${PUSH_MAX_ATTEMPTS:-5}"
SLEEP_BASE="${PUSH_RETRY_SLEEP_BASE:-3}"

branch="$(git branch --show-current)"
if [ -z "$branch" ]; then
  echo "::error::detached HEAD のため push 先ブランチを特定できません" >&2
  exit 1
fi

# 戻り値: 0=完了 / 1=リトライ可能な失敗 / 2=rebase コンフリクト（リトライ不可）
sync_and_push() {
  git fetch --quiet origin "+refs/heads/${branch}:refs/remotes/origin/${branch}" || return 1

  local ahead
  ahead="$(git rev-list --count "origin/${branch}..HEAD")" || return 1
  if [ "$ahead" -eq 0 ]; then
    echo "push対象のコミットがありません（origin/${branch} と同じ、または先行コミット無し）"
    return 0
  fi

  if ! git rebase --autostash "origin/${branch}"; then
    git status --short || true
    git rebase --abort || true
    return 2
  fi

  git push origin "HEAD:refs/heads/${branch}" || return 1
}

attempt=1
while true; do
  echo "push試行 ${attempt}/${MAX_ATTEMPTS} (branch=${branch})"
  rc=0
  sync_and_push || rc=$?

  case "$rc" in
    0)
      exit 0
      ;;
    2)
      echo "::error::origin/${branch} への rebase でコンフリクトしました。同じファイルを別の変更が更新しています。自動解決せず失敗させます。内容を確認して手動で対応してください" >&2
      exit 2
      ;;
  esac

  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    echo "::error::${MAX_ATTEMPTS}回試行しても push できませんでした" >&2
    exit 1
  fi

  wait_sec=$((attempt * SLEEP_BASE))
  echo "push失敗。${wait_sec}秒待って再試行します"
  sleep "$wait_sec"
  attempt=$((attempt + 1))
done
