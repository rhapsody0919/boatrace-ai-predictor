from load import *
import json, sys
r, B = load()
sm = B['st_mean30']; sr = B['st_result']
ret = (B['is_flying'] | B['is_late']).any(1)
END = pd.Timestamp('2026-09-26')
inper = (r.race_date <= END).values
stok = ~np.isnan(sr).any(1); mok = ~np.isnan(sm).any(1)
POP = inper & r.waku.values & ~ret & stok & mok
assert int(POP.sum()) == 313938, POP.sum()
bn = B['boat_number']; assert (bn[POP] == np.arange(1, 7)).all()
NAMES = FORMS + ['none']; MAIN5 = ['d2', 'd3', 'kado', 'd1', 'dash']
yr = r.race_date.dt.year.values; venue = r.venue_code.values; cls = B['cls_ord']

# ---- 艇単位の値を race×6 に揃える
bt = pd.read_pickle(H + '/work2_boats.pkl')
pos = pd.Series(np.arange(len(r)), index=r.race_id.values)
bt = bt[bt.race_id.isin(pos.index) & bt.boat_number.between(1, 6)]
ri = pos[bt.race_id.values].values; bj = bt.boat_number.values.astype(int) - 1
def arr(col, fill=np.nan):
    a = np.full((len(r), 6), fill); a[ri, bj] = bt[col].values.astype(float); return a
V = {k: arr(k + '_m') for k in ['A', 'B', 'C', 'D', 'E', 'F', 'F2']}
N = {k: arr(k + '_n', 0) for k in ['A', 'B', 'C', 'D', 'E', 'F', 'F2']}
WB = arr('wbin', 0)[:, 0].astype(int); WS = arr('wsec', 0)[:, 0].astype(int)
RID = arr('racer_id', 0).astype(int)
# 検算: 自前の A と races.pkl の st_mean30
d = np.abs(V['A'][POP] - sm[POP]); chk_A = {'max_abs_diff': float(np.nanmax(d)), 'share_diff_gt_1e-4': float(np.nanmean(d > 1e-4)), 'nan_mine': int(np.isnan(V['A'][POP]).sum())}
print('checkA', chk_A, flush=True)
V['A'] = sm.copy(); N['A'] = B['st_n'].copy()
MINRUN = 5; MINRUN_EF = 100
def avail(k):
    th = MINRUN_EF if k in ('E', 'F', 'F2') else MINRUN
    return (N[k] >= th) & ~np.isnan(V[k])
AV = {k: avail(k) for k in V}

def W(k, n):
    p, lo, hi = wilson(k, n); return {'x': int(k), 'n': int(n), 'p': None if n == 0 else round(p, 3), 'lo': None if n == 0 else round(lo, 3), 'hi': None if n == 0 else round(hi, 3)}
def actual(idx): return forms(np.round(sr[idx] * 100).astype(int))
def form_table(P, A):
    out = {}
    for j, f in enumerate(NAMES):
        pj = P[:, j]; aj = A[:, j]
        hit = W((pj & aj).sum(), pj.sum()); miss = W((~pj & aj).sum(), (~pj).sum())
        out[f] = {'pred': W(pj.sum(), len(pj)), 'same': hit, 'not_pred': miss,
                  'lift': None if not hit['n'] or not miss['n'] or miss['p'] == 0 else round((hit['x'] / hit['n']) / (miss['x'] / miss['n']), 2)}
    return out
def dev(M): return M - M.mean(1, keepdims=True)
def kfac(Dp, idx):
    return float(np.std(dev(sr[idx])) / np.std(Dp))
def pred_forms(Dp, idx, k):
    mu = sm[idx].mean(1, keepdims=True)  # 中心はどれでも形は同じ（差だけで決まる）
    return forms(np.round((mu + k * Dp) * 100).astype(int))
def evaluate(Dp, idx, k=None):
    """Dp: 6艇内の差（idx 行）。k を省くと同じ方式で「本番の差の SD ÷ 予想の差の SD」"""
    k = round(kfac(Dp, idx), 2) if k is None else k
    A = actual(idx); P = pred_forms(Dp, idx, k)
    da = dev(sr[idx]); c = float(np.corrcoef(Dp.ravel(), da.ravel())[0, 1])
    ft = form_table(P, A)
    m5 = [ft[f]['lift'] for f in MAIN5 if ft[f]['lift'] is not None]
    return {'n': int(len(idx)), 'K': k, 'corr_dev': round(c, 3), 'lift_mean5': round(float(np.mean(m5)), 3) if m5 else None, 'lift_mean5_k': len(m5), 'forms': ft}
def lifts(e): return {f: e['forms'][f]['lift'] for f in NAMES}

res = {'meta': {'pop': int(POP.sum()), 'minrun': MINRUN, 'minrun_EF': MINRUN_EF, 'check_A_rebuilt_vs_st_mean30': chk_A}}
idxP = np.where(POP)[0]
# ---- Q1 相関と欠け
q1 = {}
for k in ['A', 'B', 'C', 'D', 'E', 'F', 'F2']:
    av = AV[k][idxP]; full = av.all(1)
    x = V[k][idxP][av]; y = sr[idxP][av]
    ii = idxP[full]; Dp = dev(V[k][ii]); da = dev(sr[ii])
    q1[k] = {'boat_missing': round(float(1 - av.mean()), 4), 'race_missing_any': round(float(1 - full.mean()), 4),
             'boat_corr_raw': round(float(np.corrcoef(x, y)[0, 1]), 3),
             'boat_corr_dev': round(float(np.corrcoef(Dp.ravel(), da.ravel())[0, 1]), 3) if len(ii) else None,
             'races_full': int(full.sum()),
             'n_median': float(np.median(N[k][idxP])), 'n_share_ge30': round(float((N[k][idxP] >= 30).mean()), 3) if k not in ('E', 'F', 'F2') else None}
    if k == 'F2':
        q1[k]['note'] = '3m以上の風のときだけ方位で分ける（3m未満は F と同じ組）'
# 走数の下限を変えたときの欠け（B・C・D）
q1['missing_by_minrun'] = {k: {str(m): round(float(1 - ((N[k][idxP] >= m)).mean()), 4) for m in [1, 3, 5, 10, 20, 30]} for k in ['A', 'B', 'C', 'D']}
res['q1'] = q1
print(json.dumps(q1, ensure_ascii=False)[:1500], flush=True)

# 共通の比較母集団: A〜D・E・F がそろう
COM = POP & AV['B'].all(1) & AV['C'].all(1) & AV['D'].all(1) & AV['E'].all(1) & AV['F'].all(1)
idxC = np.where(COM)[0]
res['meta']['common'] = int(COM.sum())
res['meta']['common_years'] = {str(y): int(v) for y, v in pd.Series(yr[idxC]).value_counts().sort_index().items()}
# 共通母集団での相関（艇ごと、生値と6艇内の差）
res['q1_common'] = {k: {'boat_corr_raw': round(float(np.corrcoef(V[k][idxC].ravel(), sr[idxC].ravel())[0, 1]), 3),
                        'boat_corr_dev': round(float(np.corrcoef(dev(V[k][idxC]).ravel(), dev(sr[idxC]).ravel())[0, 1]), 3)} for k in ['A', 'B', 'C', 'D', 'E', 'F']}

# ---- Q2 単独の lift
q2 = {}
q2['own_subset'] = {}
for k in ['A', 'B', 'C', 'D', 'E', 'F']:
    ii = np.where(POP & AV[k].all(1))[0]
    q2['own_subset'][k] = {'self': evaluate(dev(V[k][ii]), ii), 'A_same_races': evaluate(dev(sm[ii]), ii, 2.11)}
q2['common'] = {k: evaluate(dev(V[k][idxC]), idxC) for k in ['A', 'B', 'C', 'D', 'E', 'F']}
q2['common']['A_K2.11'] = evaluate(dev(sm[idxC]), idxC, 2.11)
# 欠けたら A で埋める（全 313,938R）
def fb(k): return np.where(AV[k], V[k], sm)
q2['fallback_full'] = {k: evaluate(dev(fb(k)[idxP]), idxP) for k in ['B', 'C', 'D']}
q2['fallback_full']['A'] = evaluate(dev(sm[idxP]), idxP)
res['q2'] = q2
print('q2 common', {k: (v['K'], v['corr_dev'], v['lift_mean5']) for k, v in q2['common'].items()}, flush=True)

# ---- E・F: 会場・条件ごとの形の出やすさ
Aall = actual(idxP)
def rate_cells(keyarr, idx, A):
    out = {}
    ks = pd.Series([tuple(x) if isinstance(x, (list, tuple, np.ndarray)) else x for x in keyarr])
    for key in sorted(set(ks)):
        s = (ks == key).values
        cell = {'n': int(s.sum())}
        for j, f in enumerate(NAMES):
            y = W(A[s, j].sum(), s.sum()); o = W(A[~s, j].sum(), (~s).sum())
            cell[f] = {**y, 'lift': None if not y['n'] or not o['p'] else round(y['p'] / o['p'], 2)}
        out['-'.join(map(str, key)) if isinstance(key, tuple) else str(key)] = cell
    return out
WBL = {1: '0-2m', 2: '3-4m', 3: '5m+'}; SECL = {0: '3m未満', 1: '北', 2: '東', 3: '南', 4: '西'}
res['national'] = {f: W(Aall[:, j].sum(), len(idxP)) for j, f in enumerate(NAMES)}
res['E_venue'] = rate_cells(venue[idxP], idxP, Aall)
okw = WB[idxP] > 0
res['F_venue_wind'] = rate_cells([(int(v), WBL[w]) for v, w in zip(venue[idxP][okw], WB[idxP][okw])], idxP[okw], Aall[okw])
res['F_wind_national'] = rate_cells([WBL[w] for w in WB[idxP][okw]], idxP[okw], Aall[okw])
ok3 = WB[idxP] >= 2
res['F2_venue_wind_sector'] = rate_cells([(int(v), WBL[w], SECL[s]) for v, w, s in zip(venue[idxP][ok3], WB[idxP][ok3], WS[idxP][ok3])], idxP[ok3], Aall[ok3])
# 安定性: 2019-2024 の会場（会場×風）ごとの割合 と 2025-2026 の割合の相関（形ごと）
def stability(keys, sel_early, sel_late, minn=200):
    out = {}
    ks = pd.Series(keys)
    for j, f in enumerate(NAMES):
        e = pd.Series(Aall[sel_early, j]).groupby(ks[sel_early].values).agg(['mean', 'size'])
        l = pd.Series(Aall[sel_late, j]).groupby(ks[sel_late].values).agg(['mean', 'size'])
        m = e.join(l, lsuffix='_e', rsuffix='_l').dropna(); m = m[(m.size_e >= minn) & (m.size_l >= minn)]
        out[f] = {'cells': int(len(m)), 'corr': round(float(np.corrcoef(m.mean_e, m.mean_l)[0, 1]), 3) if len(m) > 2 else None,
                  'range_late': [round(float(m.mean_l.min()), 3), round(float(m.mean_l.max()), 3)] if len(m) else None}
    return out
ye = yr[idxP] <= 2024; yl = yr[idxP] >= 2025
res['EF_stability'] = {'venue': stability(list(venue[idxP]), ye, yl),
                       'venue_wind': stability([f'{v}-{w}' for v, w in zip(venue[idxP], WB[idxP])], ye & okw, yl & okw)}
# 前の期間の割合を「予想」として使ったときの当たり方: 2025-2026 のレースに、2019-2024 の会場（×風）の割合を当てる
def prior_rate_eval(keys):
    ks = pd.Series(keys); out = {}
    for j, f in enumerate(NAMES):
        pr = pd.Series(Aall[ye, j]).groupby(ks[ye].values).mean()
        p = ks[yl].map(pr).values; y = Aall[yl, j].astype(float); ok = ~np.isnan(p)
        nat = Aall[ye, j].mean()
        # 予想の割合が全国の1.2倍以上のレースでの実際の割合 vs それ以外
        hi = p[ok] >= 1.2 * nat
        out[f] = {'brier_cell': round(float(np.mean((p[ok] - y[ok]) ** 2)), 5), 'brier_national': round(float(np.mean((nat - y[ok]) ** 2)), 5),
                  'hi_1.2x': W(y[ok][hi].sum(), hi.sum()), 'others': W(y[ok][~hi].sum(), (~hi).sum())}
    return out
res['EF_prior_rate'] = {'venue': prior_rate_eval(list(venue[idxP])),
                        'venue_wind': prior_rate_eval([f'{v}-{w}' for v, w in zip(venue[idxP], WB[idxP])])}

# ---- Q3 組み合わせ（共通母集団）
def nz(D): return D / np.std(D)  # SD をそろえてから平均する
DV = {k: dev(V[k][idxC]) for k in ['A', 'B', 'C', 'D', 'E', 'F']}
combos = {'A+B': ['A', 'B'], 'A+C': ['A', 'C'], 'A+D': ['A', 'D'], 'A+E': ['A', 'E'], 'A+F': ['A', 'F'],
          'A+B+C': ['A', 'B', 'C'], 'A+C+D': ['A', 'C', 'D'], 'A+B+C+D': ['A', 'B', 'C', 'D'], 'B+C': ['B', 'C'], 'C+E': ['C', 'E']}
q3 = {'equal_raw': {}, 'equal_sd': {}}
for nm, ks in combos.items():
    q3['equal_raw'][nm] = evaluate(np.mean([DV[k] for k in ks], 0), idxC)
    q3['equal_sd'][nm] = evaluate(np.mean([nz(DV[k]) for k in ks], 0) * np.std(DV['A']), idxC)
# 重回帰（6艇内の差で、本番の差を説明）。2019-2023 で当てはめ、2024-2026 で評価
tr = yr[idxC] <= 2023; te = ~tr
X = np.stack([DV[k].ravel() for k in ['A', 'B', 'C', 'D', 'E', 'F']], 1); Y = dev(sr[idxC]).ravel()
rowmask_tr = np.repeat(tr, 6); coef = np.linalg.lstsq(X[rowmask_tr], Y[rowmask_tr], rcond=None)[0]
Dols = (X @ coef).reshape(-1, 6)
it = idxC[te]
q3['ols'] = {'coef': dict(zip(['A', 'B', 'C', 'D', 'E', 'F'], [round(float(c), 3) for c in coef])), 'fit_years': '2019-2023', 'test_years': '2024-2026',
             'test': evaluate(Dols[te], it), 'A_test': evaluate(DV['A'][te], it), 'C_test': evaluate(DV['C'][te], it), 'AC_test': evaluate(((DV['A'] + DV['C']) / 2)[te], it)}
# 2変数ずつの重回帰係数
q3['ols_pairs'] = {}
for k in ['B', 'C', 'D', 'E', 'F']:
    X2 = np.stack([DV['A'].ravel(), DV[k].ravel()], 1); c2 = np.linalg.lstsq(X2[rowmask_tr], Y[rowmask_tr], rcond=None)[0]
    q3['ols_pairs']['A+' + k] = {'coef_A': round(float(c2[0]), 3), 'coef_' + k: round(float(c2[1]), 3), 'test': evaluate((X2 @ c2).reshape(-1, 6)[te], it)}

# 追加: 全国のコース別平均（2019-2023 の本番 ST、F・出遅れ除く）を基準値として使う版（会場の上積みを切り分けるため）
ntr = idxC[tr]
NC = np.nanmean(np.where((B['is_flying'] | B['is_late'])[ntr], np.nan, sr[ntr]), 0)
DV['N'] = np.tile(NC - NC.mean(), (len(idxC), 1))
q3['national_course_mean'] = [round(float(x), 4) for x in NC]
q3['extra_test'] = {}
for nm, ks in {'A+N': ['A', 'N'], 'A+E': ['A', 'E'], 'A+F': ['A', 'F'], 'C+E': ['C', 'E'], 'C+F': ['C', 'F'], 'A+C+E': ['A', 'C', 'E'], 'A+C+F': ['A', 'C', 'F'], 'A+C+N': ['A', 'C', 'N']}.items():
    Xk = np.stack([DV[k].ravel() for k in ks], 1); ck = np.linalg.lstsq(Xk[rowmask_tr], Y[rowmask_tr], rcond=None)[0]
    q3['extra_test'][nm] = {'coef': dict(zip(ks, [round(float(c), 3) for c in ck])), 'test': evaluate((Xk @ ck).reshape(-1, 6)[te], it)}
q3['extra_test']['A+C+E_equal'] = {'test': evaluate(((DV['A'] + DV['C']) / 2 + DV['E'])[te], it)}
# 欠けたら A で埋める版（全 313,938R）
q3['fallback_full'] = {}
for nm, ks in {'A+B': ['A', 'B'], 'A+C': ['A', 'C'], 'A+D': ['A', 'D'], 'A+B+C': ['A', 'B', 'C']}.items():
    q3['fallback_full'][nm] = evaluate(np.mean([dev(fb(k)[idxP]) if k != 'A' else dev(sm[idxP]) for k in ks], 0), idxP)
def ace(ii):  # (A＋C)/2 ＋ E（C が欠けたら A、E が欠けたら 0）
    e = np.where(AV['E'][ii].all(1)[:, None], dev(np.nan_to_num(V['E'][ii])), 0)
    return (dev(sm[ii]) + dev(fb('C')[ii])) / 2 + e
q3['fallback_full']['(A+C)/2+E'] = evaluate(ace(idxP), idxP)
res['q3'] = q3
print('q3', {k: (v['corr_dev'], v['lift_mean5']) for k, v in q3['equal_raw'].items()}, flush=True)

# ---- Q4 若松・6艇とも A1
q4 = {}
for lab, sel in [('v20', POP & (venue == 20)), ('v20_A1x6', POP & (venue == 20) & (cls == 4).all(1)), ('all_A1x6', POP & (cls == 4).all(1))]:
    ii = np.where(sel)[0]; o = {'n': int(len(ii))}
    o['missing_boat'] = {k: round(float(1 - AV[k][ii].mean()), 4) for k in ['B', 'C', 'D', 'E', 'F']}
    o['missing_race'] = {k: round(float(1 - AV[k][ii].all(1).mean()), 4) for k in ['B', 'C', 'D', 'E', 'F']}
    o['fallback'] = {k: evaluate(dev(fb(k)[ii]), ii) for k in ['B', 'C', 'D']}
    o['fallback']['A'] = evaluate(dev(sm[ii]), ii)
    o['fallback']['A+C'] = evaluate((dev(sm[ii]) + dev(fb('C')[ii])) / 2, ii)
    o['fallback']['A+B'] = evaluate((dev(sm[ii]) + dev(fb('B')[ii])) / 2, ii)
    o['fallback']['A+D'] = evaluate((dev(sm[ii]) + dev(fb('D')[ii])) / 2, ii)
    o['fallback']['(A+C)/2+E'] = evaluate(ace(ii), ii)
    jj = ii[COM[ii]]; o['common_n'] = int(len(jj))
    if len(jj) > 50:
        o['common'] = {k: evaluate(dev(V[k][jj]), jj) for k in ['A', 'B', 'C', 'D']}
    A4 = actual(ii); o['actual'] = {f: W(A4[:, j].sum(), len(ii)) for j, f in enumerate(NAMES)}
    if lab.startswith('v20'):
        okk = WB[ii] > 0
        o['by_wind'] = {}
        for w in [1, 2, 3]:
            s = WB[ii] == w; o['by_wind'][WBL[w]] = {'n': int(s.sum()), **{f: W(A4[s, j].sum(), s.sum()) for j, f in enumerate(NAMES)}}
    q4[lab] = o
res['q4'] = q4

# ---- Q5 例のレース
i = int(np.where((r.race_date == pd.Timestamp('2026-09-27')).values & (venue == 20) & (r.race_number.values == 12))[0][0])
ex = {'race_id': int(r.race_id.values[i]), 'wind_speed': float(r.wind_speed.values[i]), 'wave_height': float(r.wave_height.values[i]), 'wbin': WBL.get(int(WB[i])),
      'racer_id': [int(x) for x in RID[i]], 'cls': [int(x) for x in cls[i]], 'grade': r.grade.values[i],
      'actual_st': [None if np.isnan(x) else round(float(x), 2) for x in sr[i]], 'actual_forms': [f for f, b in zip(NAMES, actual([i])[0]) if b]}
for k in ['A', 'B', 'C', 'D', 'E', 'F']:
    ex[k] = [None if np.isnan(x) else round(float(x), 4) for x in V[k][i]]
    ex[k + '_n'] = [int(x) for x in N[k][i]]
    ok = AV[k][i].all()
    Dp = dev(V[k][[i]]) if ok else dev(fb(k)[[i]]) if k in ('B', 'C', 'D') else None
    if Dp is not None:
        kk = q2['common'][k]['K']
        ex[k + '_forms'] = [f for f, b in zip(NAMES, pred_forms(Dp, [i], kk)[0]) if b]
        ex[k + '_int_widened'] = [int(x) for x in np.round((sm[i].mean() + kk * Dp[0]) * 100)]
        ex[k + '_used_fallback'] = (not ok)
ex['A+C_forms'] = [f for f, b in zip(NAMES, pred_forms((dev(sm[[i]]) + dev(fb('C')[[i]])) / 2, [i], q3['equal_raw']['A+C']['K'])[0]) if b]
Dx = ace([i]); kx = q3['fallback_full']['(A+C)/2+E']['K']
ex['(A+C)/2+E_dev'] = [round(float(x), 4) for x in Dx[0]]
ex['(A+C)/2+E_int_widened'] = [int(x) for x in np.round((sm[i].mean() + kx * Dx[0]) * 100)]
ex['(A+C)/2+E_forms'] = [f for f, b in zip(NAMES, pred_forms(Dx, [i], kx)[0]) if b]
res['q5'] = ex
json.dump(res, open(H + '/slitpred2.json', 'w'), ensure_ascii=False, indent=1, default=lambda o: o.item() if hasattr(o, 'item') else str(o))
print(json.dumps(ex, ensure_ascii=False))
