"""事後（事前登録外）。cal だけ、test は見ない。
(a) m・α' が格子の端（m=200, α'=50）で決まったので、格子を広げた傾向
(b) 4軸目の決着の頑健さ: 最良 (α=1000, Gap5→C1→V→Ntop) と次点 (α=50, Gap5→C1→Ntop→S1b) の cal LL ペア差のクラスタブートストラップ"""
import json, numpy as np, warnings; warnings.filterwarnings('ignore')
from cm2 import *
src = open('eval2.py').read()
exec(src[src.index('def depth_counts'):src.index('def evalp')])
cs = json.load(open('c_select2.json')); S, AS = cs['S_star'], cs['chosen_alpha']
cal = np.where(per == 'cal')[0]; yc = Y[cal]; ok = yc >= 0
pH = strat_chain(S, AS, POOL_CAL, cal)[-1][0]; lH = ll(pH[ok], yc[ok])
csc = depth_counts(S, POOL_CAL, cal)
out = {'a_grid': {}}
for m in [200, 400, 800, 1600]:
    for ap in [50, 200, 1000, 3000]:
        p, dep, _ = backoff(csc, m, ap, POOL_CAL); l = ll(p[ok], yc[ok])
        out['a_grid'][f'm{m}_a{ap}'] = dict(cal_ll=round(float(l.mean()), 6), diff_vs_hier=round(float((l - lH).mean()), 6),
                                            share_4axes=round(float((dep == 4).mean()), 4))
        print(m, ap, out['a_grid'][f'm{m}_a{ap}'], flush=True)
alt = strat_chain(['Gap5', 'C1', 'Ntop', 'S1b'], 50, POOL_CAL, cal)[-1][0]; lA = ll(alt[ok], yc[ok])
alt2 = strat_chain(['Gap5', 'C1', 'Ntop', 'V'], 3000, POOL_CAL, cal)[-1][0]; lA2 = ll(alt2[ok], yc[ok])
out['b_best_minus_a50_S1b'] = boot(lH - lA, CLU[cal][ok])
out['b_best_minus_a3000_NtopV'] = boot(lH - lA2, CLU[cal][ok])
print(json.dumps({k: v for k, v in out.items() if k != 'a_grid'}))
json.dump(out, open('posthoc_backoff.json', 'w'), ensure_ascii=False, indent=1)
