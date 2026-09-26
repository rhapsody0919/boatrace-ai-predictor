#!/bin/bash
# 取得ジョブ（wake-and-download-nightly.sh）の見張り役
#
# 使い方: WINDOW=any DAILY_LIMIT=9000 bash scripts/maintenance/supervise-download.sh
#   nohup ... & disown で起動する。
#
# 【なぜ要るか】取得ジョブ自体はMacのスリープに耐える（2026-09-25の実測: 00:45〜05:28 の
# スリープを挟んで同じプロセスが継続した）。ただし復帰直後は接続が数件失敗する（実測4件、
# "This operation was aborted"）。これが3連続するとサーキットブレーカーが開いて exit=4 で
# 止まり、**誰も再開しない**。プロセスが他の理由で落ちた場合も同じ。
#
# この見張り役は、ジョブが動いていなければ残量を前提に再起動する。取得は「取り直しをしない」
# 設計（アーカイブに保存済みの分は再取得しない）なので、再起動しても続きから進む。
#
# 【止め方】`pkill -f supervise-download.sh` で見張りを止める（実行中の取得ジョブは残るので、
# 合わせて止めるなら `pkill -f boatrace-nightly.sh`）。
set -u
cd "$HOME" || exit 1

JOB="${JOB:-$HOME/boatrace-nightly.sh}"
LOG_DIR="${LOG_DIR:-$HOME/boatrace-n19-logs}"
CHECK_INTERVAL="${CHECK_INTERVAL:-300}"   # 生存確認の間隔（秒）
BREAKER_BACKOFF="${BREAKER_BACKOFF:-1800}" # サーキットブレーカーで止まった後に待つ秒数
MAX_RESTARTS="${MAX_RESTARTS:-24}"
# 再起動したジョブがこの秒数より早く終わったら「やることが無い」とみなす
SHORT_RUN_SEC="${SHORT_RUN_SEC:-120}"
export WINDOW="${WINDOW:-any}"
export DAILY_LIMIT="${DAILY_LIMIT:-9000}"

log() { echo "[$(TZ=Asia/Tokyo date '+%F %H:%M:%S') JST][supervisor] $*"; }

mkdir -p "$LOG_DIR"
restarts=0
short_runs=0

log "見張り開始（確認間隔 ${CHECK_INTERVAL}秒 / 実行窓 ${WINDOW} / 日次上限 ${DAILY_LIMIT} / 最大再起動 ${MAX_RESTARTS}回）"

while :; do
  sleep "$CHECK_INTERVAL"

  if pgrep -f "boatrace-nightly.sh" >/dev/null; then
    continue
  fi

  if [ "$restarts" -ge "$MAX_RESTARTS" ]; then
    log "停止: 再起動が上限 ${MAX_RESTARTS}回に達しました。手動で状況を確認してください"
    exit 1
  fi

  # 直前のジョブがサーキットブレーカー（exit=4）で終わっていたら、間を置いてから再開する
  last_log=$(ls -t "$LOG_DIR"/continuous-*.log "$LOG_DIR"/nightly-*.log 2>/dev/null | head -1)
  if [ -n "$last_log" ] && grep -q "exit=4" "$last_log"; then
    log "直前のジョブがサーキットブレーカーで停止していました。${BREAKER_BACKOFF}秒待ってから再開します"
    sleep "$BREAKER_BACKOFF"
  fi

  restarts=$(( restarts + 1 ))
  stamp=$(TZ=Asia/Tokyo date '+%Y%m%d-%H%M%S')
  out="$LOG_DIR/continuous-resume-${stamp}.log"
  log "ジョブが動いていないので再起動します（${restarts}/${MAX_RESTARTS}回目、ログ: ${out}）"

  started=$(date +%s)
  bash "$JOB" now > "$out" 2>&1
  elapsed=$(( $(date +%s) - started ))
  log "再起動したジョブが終了しました（${elapsed}秒）"

  # すぐ終わる＝取り切った（または窓・上限で何もできない）。2回続いたら見張りを終える
  if [ "$elapsed" -lt "$SHORT_RUN_SEC" ]; then
    short_runs=$(( short_runs + 1 ))
    if [ "$short_runs" -ge 2 ]; then
      log "完了とみなして見張りを終了します（短時間で終わる実行が2回続きました）"
      exit 0
    fi
  else
    short_runs=0
  fi
done
