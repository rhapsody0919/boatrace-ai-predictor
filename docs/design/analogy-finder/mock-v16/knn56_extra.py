"""knn5/knn6 の補足: 層の条件を1つずつ外したときの件数表（全16通り）と、knn5・knn6 の1〜10位の一覧（級別・年齢）
使い方: ./run.sh knn56_extra.py（knn_build.py KNN_TAG=knn5/knn6 KNN_LAYER=1 KNN_ROUND=1 の出力を読む）
"""
import itertools, json, sys
from pathlib import Path
import numpy as np, pandas as pd
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "model-prep" / "code-at-train"))
import features as F  # noqa: E402
sys.path.insert(0, str(HERE))
from knn_build import gap_band_arr  # noqa: E402

W = HERE / "work5"
r = pd.read_pickle(W / "races.pkl")
B = dict(np.load(W / "boats.npz"))
qi = int(np.where(r["is_query"])[0][0])
pool = r["is_pool"].to_numpy()
nat = B["nat_win"]
gb = gap_band_arr(nat)
c1 = np.nan_to_num(B["cls_ord"][:, 0], nan=0)
top = np.where(np.isfinite(nat), nat, -np.inf).argmax(1) + 1
rc = r["round_code"].to_numpy()
C = {"ラウンド（優勝戦）": rc == rc[qi], "勝率差の帯": gb == gb[qi], "1号艇A1": c1 == c1[qi], "勝率トップ4号艇": top == top[qi]}
rows = []
for k in range(len(C), -1, -1):
    for keep in itertools.combinations(C, k):
        m = pool.copy()
        for c in keep:
            m &= C[c]
        rows.append({"keep": list(keep), "drop": [c for c in C if c not in keep], "n": int(m.sum())})
CLS = {1: "B2", 2: "B1", 3: "A2", 4: "A1"}
VJ = {"yosen": "予選", "junyu": "準優", "yusho": "優勝戦", "other": "その他"}
GJ = {"ippan": "一般"}
rid = r["race_id"].to_numpy()
def listing(tag):
    d = json.loads((HERE / f"{tag}.json").read_text())
    idx = {int(x): i for i, x in enumerate(rid)}
    out = []
    for n in d["neighbors"][:10]:
        i = idx[int(n["race_id"].replace("-", ""))]
        out.append({"rank": n["rank"], "date": n["date"], "venue": n["venue_name"], "rn": n["race_number"],
                    "grade": GJ.get(n["grade"], n["grade"]), "round": VJ.get(n["round"], n["round"]),
                    "cls": [CLS.get(int(x), "—") if np.isfinite(x) else "—" for x in B["cls_ord"][i]],
                    "age": [int(x) if np.isfinite(x) else None for x in B["age"][i]], "dist": n["distance"],
                    "result": n["result"]["trifecta"], "tech": n["result"]["technique"]})
    return out
q = {"cls": [CLS.get(int(x), "—") for x in B["cls_ord"][qi]], "age": [int(x) for x in B["age"][qi]]}
from collections import Counter
k5 = json.loads((HERE / "knn5.json").read_text())
res = {"subsets": rows, "today": q, "knn5_top10": listing("knn5"), "knn6_top10": listing("knn6"),
       "layer_grade": dict(Counter(n["grade"] for n in k5["neighbors"]).most_common()),
       "layer_venue_wakamatsu": sum(1 for n in k5["neighbors"] if n["venue_code"] == 20)}
(HERE / "work5" / "knn56_extra.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
print(json.dumps(res, ensure_ascii=False))
