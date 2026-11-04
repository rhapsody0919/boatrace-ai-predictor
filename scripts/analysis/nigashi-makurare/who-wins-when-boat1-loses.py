#!/usr/bin/env python3
"""BOA-1280 の補足（探索。結果を見た後に足した問い）: 1号艇が負けたレースで、1号艇の被まくられ率・被差し率は「誰が勝つか」（2号艇か3〜6号艇か）に効くか。

  python3 -I scripts/analysis/nigashi-makurare/who-wins-when-boat1-loses.py [work_dir] [out_json]

母集団: 検証期間（2024-01-01〜）、1号艇1コース・2号艇2コース、1号艇が1着でない、1号艇の直近365日の1コース進入が30以上。
層: 1号艇の級×勝率0.5刻み × 2号艇の勝率0.5刻み。率の上位1/3と下位1/3の「2号艇が1着」の割合の差（件数の重み）。
"""
import sys, os, json, datetime
import numpy as np, pandas as pd
W = sys.argv[1] if len(sys.argv) > 1 else "data/analysis/nigashi-makurare/work"
OUT = sys.argv[2] if len(sys.argv) > 2 else "data/analysis/nigashi-makurare/who-wins-when-boat1-loses.json"
R = pd.read_pickle(os.path.join(W, "races.pkl"))
T = R[(R.d >= "2024-01-01") & R.b2_in_course2 & (R.winner_bn != 1) & (R.b1_365d_n >= 30) & R.b1_win_rate.notna() & R.b2_win_rate.notna()].copy()
T["y_b2"] = (T.winner_bn == 2).astype(float)
T["band"] = np.floor(T.b1_win_rate.astype(float) * 2); T["band2"] = np.floor(T.b2_win_rate.astype(float) * 2)
out = {"ticket": "BOA-1280", "kind": "exploratory", "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
       "population": "test 2024-01-01〜, 1号艇1コース・2号艇2コース, 1号艇が1着でない, 1号艇の直近365日1コース30走以上", "n": int(len(T)),
       "base_rate_boat2_wins": round(float(T.y_b2.mean()), 4)}
for kind in ["makuri", "sashi"]:
    T["x"] = T[f"b1_365d_{kind}"] / T.b1_365d_n
    q = T.x.quantile([1/3, 2/3]).values
    T["t"] = np.where(T.x <= q[0], "low", np.where(T.x > q[1], "high", "mid"))
    num = var = ws = 0.0
    for _, s in T.groupby(["b1_cls", "band", "band2"]):
        h, l = s[s.t == "high"].y_b2, s[s.t == "low"].y_b2
        if len(h) < 10 or len(l) < 10: continue
        w = len(h) * len(l) / (len(h) + len(l)); num += w * (h.mean() - l.mean()); ws += w
        var += w**2 * (h.mean()*(1-h.mean())/len(h) + l.mean()*(1-l.mean())/len(l))
    d = num / ws; se = np.sqrt(var) / ws
    out[kind] = {"cut": [round(float(x), 4) for x in q], "raw": {t: {"n": int((T.t == t).sum()), "boat2_wins": round(float(T[T.t == t].y_b2.mean()), 4)} for t in ["low", "mid", "high"]},
                 "adjusted_high_minus_low": round(float(d), 4), "ci95": [round(float(d - 1.96*se), 4), round(float(d + 1.96*se), 4)], "z": round(float(d/se), 2)}
json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=1); print(json.dumps(out, ensure_ascii=False))
