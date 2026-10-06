#!/bin/bash
# 使い方: ./run.sh <script.py>   （lightgbm の libomp を sklearn 同梱のものから読む。nice は DYLD_* を落とすので renice）
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export ANALOGY_DATA_DIR="$HERE/data"
export DYLD_FALLBACK_LIBRARY_PATH="$HERE/venv/lib/python3.12/site-packages/sklearn/.dylibs"
export OMP_NUM_THREADS="${OMP_NUM_THREADS:-3}"
renice -n 10 $$ >/dev/null
cd "$HERE" && exec venv/bin/python "$@"
