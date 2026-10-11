"""D: 表示%（平滑化なしの生の割合）の差。層別（V×C1・S*）と ⑨'・knn_p'（test 縮小標本）"""
import json, numpy as np
from cm import *

test_s = np.load('test_s.npy'); csel = json.load(open('c_select.json')); ab = json.load(open('ab_F5p.json')); kp = json.load(open('knnp.json'))
k9 = ab['h_Sstar']['k']; kk = kp['k']
NB9 = np.load('nb_F5p_h_Sstar_test.npy')[:, :k9]; NBK = np.load('nb_knnp_test.npy')[:, :kk]


def nb_dist(nb, lab):
    l = lab[nb]; return np.stack([(l == c).mean(1) for c in range(6)], 1) * 100


def strat_dist(axes, lab):
    """最も細かい層の生の割合。0件なら1つ上の層"""
    out = np.full((len(test_s), 6), np.nan); nfin = np.zeros(len(test_s))
    for d in range(len(axes), 0, -1):
        cq = counts_by_key(key(axes[:d]), POOL_TEST, test_s, lab); n = cq.sum(1)
        fill = np.isnan(out[:, 0]) & (n > 0)
        out[fill] = cq[fill] / n[fill, None] * 100
        if d == len(axes): nfin = n
    return out, nfin


D = {}; N = {}
for lab_name, lab in [('tech', Y), ('win', W)]:
    D[lab_name] = {}
    D[lab_name]['S*'], N['S*'] = strat_dist(csel['S_star'], lab)
    D[lab_name]['V×C1'], N['V×C1'] = strat_dist(['V', 'C1'], lab)
    D[lab_name]["⑨'"] = nb_dist(NB9, lab)
    D[lab_name]["knn_p'"] = nb_dist(NBK, lab)
res = {'k_9p': k9, 'k_knnp': kk,
       'n': {m: dict(median=float(np.median(N[m])), p10=float(np.percentile(N[m], 10)), p90=float(np.percentile(N[m], 90)),
                     lt100=round(float((N[m] < 100).mean()), 4), lt30=round(float((N[m] < 30).mean()), 4)) for m in ['S*', 'V×C1']}}
res['n']["⑨'"] = dict(fixed=k9); res['n']["knn_p'"] = dict(fixed=kk)
pairs = [('V×C1', "⑨'"), ('V×C1', "knn_p'"), ('S*', "⑨'"), ('S*', "knn_p'"), ("⑨'", "knn_p'"), ('S*', 'V×C1')]
for a, b in pairs:
    r = {}
    dt = np.abs(D['tech'][a] - D['tech'][b]); dw = np.abs(D['win'][a] - D['win'][b])
    r['tech_mean_abs_pp'] = round(float(dt.mean(1).mean()), 2)
    r['nige_mean_abs_pp'] = round(float(dt[:, 0].mean()), 2); r['nige_p90_pp'] = round(float(np.percentile(dt[:, 0], 90)), 2)
    r['tech_max_class_p90_pp'] = round(float(np.percentile(dt.max(1), 90)), 2)
    r['win_mean_abs_pp'] = round(float(dw.mean(1).mean()), 2)
    r['win1_mean_abs_pp'] = round(float(dw[:, 0].mean()), 2); r['win1_p90_pp'] = round(float(np.percentile(dw[:, 0], 90)), 2)
    res[f'{a} vs {b}'] = r
    print(a, 'vs', b, r, flush=True)
# 参考: 各方式の逃げ% の散らばり（レース間 SD）
res['nige_sd_across_races'] = {m: round(float(D['tech'][m][:, 0].std()), 2) for m in D['tech']}
print(res['n'], res['nige_sd_across_races'])
json.dump(res, open('disp.json', 'w'), ensure_ascii=False, indent=1)
