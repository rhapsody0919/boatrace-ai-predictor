"""C の判定用: 層別 S*（cal で選んだ軸・α）と V×C1 を test で1回だけ予測（縮小標本と全件）"""
import json, numpy as np
from cm import *

csel = json.load(open('c_select.json'))
test_s = np.load('test_s.npy'); test = np.where(per == 'test')[0]
out = {}
for name, axes, a in [('S_star', csel['S_star'], csel['chosen_alpha']), ('VC1', ['V', 'C1'], csel['VC1_alpha'])]:
    r = {'axes': axes, 'alpha': a}
    for tag, q in [('s', test_s), ('full', test)]:
        ch = strat_chain(axes, a, POOL_TEST, q); p, n = ch[-1]
        y = Y[q]; ok = y >= 0
        r[f'test_ll_{tag}'] = round(float(ll(p[ok], y[ok]).mean()), 5)
        r[f'test_brier_{tag}'] = round(float(brier(p[ok], y[ok]).mean()), 5)
        r[f'n_finest_{tag}'] = dict(median=float(np.median(n)), p10=float(np.percentile(n, 10)), lt100=round(float((n < 100).mean()), 4),
                                    lt30=round(float((n < 30).mean()), 4), zero=round(float((n == 0).mean()), 4))
        if tag == 's':
            np.save(f'p_{name}.npy', p)
    out[name] = r
    print(name, json.dumps(r, ensure_ascii=False), flush=True)
json.dump(out, open('strat.json', 'w'), ensure_ascii=False, indent=1)
