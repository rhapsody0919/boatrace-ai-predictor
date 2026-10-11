"""事前登録4: 寄与度×類似レース（cal のみ）"""
import json, numpy as np, warnings; warnings.filterwarnings('ignore')
from scipy.stats import spearmanr
from cm2 import *
S = ['Gap5', 'C1', 'V', 'Ntop']; A = 1000
THEME = {'S1b': 'startExhibition', 'M1b': 'machine', 'Rd': 'environment', 'G': 'environment',
         'N1b': 'racerRecord', 'C26nA': 'racerRecord', 'RN': 'venueCourse'}
cal = np.where(per == 'cal')[0]
sh = json.load(open('venue_shares.json'))
out = {'theme_level': {}, 'venue_level': {}}
for tname, lab in [('tech', Y), ('win_boat', W)]:
    lq = lab[cal]; ok = lq >= 0
    base = strat_chain(S, A, POOL_CAL, cal, lab)[-1][0]
    lb = ll(base[ok], lq[ok])
    out['theme_level'][tname] = {'S_star_ll': round(float(lb.mean()), 6)}
    for ax, th in THEME.items():
        p = strat_chain(S + [ax], A, POOL_CAL, cal, lab)[-1][0]
        d = lb - ll(p[ok], lq[ok])            # 正 = 足すと良くなる
        rec = dict(theme=th, gain=round(float(d.mean()), 6), ci=boot(-d, CLU[cal][ok]))
        out['theme_level'][tname][ax] = rec
        if ax in ('S1b', 'M1b', 'Rd'):
            vv = v[cal][ok]
            g = {int(x): float(d[vv == x].mean()) for x in np.unique(vv)}
            ks = sorted(g); gs = np.array([g[k] for k in ks]); ss = np.array([sh[str(k)][th] for k in ks])
            rho = spearmanr(ss, gs).correlation
            rng = np.random.default_rng(0)
            perm = np.array([spearmanr(rng.permutation(ss), gs).correlation for _ in range(10000)])
            out['venue_level'].setdefault(tname, {})[ax] = dict(theme=th, rho=round(float(rho), 3),
                p_one_sided=round(float((perm >= rho).mean()), 4), n_venues=len(ks),
                gain_by_venue={k: round(g[k], 5) for k in ks})
        print(tname, ax, rec, flush=True)
json.dump(out, open('theme_link.json', 'w'), ensure_ascii=False, indent=1)
for t, d in out['venue_level'].items():
    for ax, r in d.items(): print('venue', t, ax, r['rho'], r['p_one_sided'])
