"""共通: レース表・条件の軸（出走表時点のみ）・縮小標本・指標・クラスタブートストラップ・階層 Dirichlet 層別"""
import numpy as np, pandas as pd

SIM = '/private/tmp/claude-501/-Users-terukina-boatrace-ai-predictor/f1ed2ade-b10e-4818-840e-88a5453a7589/scratchpad/sim/'
EPS = 1e-12; NC = 6
TECH = ['逃げ', '差し', 'まくり', 'まくり差し', '抜き', '恵まれ']
CANDS = ['V', 'C1', 'N1b', 'Gap5', 'C26nA', 'Ntop', 'M1b', 'S1b', 'G', 'Rd', 'RN']

R = pd.read_pickle(SIM + 'R.pkl')
per = R.period.to_numpy()
Y = R.y_tech.to_numpy().astype(int)
W = R.win_boat.to_numpy().astype(int) - 1
v = R.venue_code.to_numpy()
POOL_CAL = per == 'pool_cal'
POOL_TEST = np.isin(per, ['pool_cal', 'cal'])
CLU = (R.race_date.dt.strftime('%Y%m%d') + '_' + R.venue_code.astype(str)).to_numpy()


def col6(f):
    return np.stack([R[f'{f}_{i}'].to_numpy(np.float64) for i in range(1, 7)], 1)


def build_axes():
    A = pd.DataFrame(index=R.index)
    A['V'] = v
    cls = np.nan_to_num(col6('cls_ord'), nan=0).astype(int)   # 1=B2..4=A1
    A['C1'] = cls[:, 0]
    A['C26nA'] = (cls[:, 1:] >= 3).sum(1)
    nr = col6('nat_win_rank')
    A['N1b'] = np.select([np.isnan(nr[:, 0]), nr[:, 0] <= 1, nr[:, 0] <= 3], [3, 0, 1], 2)
    A['Ntop'] = np.argmin(np.where(np.isnan(nr), 99, nr), 1) + 1
    nw = col6('nat_win')
    with np.errstate(all='ignore'):
        gap = nw[:, 0] - np.nanmax(nw[:, 1:], 1)
    qs = np.nanquantile(gap[POOL_CAL], [0.2, 0.4, 0.6, 0.8])
    A['Gap5'] = np.where(np.isnan(gap), 5, np.searchsorted(qs, gap, side='right'))
    mr = col6('motor_2_rank'); sr = col6('st_mean30_rank')
    A['M1b'] = np.select([np.isnan(mr[:, 0]), mr[:, 0] <= 2, mr[:, 0] <= 4], [3, 0, 1], 2)
    A['S1b'] = np.select([np.isnan(sr[:, 0]), sr[:, 0] <= 2, sr[:, 0] <= 4], [3, 0, 1], 2)
    g = R.grade_code
    A['G'] = np.select([g.isna(), g == 0], [2, 0], 1)
    A['Rd'] = R.round_code.fillna(9).astype(int)   # 0予選 1準優 2優勝 3その他
    A['RN'] = np.select([R.race_number <= 4, R.race_number <= 8], [0, 1], 2)
    return A, qs, gap


A, GAP_Q, GAP = build_axes()


def key(cols):
    if not cols:
        return np.zeros(len(R), np.int64)
    return pd.util.hash_pandas_object(A[list(cols)].astype('int64'), index=False).to_numpy().view(np.int64)


def cluster_sample(mask, target=2000, seed=0):
    """「日×会場」のクラスタ単位で無作為抽出（約 target R）"""
    idx = np.where(mask)[0]
    cl = CLU[idx]
    u = np.unique(cl)
    rng = np.random.default_rng(seed)
    order = rng.permutation(u)
    cnt = pd.Series(cl).value_counts()
    cum = np.cumsum(cnt.reindex(order).to_numpy())
    take = set(order[:np.searchsorted(cum, target) + 1])
    return np.sort(idx[np.isin(cl, list(take))])


def ll(p, y):
    return -np.log(np.clip(p[np.arange(len(y)), y], EPS, 1))


def brier(p, y):
    oh = np.zeros_like(p); oh[np.arange(len(y)), y] = 1
    return ((p - oh) ** 2).sum(1)


def boot(diff, clusters, nb=1000, seed=0):
    """ペア差の平均と「日×会場」クラスタ単位ブートストラップ95%CI"""
    codes, inv = np.unique(clusters, return_inverse=True)
    s = np.bincount(inv, weights=diff); c = np.bincount(inv); k = len(codes)
    rng = np.random.default_rng(seed)
    m = np.empty(nb)
    for b in range(nb):
        i = rng.integers(0, k, k); m[b] = s[i].sum() / c[i].sum()
    return [round(float(diff.mean()), 5), round(float(np.percentile(m, 2.5)), 5), round(float(np.percentile(m, 97.5)), 5)]


def glob_prior(pool_mask, lab=None):
    lab = Y if lab is None else lab
    ok = pool_mask & (lab >= 0)
    return (np.bincount(lab[ok], minlength=NC) + 1) / (ok.sum() + NC)


def venue_prior(pool_mask, qidx, lab=None):
    lab = Y if lab is None else lab
    ok = pool_mask & (lab >= 0)
    pri = {x: (np.bincount(lab[ok & (v == x)], minlength=NC) + 1) / ((ok & (v == x)).sum() + NC) for x in np.unique(v)}
    return np.vstack([pri[x] for x in v[qidx]])


def counts_by_key(k, pool_mask, qidx, lab=None):
    lab = Y if lab is None else lab
    ok = pool_mask & (lab >= 0)
    ct = pd.crosstab(k[ok], lab[ok]).reindex(columns=range(NC), fill_value=0)
    return ct.reindex(k[qidx]).fillna(0).to_numpy(float)


def strat_chain(order, alpha, pool_mask, qidx, lab=None):
    """階層 Dirichlet: 根=全体、親=1つ前までの軸の層。戻り値: 各段の (p, n)"""
    p = np.tile(glob_prior(pool_mask, lab), (len(qidx), 1)); out = []
    for i in range(len(order)):
        cq = counts_by_key(key(order[:i + 1]), pool_mask, qidx, lab); n = cq.sum(1)
        p = (cq + alpha * p) / (n + alpha)[:, None]; out.append((p.copy(), n))
    return out
