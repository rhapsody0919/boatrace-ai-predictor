"""補足: 3段（35/55）で、朝の値（B05・C3・C1）・展示後（C2e）から展示前の C2 へ段がまたぐ割合。eval3.py の前処理を使う"""
import json
src = open("eval3.py").read().split("# ---- 項目2")[0]
exec(src)
e = [0.35, 0.55]; out = {}
for nm, d in (("A", A), ("B", B)):
    out[nm] = {c: round(float((np.digitize(d[c], e) != np.digitize(d.C2, e)).mean()), 3) for c in ("B05", "B5", "C1f", "C3", "C2e")}
    out[nm]["B05_jump2"] = round(float((np.abs(np.digitize(d.B05, e) - np.digitize(d.C2, e)) >= 2).mean()), 4)
r = json.load(open("result3.json")); r["item1_band_switch_3band"] = out
json.dump(r, open("result3.json", "w"), ensure_ascii=False, indent=1, default=str); print(out)
