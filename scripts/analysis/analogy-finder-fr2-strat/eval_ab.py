"""A・B: 同じ P（F5 OOF または F5' OOF）で、較正写像・予測分布 k-NN（会場ペナルティなし/あり）・⑨（条件で完全一致→P 空間の近傍）を比べる。
ハイパーパラメータは cal 縮小標本（較正写像は cal 全件）で選び、test 縮小標本で1回だけ予測する。
使い方: python eval_ab.py F5p|F5
"""
import sys, json, time, numpy as np, pandas as pd, warnings; warnings.filterwarnings('ignore')
from sklearn.linear_model import LogisticRegression
import cm
from cm import *
from nn import neighbors, lam_base, probs

VAR = sys.argv[1]; t0 = time.time()
P = np.load(f'P_{VAR}.npy').astype(np.float32)
cal_s = np.load('cal_s.npy'); test_s = np.load('test_s.npy')
pc = np.where(POOL_CAL)[0]; pt = np.where(POOL_TEST)[0]
cal = np.where(per == 'cal')[0]; test = np.where(per == 'test')[0]
yc, yt = Y[cal_s], Y[test_s]; okt = yt >= 0
prc, prt = venue_prior(POOL_CAL, cal_s), venue_prior(POOL_TEST, test_s)
out = dict(variant=VAR, n_cal_s=len(cal_s), n_test_s=len(test_s))
PS = {}

def rec(name, p, extra=None):
    PS[name] = p; np.save(f'p_{VAR}_{name}.npy', p)
    out[name] = dict(test_ll=round(float(ll(p[okt], yt[okt]).mean()), 5), test_brier=round(float(brier(p[okt], yt[okt]).mean()), 5), **(extra or {}))
    print(name, json.dumps(out[name], ensure_ascii=False), round(time.time() - t0), flush=True)

# ---- 1着艇の LL（P 自体の質の確認）
out['win_ll_test_s'] = round(float(ll(P[test_s], W[test_s]).mean()), 5)

# ---- 較正写像: log P → 決まり手（多項ロジット）
Xl = np.log(np.clip(P, 1e-4, 1)).astype(float)
tr = pc[Y[pc] >= 0]; okc_full = Y[cal] >= 0
best = None
for C in [0.01, 0.1, 1, 10]:
    m = LogisticRegression(C=C, max_iter=2000).fit(Xl[tr], Y[tr])
    assert list(m.classes_) == list(range(6))
    l = float(ll(m.predict_proba(Xl[cal])[okc_full], Y[cal][okc_full]).mean())
    if best is None or l < best[0]: best = (l, C, m)
l, C, m = best
okf = Y[test] >= 0
rec('calmap', m.predict_proba(Xl[test_s]), dict(C=C, cal_ll_full=round(l, 5),
    test_ll_full=round(float(ll(m.predict_proba(Xl[test])[okf], Y[test][okf]).mean()), 5)))

# ---- 予測分布 k-NN（P 空間）
L = lam_base(P, cal_s, pc); out['L_P'] = L
for name, lam in [('pknn', 0.0), ('pknn_pen', 0.5 * L)]:
    nbc = neighbors(P, cal_s, pc, 3200, lam, v[cal_s], v[pc])
    g = {(k, a): float(ll(probs(nbc, k, Y, prc, a), yc).mean()) for k in [400, 800, 1600, 3200] for a in [1, 10, 50]}
    k, a = min(g, key=g.get)
    nbt = neighbors(P, test_s, pt, k, lam, v[test_s], v[pt])
    rec(name, probs(nbt, k, Y, prt, a), dict(k=k, alpha=a, lam=lam, cal_ll=round(g[(k, a)], 5)))
    if name == 'pknn_pen': np.save(f'nb_{VAR}_pknn_pen_test.npy', nbt.astype(np.int32))

# ---- ⑨ 系: 条件で完全一致（足りなければ末尾の軸から緩める）→ P 空間で会場不一致に +λ の近傍
lamH = 0.5 * L

def hybrid(axes, qidx, pidx, k):
    keys = {d: key(axes[:d]) for d in range(len(axes) + 1)}
    lvl = np.zeros(len(qidx), int)
    for d in range(len(axes), 0, -1):
        vc = pd.Series(keys[d][pidx]).value_counts()
        n = pd.Series(keys[d][qidx]).map(vc).fillna(0).to_numpy()
        lvl = np.where((lvl == 0) & (n >= k), d, lvl)
    nb = np.empty((len(qidx), k), np.int64)
    for d in range(len(axes), -1, -1):
        sel = np.where(lvl == d)[0]
        if len(sel) == 0: continue
        kq = keys[d][qidx[sel]]; kp = keys[d][pidx]
        for gk in np.unique(kq):
            qs = sel[kq == gk]; cand = pidx[kp == gk]
            nb[qs] = neighbors(P, qidx[qs], cand, k, lamH, v[qidx[qs]], v[cand])
    return nb, {int(d): round(float((lvl == d).mean()), 4) for d in range(len(axes) + 1)}

csel = json.load(open('c_select.json'))
SSTAR = csel['S_star']
# 元の ⑨ の軸（C1・旧 Gap 5帯・1号艇の展示順位3帯）
nw = col6('nat_win')
with np.errstate(all='ignore'): gap = nw[:, 0] - np.nanmax(nw[:, 1:], 1)
cm.A['GapOld'] = np.select([np.isnan(gap), gap < -1, gap < -0.3, gap < 0.3, gap < 1], [5, 0, 1, 2, 3], 4)
er = col6('exh_time_rank'); miss = np.isnan(er).any(1); e1 = np.nan_to_num(er[:, 0], nan=9)
cm.A['E1b'] = np.where(miss, -1, np.select([e1 <= 2, e1 <= 4], [0, 1], 2))
configs = {'h_Sstar': SSTAR}
if VAR == 'F5': configs['h_orig9'] = ['C1', 'GapOld', 'E1b']
for name, axes in configs.items():
    g = {}; nbs = {}
    for k in [200, 400, 800, 1600, 3200]:
        nbc, _ = hybrid(axes, cal_s, pc, k)
        for a in [1, 10, 50]: g[(k, a)] = float(ll(probs(nbc, k, Y, prc, a), yc).mean())
    k, a = min(g, key=g.get)
    nbt, lv = hybrid(axes, test_s, pt, k)
    rec(name, probs(nbt, k, Y, prt, a), dict(axes=axes, k=k, alpha=a, cal_ll=round(g[(k, a)], 5), level_share=lv,
                                             cal_grid={f'{kk}_{aa}': round(x, 5) for (kk, aa), x in g.items()}))
    np.save(f'nb_{VAR}_{name}_test.npy', nbt.astype(np.int32))
    if name == 'h_orig9':  # 前の比較と同じ k=1600・α=10 の固定値
        nbt, lv = hybrid(axes, test_s, pt, 1600)
        rec('h_orig9_fixed', probs(nbt, 1600, Y, prt, 10), dict(axes=axes, k=1600, alpha=10, level_share=lv))

json.dump(out, open(f'ab_{VAR}.json', 'w'), ensure_ascii=False, indent=1)
print('done', round(time.time() - t0), flush=True)
