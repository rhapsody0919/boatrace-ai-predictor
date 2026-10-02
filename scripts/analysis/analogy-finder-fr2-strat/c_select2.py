"""事前登録2 の 1: 軸の前向き選択（cal 全件、母集団 pool_cal、α 格子を広げる）。test は見ない"""
import json, numpy as np, warnings; warnings.filterwarnings('ignore')
from cm2 import *

ALPHAS = [10, 50, 200, 1000, 3000, 10000, 30000]
cal = np.where(per == 'cal')[0]; yc = Y[cal]; ok = yc >= 0
CQ = {}


def cq_of(order):
    k = tuple(order)
    if k not in CQ:
        CQ[k] = counts_by_key(key(list(order)), POOL_CAL, cal)
    return CQ[k]


res = {}
for alpha in ALPHAS:
    order = []; p = np.tile(glob_prior(POOL_CAL), (len(cal), 1)); prev = ll(p[ok], yc[ok]).mean(); trace = []
    root = round(float(prev), 5); stop = None
    while len(order) < 4:
        cand = []
        for c in CANDS:
            if c in order: continue
            cq = cq_of(order + [c]); n = cq.sum(1)
            pn = (cq + alpha * p) / (n + alpha)[:, None]
            cand.append((ll(pn[ok], yc[ok]).mean(), c, pn, float(np.median(n))))
        cand.sort(key=lambda x: x[0])
        l, c, pn, med = cand[0]
        step = dict(axis=c, cal_ll=round(float(l), 5), gain=round(float(prev - l), 5), med_n=med,
                    runner_up=[(x[1], round(float(x[0]), 5), x[3]) for x in cand[1:4]])
        if prev - l < 0.001: stop = f'gain<0.001 ({c} {prev - l:.5f})'; trace.append({**step, 'added': False}); break
        if med < 100: stop = f'median n<100 ({c} {med})'; trace.append({**step, 'added': False}); break
        order.append(c); p = pn; prev = l; trace.append({**step, 'added': True})
    if stop is None: stop = '4 axes'
    res[alpha] = dict(order=order, cal_ll=round(float(prev), 6), root_ll=root, stop=stop, trace=trace)
    print(alpha, order, res[alpha]['cal_ll'], stop, flush=True)
best = min(res, key=lambda a: res[a]['cal_ll'])
vc1 = {a: round(float(ll(strat_chain(['V', 'C1'], a, POOL_CAL, cal)[-1][0][ok], yc[ok]).mean()), 6) for a in ALPHAS}
out = dict(by_alpha=res, chosen_alpha=best, S_star=res[best]['order'], alpha_at_edge=best in (ALPHAS[0], ALPHAS[-1]),
           VC1_cal=vc1, VC1_alpha=min(vc1, key=vc1.get), gap5_bounds=[float(x) for x in GAP_Q], n_cal=int(len(cal)), n_cal_ok=int(ok.sum()))
json.dump(out, open('c_select2.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps({k: out[k] for k in ['chosen_alpha', 'S_star', 'alpha_at_edge', 'VC1_cal', 'VC1_alpha', 'gap5_bounds']}, ensure_ascii=False))
