import pandas as pd, numpy as np
R = pd.read_pickle("races.pkl"); ok = R[R.race_ok]
rng = np.random.default_rng(0)
for i in rng.choice(ok.index, 5):
    r = R.loc[i]
    m = ok[(ok.venue_code == r.venue_code) & (ok.comp == r.comp) & (ok.cls == r.cls) & (ok.race_date < r.race_date)]
    n = ok[(ok.comp == r.comp) & (ok.cls == r.cls) & (ok.race_date < r.race_date)]
    print(r.race_id, r.comp, r.cls, (len(m), m.y.sum()), (r.vc_n, r.vc_k), (len(n), n.y.sum()), (r.nc_n, r.nc_k))
print(ok.groupby(ok.race_date.dt.year).y.agg(["mean", "size"]))
f = ok[(ok.is_flying.astype(bool)) | (ok.is_late.astype(bool))]
print("b1 F/L in race_ok", len(f), f.y.mean())
print("not race_ok", (~R.race_ok).sum())
