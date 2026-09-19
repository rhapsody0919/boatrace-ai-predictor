#!/usr/bin/env bash
# push-with-retry.sh のローカル検証（BOA-360）。使い捨てのbareリポジトリとクローンのみ使用し、
# 本リポジトリには一切触れない。終了時に使い捨てリポジトリを削除する。
# 使い方: bash scripts/maintenance/verify-push-with-retry.sh
set -u
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/push-with-retry.sh"
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export PUSH_RETRY_SLEEP_BASE=0
pass=0; fail=0
ok()  { echo "  PASS: $1"; pass=$((pass+1)); }
ng()  { echo "  FAIL: $1"; fail=$((fail+1)); }

# 各シナリオ用に「リモート(bare) + 実行側クローン(work) + 競合側クローン(racer)」を作る
setup() {
  local name="$1" shallow="${2:-}"
  D="$ROOT/$name"; mkdir -p "$D"
  git init -q --bare -b master "$D/remote.git"
  git clone -q "$D/remote.git" "$D/seed" 2>/dev/null
  ( cd "$D/seed" && echo '{"v":0}' > health.json && echo a > other.txt && git add . && git commit -q -m init && git push -q origin master )
  if [ -n "$shallow" ]; then
    git clone -q --depth 1 "file://$D/remote.git" "$D/work" 2>/dev/null
  else
    git clone -q "$D/remote.git" "$D/work" 2>/dev/null
  fi
  git clone -q "$D/remote.git" "$D/racer" 2>/dev/null
  WORK="$D/work"; RACER="$D/racer"; REMOTE="$D/remote.git"
}
# 競合側がリモートの master を進める（別ファイル）
racer_push_other() {
  ( cd "$RACER" && git pull -q --rebase origin master && echo "$RANDOM" > "racer-$RANDOM.txt" && git add . && git commit -q -m "racer other" && git push -q origin master )
}
racer_push_same() {
  ( cd "$RACER" && git pull -q --rebase origin master && echo '{"v":"racer"}' > health.json && git add . && git commit -q -m "racer same file" && git push -q origin master )
}
# pre-push フック: 最初の N 回の push の直前に競合側が master を進める（= pull と push の間の競合を決定的に再現）
install_race_hook() {
  local n="$1"
  echo 0 > "$D/hook-count"
  cat > "$WORK/.git/hooks/pre-push" <<EOF
#!/usr/bin/env bash
c=\$(cat "$D/hook-count")
if [ "\$c" -lt "$n" ]; then
  echo \$((c+1)) > "$D/hook-count"
  cd "$RACER" && git pull -q --rebase origin master && echo "\$RANDOM" > "race-\$RANDOM.txt" && git add . && git commit -q -m "racer during push" && git push -q origin master
fi
exit 0
EOF
  chmod +x "$WORK/.git/hooks/pre-push"
}
local_commit() {
  ( cd "$WORK" && echo '{"v":1}' > health.json && git add health.json && git commit -q -m "chore: health [automated]" )
}
remote_has_health() { git -C "$REMOTE" show master:health.json 2>/dev/null; }
remote_log_count() { git -C "$REMOTE" rev-list --count master; }

echo "== S0: 旧方式(git pull --rebase; git push)は競合で失敗する（BOA-360の再現）"
setup s0; local_commit; install_race_hook 1
( cd "$WORK" && git pull -q --rebase origin master && git push -q origin master ) >/dev/null 2>&1; rc=$?
[ $rc -ne 0 ] && ok "旧方式は rc=$rc で失敗（rejected）" || ng "旧方式が成功してしまった（再現できていない）"

echo "== S1: push対象なし -> 成功で何もしない"
setup s1; before=$(remote_log_count)
( cd "$WORK" && bash "$SCRIPT" ) >"$D/out" 2>&1; rc=$?
[ $rc -eq 0 ] && grep -q "push対象のコミットがありません" "$D/out" && [ "$(remote_log_count)" = "$before" ] && ok "rc=0、リモート不変" || { ng "rc=$rc"; cat "$D/out"; }

echo "== S2: 競合なし -> 1回で push 成功"
setup s2; local_commit
( cd "$WORK" && bash "$SCRIPT" ) >"$D/out" 2>&1; rc=$?
[ $rc -eq 0 ] && [ "$(remote_has_health)" = '{"v":1}' ] && ok "rc=0、リモートに反映" || { ng "rc=$rc"; cat "$D/out"; }

echo "== S3: 開始前にリモートが先行（別ファイル）-> rebase して push 成功"
setup s3; local_commit; racer_push_other
( cd "$WORK" && bash "$SCRIPT" ) >"$D/out" 2>&1; rc=$?
[ $rc -eq 0 ] && [ "$(remote_has_health)" = '{"v":1}' ] && [ "$(git -C "$REMOTE" ls-tree --name-only master | grep -c racer-)" = 1 ] && ok "rc=0、競合側のコミットも保持" || { ng "rc=$rc"; cat "$D/out"; }

echo "== S4: fetch と push の間に master が進む（BOA-360と同じ競合）が2回続く -> 3回目で成功"
setup s4; local_commit; install_race_hook 2
( cd "$WORK" && bash "$SCRIPT" ) >"$D/out" 2>&1; rc=$?
[ $rc -eq 0 ] && grep -q "push試行 3/5" "$D/out" && [ "$(remote_has_health)" = '{"v":1}' ] && [ "$(git -C "$REMOTE" ls-tree --name-only master | grep -c 'race-')" = 2 ] && ok "rc=0、3回目で成功、競合側2コミットも保持" || { ng "rc=$rc"; cat "$D/out"; }

echo "== S5: 競合が上限を超えて続く -> rc=1 で失敗（黙って成功にしない）"
setup s5; local_commit; install_race_hook 99
( cd "$WORK" && PUSH_MAX_ATTEMPTS=3 bash "$SCRIPT" ) >"$D/out" 2>&1; rc=$?
[ $rc -eq 1 ] && grep -q "3回試行しても push できませんでした" "$D/out" && ok "rc=1" || { ng "rc=$rc"; cat "$D/out"; }

echo "== S6: 同じファイルが別の変更で更新されている -> rebase コンフリクトで rc=2、リトライせず、rebaseを中断して作業ツリーが正常"
setup s6; local_commit; racer_push_same; before=$(remote_log_count)
( cd "$WORK" && bash "$SCRIPT" ) >"$D/out" 2>&1; rc=$?
inprog=no; [ -d "$WORK/.git/rebase-merge" ] || [ -d "$WORK/.git/rebase-apply" ] && inprog=yes
[ $rc -eq 2 ] && grep -q "push試行 1/5" "$D/out" && ! grep -q "push試行 2/5" "$D/out" && [ "$inprog" = no ] && [ "$(remote_has_health)" = '{"v":"racer"}' ] && [ "$(remote_log_count)" = "$before" ] && ok "rc=2、1回で停止、rebase中断済み、リモートは競合側の内容のまま" || { ng "rc=$rc inprog=$inprog"; cat "$D/out"; }

echo "== S7: shallow clone(depth=1, actions/checkoutと同じ)で S4 相当"
setup s7 shallow; local_commit; install_race_hook 2
( cd "$WORK" && bash "$SCRIPT" ) >"$D/out" 2>&1; rc=$?
[ $rc -eq 0 ] && [ "$(remote_has_health)" = '{"v":1}' ] && ok "shallow でも rc=0" || { ng "rc=$rc"; cat "$D/out"; }

echo "== S8: 作業ツリーに未コミット変更（別の追跡ファイル）があっても rebase できる"
setup s8; local_commit; racer_push_other; echo dirty >> "$WORK/other.txt"
( cd "$WORK" && bash "$SCRIPT" ) >"$D/out" 2>&1; rc=$?
[ $rc -eq 0 ] && [ "$(remote_has_health)" = '{"v":1}' ] && ok "rc=0（autostash）" || { ng "rc=$rc"; cat "$D/out"; }

echo "== S8b: 未コミットの変更が競合側の更新と衝突（autostash再適用がコンフリクト）-> 警告のみで push は成功"
setup s8b; local_commit
( cd "$RACER" && git pull -q --rebase origin master && echo racer-edit > other.txt && git add . && git commit -q -m "racer edits other" && git push -q origin master )
echo local-edit > "$WORK/other.txt"
( cd "$WORK" && bash "$SCRIPT" ) >"$D/out" 2>&1; rc=$?
[ $rc -eq 0 ] && grep -q "autostash の再適用でコンフリクト" "$D/out" && [ "$(remote_has_health)" = '{"v":1}' ] && ok "rc=0、警告あり、health.json は push 済み" || { ng "rc=$rc"; cat "$D/out"; }

echo "== S8c: 競合ではない rebase 失敗（untracked ファイルが上書きされる）-> コンフリクトと誤診断せず、リトライして rc=1"
setup s8c; local_commit
( cd "$RACER" && git pull -q --rebase origin master && echo racer > newfile.txt && git add . && git commit -q -m "racer adds newfile" && git push -q origin master )
echo local-untracked > "$WORK/newfile.txt"
( cd "$WORK" && PUSH_MAX_ATTEMPTS=2 bash "$SCRIPT" ) >"$D/out" 2>&1; rc=$?
[ $rc -eq 1 ] && grep -q "push試行 2/2" "$D/out" && ! grep -q "rebase でコンフリクトしました" "$D/out" && ok "rc=1、2回試行、コンフリクト扱いにしていない" || { ng "rc=$rc"; cat "$D/out"; }

echo "== S9: force push を使っていない（リモート履歴が単調に伸びる。競合側のコミットが消えない）"
grep -nE "push .*(--force|-f |\+HEAD)" "$SCRIPT" >/dev/null && ng "force系の記述あり" || ok "スクリプトに force push の記述なし"

echo "== S10: detached HEAD -> rc=1"
setup s10; local_commit
( cd "$WORK" && git checkout -q --detach && bash "$SCRIPT" ) >"$D/out" 2>&1; rc=$?
[ $rc -eq 1 ] && ok "rc=1" || { ng "rc=$rc"; cat "$D/out"; }

echo
echo "結果: PASS=$pass FAIL=$fail"
[ "$fail" -eq 0 ]
