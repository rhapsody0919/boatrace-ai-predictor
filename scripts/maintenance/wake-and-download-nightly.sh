#!/bin/bash
# 夜間の取得ジョブ（K/Bアーカイブ → N19 racelist）の自動再開スクリプト（BOA-353）
#
# 使い方: bash scripts/maintenance/wake-and-download-nightly.sh "2026-09-25 22:00"
#   nohup ... & disown で起動し、Claude Codeのセッション・アカウント切替から独立させる。
#
# 【このスクリプトが守る2つの教訓】
#
# 1. 実行場所を、消えうるworktreeに置かない（2026-09-25の事故）
#    旧版は `.claude/worktrees/docs-orchestration-integrate` とブランチ `docs/applied-093` を
#    ハードコードしていた。そのworktreeが `gh pr merge --delete-branch` でディレクトリごと消え、
#    ジョブは動かなくなり、worktree内に置いていた生アーカイブ（gitignore対象）も失われた。
#    このため、専用の作業ツリー（RUNNER_DIR、`.claude/worktrees/` の外に detached で作る）で動かし、
#    アーカイブもリポジトリの外（*_ARCHIVE）に置く。
#
# 2. 共有チェックアウトに対して git の破壊的操作をしない
#    旧版は、コードが古ければ `git checkout origin/master -- <file>` → commit → push まで行っていた。
#    このスクリプトは RUNNER_DIR を origin/master に合わせるだけ（detached・専用なので安全）で、
#    他の作業ツリーには一切触れない。
#
# 前提: RUNNER_DIR は `git worktree add --detach <RUNNER_DIR> origin/master` で作り、
#       `.env.local` を置き、`npm ci --ignore-scripts` 済みであること。
set -u

# 起動元のディレクトリに依存しない（起動したworktreeが後で消されても、このプロセスは動き続ける）。
# 以降のパスはすべて絶対パスで扱う
cd "$HOME" || exit 1

RUNNER_DIR="${RUNNER_DIR:-$HOME/boatrace-jobs-runner}"
KB_ARCHIVE="${KB_ARCHIVE:-$HOME/boatrace-archive-backup/kb-archive}"
RACELIST_ARCHIVE="${RACELIST_ARCHIVE:-$HOME/boatrace-racelist-archive}"
DAILY_LIMIT="${DAILY_LIMIT:-2000}"
# K/Bアーカイブの取得範囲（2026-09-25の事故で 2020-02 以降を失った。2019-04〜2020-01 は残っている）
KB_FROM="${KB_FROM:-2020-02-01}"
KB_TO="${KB_TO:-2025-12-02}"

log() { echo "[$(TZ=Asia/Tokyo date '+%F %H:%M:%S') JST] $*"; }

if [ $# -lt 1 ]; then
  echo "使い方: bash $0 \"YYYY-MM-DD HH:MM\"" >&2
  exit 1
fi

target=$(TZ=Asia/Tokyo date -j -f "%Y-%m-%d %H:%M" "$1" +%s) || exit 1

# 待ち時間と、そのあとの実行窓の終わり（既定 06:00 JST）までをまとめてスリープ抑止する。
# 【2026-09-25の実測】旧版は `caffeinate -i -t $((wait_sec + 30))` で**待ち時間しか**抑止して
# おらず、取得が始まった直後に失効した。実際にMacが 00:45〜05:28 のあいだ Idle Sleep に入り、
# 8時間の窓のうち約4.7時間を失った（取得できたのは896リクエストで、2.7時間分）。
WINDOW_END_HOUR="${WINDOW_END_HOUR:-6}"
window_end=$(TZ=Asia/Tokyo date -j -f "%Y-%m-%d %H:%M" \
  "$(TZ=Asia/Tokyo date -j -f %s "$target" +%Y-%m-%d) $(printf '%02d:00' "$WINDOW_END_HOUR")" +%s)
# 窓の終わりが開始時刻より前なら、日をまたぐ（22:00開始 → 翌06:00終了）
[ "$window_end" -le "$target" ] && window_end=$(( window_end + 86400 ))
caffeinate_sec=$(( window_end - $(date +%s) + 300 ))
if [ "$caffeinate_sec" -gt 0 ]; then
  caffeinate -i -t "$caffeinate_sec" &
  caffeinate_pid=$!
  trap 'kill "$caffeinate_pid" 2>/dev/null' EXIT
  log "スリープ抑止を開始（$(( caffeinate_sec / 60 ))分間、実行窓の終わり $(printf '%02d:00' "$WINDOW_END_HOUR") JST まで）"
fi

while [ "$(date +%s)" -lt "$target" ]; do sleep 30; done

log "起動（runner=${RUNNER_DIR}）"

if [ ! -d "$RUNNER_DIR/.git" ] && [ ! -f "$RUNNER_DIR/.git" ]; then
  log "中断: RUNNER_DIR が作業ツリーではありません: $RUNNER_DIR"
  exit 1
fi

# 専用の作業ツリーなので、origin/master へ合わせてよい（detached・他セッションは使わない）
git -C "$RUNNER_DIR" fetch origin master --quiet || { log "中断: fetch に失敗"; exit 1; }
git -C "$RUNNER_DIR" checkout --detach --quiet origin/master || { log "中断: checkout に失敗"; exit 1; }
log "runnerを origin/master に更新: $(git -C "$RUNNER_DIR" rev-parse --short HEAD)"

# コードが、既知の修正（PR #799: motor_boat_marker 異常の非致命化）を含むか検証する。
# 含まない場合は「直さずに中断」する（共有物を書き換えてまで実行を続けない）
if ! grep -q "motor_boat_marker:" "$RUNNER_DIR/scripts/maintenance/racelist-backfill.js"; then
  log "中断: racelist-backfill.js が PR #799 の修正を含みません（サーキットブレーカー再発の恐れ）"
  exit 1
fi

run_step() {
  local name="$1"; shift
  log "=== $name 開始 ==="
  node --env-file="$RUNNER_DIR/.env.local" "$@"
  local code=$?
  log "=== $name 終了（exit=${code}）==="
  # 0=完了 / 2=安全に停止（窓外・日次上限）は、どちらも正常。それ以外は後続を止める
  if [ "$code" -ne 0 ] && [ "$code" -ne 2 ]; then
    log "中断: $name が exit=$code で終了しました（4=サーキットブレーカー）"
    return 1
  fi
  return 0
}

# 公式サイトへの同時アクセスを避けるため、必ず逐次で行う。
#
# 【順序の理由】1夜（22-06）で取れるのは実測で約2,500リクエスト。K/B（残り約3,400）と
# N19（4,302）を合わせると3夜近くかかり、**先に走らせた方が後続を飢えさせる**。
# 2026-09-25の初回は K/B を先にしたため、N19 は0件のまま窓が閉じた。
# N19 は本番の欠損（3連率）を埋める＝ユーザーに見える価値があるのに対し、K/B は
# DBに投入済みのデータのローカル控えを作り直すだけなので、**N19 を先にする**。
run_step "N19 racelist download" \
  "$RUNNER_DIR/scripts/maintenance/racelist-backfill.js" download \
  --archive-dir="$RACELIST_ARCHIVE" --daily-limit="$DAILY_LIMIT" || exit 1

run_step "K/Bアーカイブ download" \
  "$RUNNER_DIR/scripts/maintenance/kb-backfill.js" download \
  --from="$KB_FROM" --to="$KB_TO" --archive-dir="$KB_ARCHIVE" --daily-limit="$DAILY_LIMIT" || exit 1

log "=== 状況 ==="
node --env-file="$RUNNER_DIR/.env.local" "$RUNNER_DIR/scripts/maintenance/kb-backfill.js" status \
  --from="$KB_FROM" --to="$KB_TO" --archive-dir="$KB_ARCHIVE"
node --env-file="$RUNNER_DIR/.env.local" "$RUNNER_DIR/scripts/maintenance/racelist-backfill.js" status \
  --archive-dir="$RACELIST_ARCHIVE"
log "完了"
