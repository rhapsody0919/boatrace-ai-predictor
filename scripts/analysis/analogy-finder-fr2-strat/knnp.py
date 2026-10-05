"""B: 展示・気象を外した knn_p（MD-6 と同じ重み・会場不一致ペナルティ λ=L/4）。k・α を cal 縮小標本で選び、test 縮小標本で予測"""
import sys, json, time, numpy as np, pandas as pd
sys.path.insert(0, '/Users/terukina/boatrace-ai-predictor/.claude/worktrees/recursing-poincare-93292f/scripts/analysis/analogy-finder-md6')
import md6common as M
from cm import *
from nn import neighbors, lam_base, probs

t0 = time.time()
r, Z, meta = M.load()
assert (r.race_id.values == R.race_id.values).all()
DROP = {'exh_time', 'exh_time_diff', 'exh_time_rank', 'weather_code', 'wind_x', 'wind_y', 'wind_speed', 'wave_height'}
keep = np.array([m['feature'] not in DROP for m in meta])
wv = M.weight_vector(meta, 'weights_main_win_F5.json')
X = (np.asarray(Z[:, keep], dtype=np.float32) * wv[keep]).astype(np.float32)
print('X', X.shape, round(time.time() - t0), flush=True)
cal_s = cluster_sample(per == 'cal'); test_s = cluster_sample(per == 'test')
np.save('cal_s.npy', cal_s); np.save('test_s.npy', test_s)
KS = [400, 800, 1600, 3200]; ALPHAS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]
pc = np.where(POOL_CAL)[0]; pt = np.where(POOL_TEST)[0]
L = lam_base(X, cal_s, pc); lam = L / 4
nbc = neighbors(X, cal_s, pc, 3200, lam, v[cal_s], v[pc])
print('cal search', round(time.time() - t0), flush=True)
prc = venue_prior(POOL_CAL, cal_s); yc = Y[cal_s]
grid = {}
for k in KS:
    for a in ALPHAS:
        grid[(k, a)] = float(ll(probs(nbc, k, Y, prc, a), yc).mean())
k, a = min(grid, key=grid.get)
a1600 = min([x for x in grid if x[0] == 1600], key=grid.get)[1]
nbt = neighbors(X, test_s, pt, 3200, lam, v[test_s], v[pt])
print('test search', round(time.time() - t0), flush=True)
np.save('nb_knnp_test.npy', nbt.astype(np.int32))
prt = venue_prior(POOL_TEST, test_s); yt = Y[test_s]; ok = yt >= 0
out = dict(n_cal=len(cal_s), n_test=len(test_s), dims=int(keep.sum()), L=L, lam=lam, k=k, alpha=a, cal_ll=round(grid[(k, a)], 5),
           alpha_k1600=a1600, cal_ll_k1600=round(grid[(1600, a1600)], 5),
           cal_grid={f'{kk}_{aa}': round(x, 5) for (kk, aa), x in grid.items()})
for name, kk, aa in [('knnp_sel', k, a), ('knnp_1600', 1600, a1600)]:
    p = probs(nbt, kk, Y, prt, aa)
    np.save(f'p_{name}.npy', p)
    out[name] = dict(test_ll=round(float(ll(p[ok], yt[ok]).mean()), 5), test_brier=round(float(brier(p[ok], yt[ok]).mean()), 5))
json.dump(out, open('knnp.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps({x: out[x] for x in out if x != 'cal_grid'}, ensure_ascii=False), round(time.time() - t0), flush=True)
