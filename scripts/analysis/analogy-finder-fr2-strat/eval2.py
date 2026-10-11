"""事前登録2 の 1（test で1回だけ）と 2（小さい層の戻し方: m・α' を cal で選び、test で1回）"""
import json, numpy as np, warnings; warnings.filterwarnings('ignore')
from cm2 import *

cs = json.load(open('c_select2.json'))
S, AS = cs['S_star'], cs['chosen_alpha']
VC, AV = ['V', 'C1'], cs['VC1_alpha']
cal = np.where(per == 'cal')[0]; test = np.where(per == 'test')[0]
MS, APS = [30, 50, 100, 200], [1, 10, 50]


def dist(n):
    return dict(median=float(np.median(n)), p10=float(np.percentile(n, 10)), p25=float(np.percentile(n, 25)),
                lt30=round(float((n < 30).mean()), 4), lt50=round(float((n < 50).mean()), 4),
                lt100=round(float((n < 100).mean()), 4), lt200=round(float((n < 200).mean()), 4), zero=round(float((n == 0).mean()), 4))


def depth_counts(order, pool, q, lab=None):
    """深さ 0..len(order) の層の件数（各 q × 6）。深さ0＝全体"""
    lab = Y if lab is None else lab
    ok = pool & (lab >= 0)
    c0 = np.bincount(lab[ok], minlength=NC).astype(float)
    out = [np.tile(c0, (len(q), 1))]
    for d in range(1, len(order) + 1):
        out.append(counts_by_key(key(order[:d]), pool, q, lab))
    return out


def backoff(cs_, m, ap, pool, lab=None):
    """件数が m 以上になる最も深い層を使い、その生の割合を親の層の生の割合へ α' で平滑化。深さ0は全体（+1 平滑）"""
    lab = Y if lab is None else lab
    ns = np.stack([c.sum(1) for c in cs_], 1)               # q × (D+1)
    depth = (ns >= m).sum(1) - 1                             # 入れ子なので単調。深さ0は常に満たす前提
    depth = np.maximum(depth, 0)
    gp = glob_prior(pool, lab)
    p = np.empty((len(depth), NC)); used_n = np.empty(len(depth))
    for d in range(len(cs_)):
        i = depth == d
        if not i.any(): continue
        c = cs_[d][i]; n = c.sum(1)
        if d == 0:
            p[i] = gp
        else:
            par = gp if d == 1 else cs_[d - 1][i] / cs_[d - 1][i].sum(1, keepdims=True)
            p[i] = (c + ap * par) / (n + ap)[:, None]
        used_n[i] = n
    return p, depth, used_n


def evalp(p, lab_q):
    ok = lab_q >= 0
    return ll(p[ok], lab_q[ok]), ok


out = {'S_star': S, 'alpha': AS, 'VC1_alpha': AV}

# ---- 1. test で1回: S* と V×C1（決まり手・1着艇・1着の進入コース） ----
res1 = {}
for lname, lab in [('tech', Y), ('win_boat', W), ('win_course', YC)]:
    lq = lab[test]
    pS, nS = strat_chain(S, AS, POOL_TEST, test, lab)[-1]
    pV, nV = strat_chain(VC, AV, POOL_TEST, test, lab)[-1]
    lS, ok = evalp(pS, lq); lV, _ = evalp(pV, lq)
    r = dict(n=int(ok.sum()), S_star_ll=round(float(lS.mean()), 5), VC1_ll=round(float(lV.mean()), 5),
             diff_S_minus_VC1=boot(lS - lV, CLU[test][ok]),
             S_star_brier=round(float(brier(pS[ok], lq[ok]).mean()), 5), VC1_brier=round(float(brier(pV[ok], lq[ok]).mean()), 5))
    if lname == 'tech':
        r['n_finest_S'] = dist(nS); r['n_finest_VC1'] = dist(nV)
        # 各段の層の件数（test）
        r['n_by_depth_S'] = {f'{d + 1}:{S[d]}': dist(x[1]) for d, x in enumerate(strat_chain(S, AS, POOL_TEST, test))}
        np.save('ll2_S_test.npy', lS); np.save('ll2_VC1_test.npy', lV)
    res1[lname] = r
    print(lname, json.dumps(r, ensure_ascii=False), flush=True)
out['test_1'] = res1

# ---- 2. 戻し方: cal で m・α' を選ぶ ----
csc = depth_counts(S, POOL_CAL, cal)
yc = Y[cal]
pH = strat_chain(S, AS, POOL_CAL, cal)[-1][0]
lH, okc = evalp(pH, yc)
grid = {}
for m in MS:
    for ap in APS:
        p, dep, un = backoff(csc, m, ap, POOL_CAL)
        l, _ = evalp(p, yc)
        grid[f'm{m}_a{ap}'] = dict(cal_ll=round(float(l.mean()), 6), diff_vs_hier=round(float((l - lH).mean()), 6),
                                   n_eps_hits=int((l > 20).sum()))
        print(m, ap, grid[f'm{m}_a{ap}'], flush=True)
bk = min(grid, key=lambda k: grid[k]['cal_ll'])
m_sel, ap_sel = int(bk[1:bk.index('_')]), int(bk[bk.index('_a') + 2:])
out['backoff_cal_grid'] = grid
out['backoff_cal_hier_ll'] = round(float(lH.mean()), 6)
out['backoff_choice'] = dict(m=m_sel, alpha_prime=ap_sel)
DN = {4: '4軸のまま', 3: '3軸', 2: '2軸', 1: '1軸', 0: '0軸（全体）'}


def depth_report(dep, un):
    return dict(depth_share={DN[d]: round(float((dep == d).mean()), 4) for d in range(len(S), -1, -1)},
                used_n=dict(median=float(np.median(un)), p10=float(np.percentile(un, 10))),
                dropped_axes_top={k: round(float(v), 4) for k, v in
                                  (pd.Series([','.join(S[d:]) if d < len(S) else '' for d in dep]).value_counts(normalize=True).head(5)).items()})


_, depc, unc = backoff(csc, m_sel, ap_sel, POOL_CAL)
out['backoff_cal_depth'] = depth_report(depc, unc)
# 選ばれなかった m の深さの割合も参考に（cal）
out['backoff_cal_depth_by_m'] = {m: depth_report(*backoff(csc, m, ap_sel, POOL_CAL)[1:])['depth_share'] for m in MS}

# ---- 2. test で1回 ----
cst = depth_counts(S, POOL_TEST, test)
yt = Y[test]
pB, dept, unt = backoff(cst, m_sel, ap_sel, POOL_TEST)
lB, okt = evalp(pB, yt)
lS = np.load('ll2_S_test.npy'); lV = np.load('ll2_VC1_test.npy')
out['backoff_test'] = dict(ll=round(float(lB.mean()), 5), diff_backoff_minus_hierS=boot(lB - lS, CLU[test][okt]),
                           diff_backoff_minus_VC1=boot(lB - lV, CLU[test][okt]), n_eps_hits=int((lB > 20).sum()),
                           **depth_report(dept, unt))
for lname, lab in [('win_boat', W), ('win_course', YC)]:
    p, _, _ = backoff(depth_counts(S, POOL_TEST, test, lab), m_sel, ap_sel, POOL_TEST, lab)
    l, ok = evalp(p, lab[test]); out['backoff_test'][f'{lname}_ll'] = round(float(l.mean()), 5)
print(json.dumps(out['backoff_test'], ensure_ascii=False), flush=True)
json.dump(out, open('eval2.json', 'w'), ensure_ascii=False, indent=1)
