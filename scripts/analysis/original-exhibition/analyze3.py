# 「6艇で一番」の印: 順位1位（同値はmin＝同着1位も1位）の艇とそれ以外の1着率、コース別・展示タイム区分別・前半/後半
# analyze.py が保存した boats_f.pkl を使う
import pandas as pd, os
from common import WORK, JA, wil, fmt, grp

b=pd.read_pickle(os.path.join(WORK,'boats_f.pkl'))
for it in ['mawari','lap','straight','exhibition_time']:
  x=b[b[it+'_rank'].notna()]; one=x[it+'_rank']==1
  print(f'\n### {JA[it]} 1位の艇 vs 2〜6位')
  for lab,m in [('1コース',x.entry_course==1),('2〜6コース',x.entry_course>=2)]+[(f'{c}コース',x.entry_course==c) for c in range(2,7)]:
    y=x[m]; o=one[m]; print(f'  [{lab}] 1位 {fmt(y[o].win.sum(),o.sum())} / それ以外 {fmt(y[~o].win.sum(),(~o).sum())}')
  if it!='exhibition_time':
    x2=x[x.exhibition_time_rank.notna()]; e=grp(x2.exhibition_time_rank); o=x2[it+'_rank']==1
    for lab,m in [('1コース',x2.entry_course==1),('2〜6コース',x2.entry_course>=2)]:
      print(f'  展示タイム区分ごと [{lab}] '+' | '.join(f"{g_}: 1位 {fmt(x2[m&(e==g_)&o].win.sum(),(m&(e==g_)&o).sum())} 他 {wil(x2[m&(e==g_)&~o].win.sum(),(m&(e==g_)&~o).sum())[0]:.3f}" for g_ in ['上位1-2','中位3-4','下位5-6']))
  # 前半/後半で安定しているか
  for lab,m in [('〜10/01',x.race_date<='2026-10-01'),('10/02〜',x.race_date>'2026-10-01')]:
    y=x[m&(x.entry_course>=2)]; o=y[it+'_rank']==1; print(f'  時期 {lab} 2〜6コース: 1位 {fmt(y[o].win.sum(),o.sum())} / 他 {wil(y[~o].win.sum(),(~o).sum())[0]:.3f}')
