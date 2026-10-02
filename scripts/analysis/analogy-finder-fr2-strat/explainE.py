"""E: 言語化。基準＝対象レースと同じ S* の層の中の無作為（同数）。倍率＝近傍の一致率÷層内無作為の一致率。
倍率1.5以上で、S* の軸・S* と入れ子の軸・S* の軸との相関（Cramér's V）0.7以上の軸を除いたものを「似ている点」とする。
使い方: python explainE.py 9p|knnp"""
import sys, json, numpy as np, pandas as pd
from cm import *

TAG = sys.argv[1]
test_s = np.load('test_s.npy'); csel = json.load(open('c_select.json')); SS = csel['S_star']
if TAG == '9p':
    k = json.load(open('ab_F5p.json'))['h_Sstar']['k']; NB = np.load('nb_F5p_h_Sstar_test.npy')[:, :k]
elif TAG == 'knnp':
    k = json.load(open('knnp.json'))['k']; NB = np.load('nb_knnp_test.npy')[:, :k]
else:  # 事後: 帰無（近傍の代わりに同じ S* の層からもう一度無作為に k 件）
    k = 3200; NB = None
nw = col6('nat_win')
with np.errstate(all='ignore'): mx26 = np.nanmax(nw[:, 1:], 1)
CONT = {'1号艇の全国勝率': nw[:, 0], '2〜6号艇の最高勝率': mx26, '1号艇の直近の勝率': R.recent_win30_1.to_numpy(float),
        '1号艇の当地勝率': R.loc_win_1.to_numpy(float), '1号艇の平均ST': R.st_mean30_1.to_numpy(float),
        '1号艇のモーター2連率': R.motor_2_1.to_numpy(float), '節の日目': R.series_day.to_numpy(float),
        '1号艇の年齢': R.age_1.to_numpy(float), '1号艇の体重': R.weight_1.to_numpy(float)}
NAME = {'V': '会場', 'C1': '1号艇の級別', 'N1b': '1号艇の勝率順位帯', 'Gap5': '1号艇と他艇の勝率差5帯', 'C26nA': '2〜6号艇のA級の数',
        'Ntop': '勝率1位の艇', 'M1b': '1号艇のモーター順位帯', 'S1b': '1号艇の平均ST順位帯', 'G': 'グレード', 'Rd': 'ラウンド', 'RN': 'レース番号帯'}
NESTED = {'C1': ['N1b', '1号艇の全国勝率'], 'Gap5': ['N1b', 'Ntop', '1号艇の全国勝率', '2〜6号艇の最高勝率'], 'Ntop': ['N1b', 'Gap5'],
          'N1b': ['C1', 'Gap5', 'Ntop'], 'S1b': ['1号艇の平均ST'], 'M1b': ['1号艇のモーター2連率'], 'V': [], 'G': ['Rd'], 'Rd': ['G'], 'RN': [], 'C26nA': []}

# ---- 相関（pool の無作為5万R、連続値は5分位に丸めて Cramér's V）
rng = np.random.default_rng(0); smp = rng.choice(np.where(POOL_TEST)[0], 50000, replace=False)


def disc(name):
    if name in A.columns: return A[name].to_numpy()[smp]
    x = CONT[name][smp]; q = np.nanquantile(x, [.2, .4, .6, .8]); return np.where(np.isnan(x), 9, np.searchsorted(q, x))


def cramer(a, b):
    t = pd.crosstab(a, b).to_numpy(float); n = t.sum(); e = t.sum(1, keepdims=True) * t.sum(0, keepdims=True) / n
    chi = ((t - e) ** 2 / np.where(e > 0, e, 1)).sum(); r, c = t.shape
    return float(np.sqrt(chi / n / max(min(r, c) - 1, 1)))


ALL = CANDS + list(CONT)
corr = {a: {s: round(cramer(disc(a), disc(s)), 3) for s in SS} for a in ALL}
excluded = {}
for a in ALL:
    why = []
    if a in SS: why.append('S*の軸')
    for s in SS:
        if a in NESTED.get(s, []): why.append(f'{s}と入れ子')
        if a not in SS and corr[a][s] >= 0.7: why.append(f'{s}と相関{corr[a][s]}')
    if why: excluded[a] = why

# ---- 層内無作為の基準
leaf = [key(SS[:d]) for d in range(len(SS) + 1)]
pidx = np.where(POOL_TEST)[0]
groups = [pd.Series(pidx).groupby(leaf[d][pidx]).apply(np.array).to_dict() if d else {0: pidx} for d in range(len(SS) + 1)]
rows = []; per_axis = {a: [] for a in ALL}
for j, q in enumerate(test_s):
    for d in range(len(SS), -1, -1):
        g = groups[d].get(leaf[d][q] if d else 0)
        if g is not None and len(g) > 0: break
    base = rng.choice(g, k, replace=len(g) < k)
    nb = NB[j] if NB is not None else np.random.default_rng(j + 99).choice(g, k, replace=len(g) < k); kept = []
    for a in ALL:
        if a in A.columns:
            x = A[a].to_numpy(); sn = (x[nb] == x[q]).mean(); sb = (x[base] == x[q]).mean()
        else:
            x = CONT[a]
            if np.isnan(x[q]): continue
            db = np.abs(x[base] - x[q]); db = db[~np.isnan(db)]
            if len(db) == 0: continue
            thr = np.quantile(db, 1 / 3); sb = (db <= thr).mean()
            dn = np.abs(x[nb] - x[q]); sn = np.nanmean(np.where(np.isnan(dn), np.inf, dn) <= thr)
        ratio = sn / sb if sb > 0 else np.nan
        per_axis[a].append((sn, sb, ratio))
        if a not in excluded and ratio >= 1.5: kept.append(a)
    rows.append(kept)
cnt = np.array([len(r) for r in rows])
summ = {}
for a in ALL:
    arr = np.array(per_axis[a])
    summ[NAME.get(a, a)] = dict(match_nb=round(float(arr[:, 0].mean()), 3), match_base=round(float(arr[:, 1].mean()), 3),
                                ratio_of_means=round(float(arr[:, 0].mean() / arr[:, 1].mean()), 2),
                                share_ratio_ge_1_5=round(float(np.nanmean(arr[:, 2] >= 1.5)), 3),
                                kept_share=round(float(np.mean([a in r for r in rows])), 3), excluded=excluded.get(a))
out = dict(tag=TAG, k=k, S_star=SS, n_races=len(test_s),
           kept_count_dist={str(i): round(float((cnt == i).mean()), 3) for i in range(0, 5)} | {'5+': round(float((cnt >= 5).mean()), 3)},
           kept_count_mean=round(float(cnt.mean()), 2), axes=summ, corr_with_Sstar={NAME.get(a, a): corr[a] for a in ALL})
json.dump(out, open(f'explain_{TAG}.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps({x: out[x] for x in ['tag', 'k', 'kept_count_dist', 'kept_count_mean']}, ensure_ascii=False))
df = pd.DataFrame(summ).T.sort_values('kept_share', ascending=False); pd.set_option('display.width', 250); print(df.to_string())
