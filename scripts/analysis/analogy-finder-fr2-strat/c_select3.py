"""事前登録3: 軸の前向き選択（4軸の上限なし）。止める条件は cal LL 改善<0.001 と 最細層の中央値<100 のみ。test は見ない"""
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
    root = round(float(prev), 6); stop = None
    while len(order) < len(CANDS):
        cand = []
        for c in CANDS:
            if c in order: continue
            cq = cq_of(order + [c]); n = cq.sum(1)
            pn = (cq + alpha * p) / (n + alpha)[:, None]
            cand.append((ll(pn[ok], yc[ok]).mean(), c, pn, float(np.median(n)), float(np.percentile(n, 10))))
        cand.sort(key=lambda x: x[0])
        l, c, pn, med, p10 = cand[0]
        step = dict(axis=c, cal_ll=round(float(l), 6), gain=round(float(prev - l), 6), med_n=med, p10_n=p10,
                    runner_up=[(x[1], round(float(prev - x[0]), 6), x[3]) for x in cand[1:4]])
        if prev - l < 0.001: stop = f'gain<0.001 ({c} {prev - l:.5f})'; trace.append({**step, 'added': False}); break
        if med < 100: stop = f'median n<100 ({c} {med})'; trace.append({**step, 'added': False}); break
        order.append(c); p = pn; prev = l; trace.append({**step, 'added': True})
    if stop is None: stop = 'all candidates'
    res[alpha] = dict(order=order, cal_ll=round(float(prev), 6), root_ll=root, stop=stop, trace=trace)
    print(alpha, order, res[alpha]['cal_ll'], stop, flush=True)
best = min(res, key=lambda a: res[a]['cal_ll'])
out = dict(by_alpha=res, chosen_alpha=best, order=res[best]['order'], alpha_at_edge=best in (ALPHAS[0], ALPHAS[-1]),
           same_as_S_star=res[best]['order'] == ['Gap5', 'C1', 'V', 'Ntop'] and best == 1000,
           gap5_bounds=[float(x) for x in GAP_Q], n_cal=int(len(cal)), n_cal_ok=int(ok.sum()))
json.dump(out, open('c_select3.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps({k: out[k] for k in ['chosen_alpha', 'order', 'alpha_at_edge', 'same_as_S_star']}, ensure_ascii=False))
