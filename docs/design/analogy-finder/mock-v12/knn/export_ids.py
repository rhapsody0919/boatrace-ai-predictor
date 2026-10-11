"""近傍 800件（出走表時点の版）と今日のレースの race_id を work/ids.json に書く（結果の取得用）"""
import json, os, sys
from pathlib import Path
import numpy as np, pandas as pd
HERE = Path(__file__).resolve().parent
TAG = os.environ.get("KNN_TAG", "knn")
WD = "work" if TAG == "knn" else f"work{TAG[3:]}"
sys.path.insert(0, str(HERE.parent / "model-prep" / "code-at-train"))
import features as F
r = pd.read_pickle(HERE / WD / "races.pkl")
nb = np.load(HERE / WD / "nbr_racecard.npz")
ids = [F.int_to_rid(x) for x in r["race_id"].to_numpy()[nb["top"]]]
q = F.int_to_rid(int(r.loc[r["is_query"], "race_id"].iloc[0]))
(HERE / WD / "ids.json").write_text(json.dumps({"query": q, "neighbors": ids}))
print(len(ids), sum(1 for i in ids if i <= "2025-12-02"), ids[:5])
