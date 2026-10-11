"""BOA-845 (b) の Brier の差の 95% 区間（レース単位のブートストラップ 2000回、乱数の種 845）
入力: work/effect_eval.pkl（effect.py の出力）。出力: data/analysis/boa845-axis-place/boot.json"""
import numpy as np, pandas as pd
from common import *

E = pd.read_pickle(WORK / "effect_eval.pkl")
rng = np.random.default_rng(845)
pairs = [("base_unc", "NA"), ("NA", "own_default"), ("NA", "VA"), ("NA", "shrink_unc"), ("base_unc", "shrink_unc"), ("NA", "ladder100")]
res = {"note": "diff=Brier(a)-Brier(b)。正なら b が良い。relative=diff/Brier(a)(%)。区間はレース単位のブートストラップ2000回の2.5%・97.5%点",
       "B": 2000, "seed": 845, "pairs": []}
for pos in (2, 3):
    e = E[E.pos == pos].reset_index(drop=True)
    idx = rng.integers(0, len(e), (2000, len(e)))
    for a, b in pairs:
        d = (e[f"B_{a}"] - e[f"B_{b}"]).to_numpy()  # 正なら b が良い
        bs = d[idx].mean(1)
        lo, hi, base = np.quantile(bs, .025), np.quantile(bs, .975), e[f"B_{a}"].mean()
        res["pairs"].append({"pos": pos, "a": a, "b": b, "n": len(e), "diff": d.mean(), "lo": lo, "hi": hi,
                             "relative_pct": d.mean() / base * 100, "relative_lo_pct": lo / base * 100, "relative_hi_pct": hi / base * 100})
        print(f"{pos}着 Brier({a}) - Brier({b}) = {d.mean():+.4f} [{lo:+.4f}, {hi:+.4f}]  相対 {d.mean()/base*100:+.2f}%")
dump("boot", res)
