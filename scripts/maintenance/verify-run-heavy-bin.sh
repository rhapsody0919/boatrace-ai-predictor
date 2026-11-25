#!/usr/bin/env bash
# run-heavy.sh が、PATH に無い先頭のコマンド（playwright 等）をこのリポジトリの node_modules/.bin から解き、playwright なら --workers=1 を足すことを確かめる（2026-11-25、npm run の外の `run-heavy.sh playwright …` が command not found で2回落ちた）。
# 使い捨ての置き場に run-heavy.sh の写しと偽の node_modules/.bin/playwright を置いて回す。本物の playwright・本リポジトリの node_modules には触れない。
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/scripts/maintenance" "$tmp/node_modules/.bin" "$tmp/lock"
cp "$here/run-heavy.sh" "$tmp/scripts/maintenance/run-heavy.sh"
printf '#!/usr/bin/env bash\necho "fake-playwright $*"\n' > "$tmp/node_modules/.bin/playwright"
chmod +x "$tmp/node_modules/.bin/playwright"
fail=0
out="$(env -u CI PATH=/usr/bin:/bin RYUJIN_HEAVY_LOCK_DIR="$tmp/lock" bash "$tmp/scripts/maintenance/run-heavy.sh" playwright test e2e/x.spec.js 2>&1)"
case "$out" in
  *"fake-playwright test e2e/x.spec.js --workers=1"*) echo "OK PATH に無い playwright を node_modules/.bin から解き、--workers=1 を足す" ;;
  *) echo "NG PATH に無い playwright を解けない: $out"; fail=1 ;;
esac
out="$(env -u CI PATH=/usr/bin:/bin RYUJIN_HEAVY_LOCK_DIR="$tmp/lock" bash "$tmp/scripts/maintenance/run-heavy.sh" playwright test --workers=3 2>&1)"
case "$out" in
  *"--workers=3"*"--workers=1"*) echo "NG 指定済みの --workers を上書きした: $out"; fail=1 ;;
  *"fake-playwright test --workers=3"*) echo "OK 指定済みの --workers はそのまま" ;;
  *) echo "NG $out"; fail=1 ;;
esac
out="$(env -u CI PATH=/usr/bin:/bin RYUJIN_HEAVY_LOCK_DIR="$tmp/lock" bash "$tmp/scripts/maintenance/run-heavy.sh" echo hi 2>&1)"
[ "$out" = "hi" ] && echo "OK PATH にあるコマンドはそのまま" || { echo "NG PATH にあるコマンド: $out"; fail=1; }
if [ "$fail" -ne 0 ]; then echo "verify-run-heavy-bin: 失敗"; exit 1; fi
echo "verify-run-heavy-bin: すべて通った"
