#!/bin/bash
# 使い方: ./run.sh <script.py>（model-prep の venv・データ・学習時コードを使う）
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MP="$HERE/../model-prep"
export ANALOGY_DATA_DIR="$MP/data"
export DYLD_FALLBACK_LIBRARY_PATH="$MP/venv/lib/python3.12/site-packages/sklearn/.dylibs"
export OMP_NUM_THREADS="${OMP_NUM_THREADS:-3}"
export OPENBLAS_NUM_THREADS="${OPENBLAS_NUM_THREADS:-3}"
renice -n 10 $$ >/dev/null
cd "$HERE" && exec "$MP/venv/bin/python" "$@"
