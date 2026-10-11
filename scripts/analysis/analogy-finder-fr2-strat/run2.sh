#!/bin/bash
# 1分 load average が 32 未満になるまで10分ごとに待つ（開始から最大8時間）。各重い段の前で確認
cd "$(dirname "$0")"
PY=/Users/terukina/boatrace-ai-predictor/scripts/ml/.venv/bin/python
START=$(date +%s)
waitload() {
  while true; do
    L=$(sysctl -n vm.loadavg | awk '{print $2}')
    echo "$(date '+%F %T') load1=$L before $1" >> wait.log
    if awk "BEGIN{exit !($L < 32)}"; then return 0; fi
    if [ $(( $(date +%s) - START )) -gt 28800 ]; then echo "TIMEOUT before $1" >> wait.log; exit 3; fi
    sleep 600
  done
}
for s in prep2 c_select2 eval2; do
  if [ "$s" = prep2 ] && [ -f R2.pkl ]; then continue; fi
  waitload $s
  echo "$(date '+%F %T') START $s" >> wait.log
  $PY $s.py > $s.log 2>&1 || { echo "FAIL $s" >> wait.log; exit 1; }
  echo "$(date '+%F %T') DONE $s" >> wait.log
done
echo ALLDONE >> wait.log
