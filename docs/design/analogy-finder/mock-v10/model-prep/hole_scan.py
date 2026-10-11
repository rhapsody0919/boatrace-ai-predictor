"""穴の判定の補助: test 期間の月ごとに、全特徴量の欠損率（完全レース）と、完全レースから外れたレースの割合（全行）を出す。
出力: work/hole_scan.json"""
import json, sys
from pathlib import Path
import pandas as pd
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "code-at-train"))
from themes import FEATURES
t = pd.read_pickle(HERE / "work/test.pkl")
a = pd.read_pickle(HERE / "work/test_all_rows.pkl")
mon = t["race_date"].dt.strftime("%Y-%m")
nan = t[FEATURES + ["st_result"]].isna().groupby(mon).mean()
am = a["race_date"].dt.strftime("%Y-%m")
races = a.groupby(am)["race_id"].nunique()
ok = a[a["race_ok"]].groupby(am[a["race_ok"]])["race_id"].nunique()
out = {"nan_rate_by_month_complete_races": {k: {c: round(float(v), 4) for c, v in r.items() if v > 0}
                                             for k, r in nan.iterrows()},
       "races_all": races.to_dict(), "races_complete": ok.to_dict(),
       "complete_rate": (ok / races).round(4).to_dict()}
(HERE / "work/hole_scan.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
for k in races.index:
    print(k, races[k], ok.get(k), round(ok.get(k, 0) / races[k], 3), out["nan_rate_by_month_complete_races"].get(k))
