"""test 縮小標本で全方式の LL・Brier とペア差（日×会場クラスタ・ブートストラップ）"""
import json, os, numpy as np
from cm import *

test_s = np.load('test_s.npy'); y = Y[test_s]; ok = y >= 0; cl = CLU[test_s][ok]
F = {'S*': 'p_S_star', 'V×C1': 'p_VC1', "knn_p'(選択k)": 'p_knnp_sel', "knn_p'(k=1600)": 'p_knnp_1600'}
for V in ['F5', 'F5p']:
    for m in ['calmap', 'pknn', 'pknn_pen', 'h_Sstar', 'h_orig9', 'h_orig9_fixed']:
        F[f'{V}:{m}'] = f'p_{V}_{m}'
P = {k: np.load(f + '.npy') for k, f in F.items() if os.path.exists(f + '.npy')}
L = {k: ll(p[ok], y[ok]) for k, p in P.items()}; B = {k: brier(p[ok], y[ok]) for k, p in P.items()}
out = {'n': int(ok.sum()), 'n_clusters': int(len(np.unique(cl))), 'methods': {k: dict(ll=round(float(L[k].mean()), 5), brier=round(float(B[k].mean()), 5)) for k in P}}
for k in sorted(P, key=lambda k: L[k].mean()): print(f'{k:22s} LL {L[k].mean():.5f}  Brier {B[k].mean():.5f}')
pairs = [('F5:h_orig9', 'F5:calmap'), ('F5:h_orig9_fixed', 'F5:calmap'), ('F5:h_Sstar', 'F5:calmap'), ('F5:pknn_pen', 'F5:calmap'), ('F5:pknn', 'F5:calmap'),
         ('F5:h_orig9', 'F5:pknn_pen'),
         ('F5p:h_Sstar', 'F5p:calmap'), ('F5p:pknn_pen', 'F5p:calmap'), ('F5p:pknn', 'F5p:calmap'), ('F5p:h_Sstar', 'F5p:pknn_pen'),
         ('F5p:h_Sstar', "knn_p'(選択k)"), ('F5p:h_Sstar', "knn_p'(k=1600)"), ("knn_p'(選択k)", 'F5p:calmap'), ("knn_p'(選択k)", "knn_p'(k=1600)"),
         ('S*', 'F5p:h_Sstar'), ('S*', "knn_p'(選択k)"), ('S*', 'V×C1'), ('S*', 'F5p:calmap'), ('V×C1', "knn_p'(選択k)"), ('F5p:calmap', 'F5:calmap')]
out['pairs'] = {}
for a, b in pairs:
    if a in L and b in L:
        r = dict(ll=boot(L[a] - L[b], cl), brier=boot(B[a] - B[b], cl)); out['pairs'][f'{a} − {b}'] = r
        print(f'{a} − {b}: LL {r["ll"]}  Brier {r["brier"]}')
json.dump(out, open('compare.json', 'w'), ensure_ascii=False, indent=1)
