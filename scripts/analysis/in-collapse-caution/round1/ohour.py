import pandas as pd, numpy as np
from sklearn.metrics import roc_auc_score
R = pd.read_pickle("races.pkl"); R = R[R.race_ok]
R["race_id_s"] = R.race_id.astype(str).str.replace(r"^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$", r"\1-\2-\3-\4-\5", regex=True)
O = pd.read_csv("o_saved.csv"); O["pj"] = pd.to_datetime(O.predicted_at, utc=True, format="ISO8601").dt.tz_convert("Asia/Tokyo")
O["lag"] = (O.pj.dt.tz_localize(None).dt.normalize() - pd.to_datetime(O.race_id.str[:10])).dt.days
d = O.merge(R[["race_id_s", "y"]], left_on="race_id", right_on="race_id_s")
d["grp"] = np.select([d.lag > 0, d.pj.dt.hour < 8, d.pj.dt.hour < 21], ["after_day", "morning<8", "day8-20"], "night21+")
for g, x in d.groupby("grp"):
    print(g, len(x), round(x.y.mean(), 3), round(roc_auc_score(x.y, x["comp"]), 4))
print(d[d.pj.dt.hour >= 21].race_id.str[:10].value_counts().head(8))
