#!/usr/bin/env bash
# 手元（ローカルMac）で重い処理（playwright test・vite build）を同時に走らせる本数を
# 制限するラッパー（BOA-769、2026-10-13）。
#
# 背景: 複数のworktree・セッション（Claude・Codex）が同じMacで並行稼働し、手元で
# npm run test:e2e・npm run build を同時に何本も実行した結果、load averageが
# 15分平均44（8コア）に達した（chrome-headless-shellのプロセスが12〜14本）。
#
# 動作: 「枠」を最大 RYUJIN_HEAVY_MAX_SLOTS 本（既定2）用意し、空き枠が無い間は
# 「順番待ち（n番目）」を1行出しながら待つ。空き枠を確保したらラップしたコマンドを
# 実行し、終了時（成功・失敗問わず）に枠を解放する。
#
# ロックはworktreeをまたいで効く場所（$HOME/.cache/ryujin-local-heavy/、
# worktreeごとの作業ディレクトリの外）に置く。枠にはpidを記録し、そのプロセスが
# 既に無い（kill -9等で死んだ）場合は次に通った別プロセスが枠を回収する。
#
# GitHub Actions（CI）では効かない（$CI が true/1 のときは素通しでそのまま実行する。
# CIのジョブは別々のマシン・コンテナで動くため、このマシンローカルの資源競合とは
# 無関係で、ここで待たせる意味が無い）。
#
# 使い方:
#   bash scripts/maintenance/run-heavy.sh <コマンド> [引数...]
#   例: bash scripts/maintenance/run-heavy.sh playwright test --workers=1
#
# 環境変数（テスト用途、通常は既定値のままでよい）:
#   RYUJIN_HEAVY_LOCK_DIR      ロックを置くディレクトリ（既定 $HOME/.cache/ryujin-local-heavy）
#   RYUJIN_HEAVY_MAX_SLOTS     同時に走らせる本数（既定 2）
#   RYUJIN_HEAVY_POLL_INTERVAL 順番待ち中の再試行間隔・秒（既定 2）
#
# 検証: scripts/maintenance/verify-run-heavy-lock.js（実プロセスを3本同時に起動し、
#   同時に走るのが2本までになることを確認する。実タイマー依存のためCIでは走らせない）

set -uo pipefail

if [ $# -eq 0 ]; then
  echo "使い方: run-heavy.sh <コマンド> [引数...]" >&2
  exit 2
fi

# CIでは素通し（別マシンで動くためローカルの資源競合が無い）
if [ "${CI:-}" = "true" ] || [ "${CI:-}" = "1" ]; then
  "$@"
  exit $?
fi

LOCK_DIR="${RYUJIN_HEAVY_LOCK_DIR:-$HOME/.cache/ryujin-local-heavy}"
MAX_SLOTS="${RYUJIN_HEAVY_MAX_SLOTS:-2}"
POLL_INTERVAL="${RYUJIN_HEAVY_POLL_INTERVAL:-2}"
SLOTS_DIR="$LOCK_DIR/slots"
WAIT_DIR="$LOCK_DIR/waiting"
mkdir -p "$SLOTS_DIR" "$WAIT_DIR"

# 自分の順番待ちチケットを取る（空いている最小の番号をmkdirで原子的に確保する。
# mkdirは既存なら必ず失敗するので、2プロセスが同じ番号を取ることは無い）
ticket=""
n=1
while [ -z "$ticket" ]; do
  if mkdir "$WAIT_DIR/$n" 2>/dev/null; then
    echo $$ > "$WAIT_DIR/$n/pid"
    ticket="$n"
  else
    n=$((n + 1))
  fi
done

acquired_slot=""
cleanup() {
  if [ -n "$acquired_slot" ]; then
    rm -rf "$SLOTS_DIR/$acquired_slot" 2>/dev/null || true
  fi
  rm -rf "$WAIT_DIR/$ticket" 2>/dev/null || true
}
trap cleanup EXIT

# 死んだプロセスが残した枠・順番待ちチケットを回収する
reap_dead() {
  local dir i f pid
  for dir in "$SLOTS_DIR" "$WAIT_DIR"; do
    for f in "$dir"/*; do
      [ -d "$f" ] || continue
      [ -f "$f/pid" ] || continue
      pid="$(cat "$f/pid" 2>/dev/null || echo "")"
      if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
        rm -rf "$f" 2>/dev/null || true
      fi
    done
  done
}

try_acquire() {
  local i d
  for i in $(seq 0 $((MAX_SLOTS - 1))); do
    d="$SLOTS_DIR/$i"
    if mkdir "$d" 2>/dev/null; then
      echo $$ > "$d/pid"
      acquired_slot="$i"
      return 0
    fi
  done
  return 1
}

# 自分より前にいる（チケット番号が小さい、まだ存在する）人数+1
rank_of_me() {
  local count=0 f other
  for f in "$WAIT_DIR"/*; do
    [ -d "$f" ] || continue
    other="$(basename "$f")"
    if [ "$other" -lt "$ticket" ] 2>/dev/null; then
      count=$((count + 1))
    fi
  done
  echo $((count + 1))
}

while true; do
  reap_dead
  if try_acquire; then
    rm -rf "$WAIT_DIR/$ticket" 2>/dev/null || true
    break
  fi
  echo "順番待ち（$(rank_of_me)番目）"
  sleep "$POLL_INTERVAL"
done

"$@"
exit $?
