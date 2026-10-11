"""BOA-845 確認1・2: 見せる側のレース（既定 10/8〜10/11、中止なし）×2〜6号艇で、範囲ごとの「その艇が1着になったレースの件数」。
母集団は work/pool.pkl（2026-10-12 は 2019-04-01〜2026-10-01。本番の朝のバッチは前日までなので約1週間少ない）
出力: work/today_counts.pkl、data/analysis/boa845-axis-place/counts.json"""
import numpy as np, pandas as pd
from common import *

pool = load_pool()
rows, tmeta = load_today()
T = pd.DataFrame(rows)
print("today races", len(T), "combo None", int(T["combo"].isna().sum()), T["round"].value_counts(dropna=False).to_dict())
round_dist = {str(k): int(v) for k, v in T["round"].value_counts(dropna=False).items()}
T = T[T["combo"].notna()]
tabs = {s: cond_table(pool, c) for s, c in COND_KEYS.items()}
# 1号艇の VC の件数（範囲の全レース）で既定の種類を決める（api: VC が300件未満なら NC）
vcn = pool.groupby(["venue_code", "combo", "c1"]).size().to_dict()
recs = []
for _, r in T.iterrows():
    r = r.to_dict()
    kind = "VC" if vcn.get((r["venue_code"], r["combo"], r["c1"]), 0) >= 300 else "NC"
    for w in range(1, 7):
        rec = {"race_id": r["race_id"], "w": w, "round": r["round"], "default_kind": kind}
        for s in COND_KEYS:
            if s == "own_NCR" and r["round"] not in ("junyu", "yusho"):
                rec[s] = np.nan
                continue
            rec[s] = tabs[s].get(key_for(s, r, w), (0,))[0]
        rec["own_default"] = rec["own_VC"] if kind == "VC" else rec["own_NC"]
        recs.append(rec)
R = pd.DataFrame(recs)
R["grade3"] = R["round"].map({"junyu": "準優勝戦", "yusho": "優勝戦"}).fillna("一般（予選・その他）")
R.to_pickle(WORK / "today_counts.pkl")
SC = ["own_default", "own_VC", "own_NC", "own_NCR", "b1_VC", "b1_NC", "NB", "VB", "VA", "NA"]


def summ(x):
    x = x.dropna()
    return pd.Series({"件数": len(x), "中央値": x.median(), "10%点": x.quantile(.1), "<30": (x < 30).mean() * 100,
                      "<100": (x < 100).mean() * 100})


pd.set_option("display.width", 250); pd.set_option("display.max_columns", 30)
res = {"pool": pool_meta(pool), "today": {**tmeta, "races": int(len(T)), "round": round_dist},
       "note": "件数=その範囲で軸の艇が1着になったレースの数。<30・<100 は割合(%)。own_default=1号艇の VC が300件以上なら VC、未満なら NC"}
print("\n== 1号艇（照合: 既定範囲の1号艇1着 中央値448・10%点165 と比べる）")
res["boat1_own_default"] = summ(R[R.w == 1]["own_default"]).round(1)
print(res["boat1_own_default"].to_dict())
A = R[R.w >= 2]
print("\n== 2〜6号艇 全体（範囲別）")
res["axis2to6_by_scope"] = pd.DataFrame({s: summ(A[s]) for s in SC}).T.round(1)
print(res["axis2to6_by_scope"])
res["min_by_scope"] = {s: A[s].min() for s in SC}
res["by_boat"], res["by_round"] = {}, {}
for s in ["own_default", "own_NC", "own_NCR", "NB", "VA", "NA"]:
    print(f"\n== {s}: 艇番別")
    res["by_boat"][s] = A.groupby("w")[s].apply(summ).unstack().round(1)
    res["by_boat"][s]["最小"] = A.groupby("w")[s].min()
    print(res["by_boat"][s].drop(columns="最小"))
    print(f"== {s}: 節別")
    res["by_round"][s] = A.groupby("grade3")[s].apply(summ).unstack().round(1)
    print(res["by_round"][s])
res["default_kind"] = R.drop_duplicates("race_id")["default_kind"].value_counts().to_dict()
print("\n既定の種類", res["default_kind"])
dump("counts", res)
