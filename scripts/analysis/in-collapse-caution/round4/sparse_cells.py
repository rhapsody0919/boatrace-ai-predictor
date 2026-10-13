"""BOA-822: 件数の少ない (ラウンド, 勝率差の帯) で、注意度を出さない・「件数少なめ」になるレースを数える。読み取りのみ。
入力: round1 の races.pkl（環境変数 R1_RACES、既定は ds-round1/races.pkl）。定義は plan §1（帯 = clamp(floor(gapCents/50), -8, 6)、
ラウンドは junyu・yusho・それ以外、セルの件数は 2019-04-01〜前日の完全レース）。出さない＝セルが無い・100件未満、少なめ＝100〜299件。
出力: data/analysis/in-collapse-caution/round4/sparse_cells.json"""
import json, os
from pathlib import Path
import numpy as np, pandas as pd

SRC = Path(os.environ.get("R1_RACES", "ds-round1/races.pkl"))
OUT = Path(__file__).resolve().parents[4] / "data/analysis/in-collapse-caution/round4/sparse_cells.json"
R = pd.read_pickle(SRC)
R = R[R.race_ok].copy()
R["date"] = pd.to_datetime(R.race_date)
gi = np.round(R.nat_win.astype("float64") * 100) - np.round(R.top_other.astype("float64") * 100)
R["gb"] = np.where(np.isfinite(gi), np.clip(np.floor(gi / 50), -8, 6), np.nan)
R["rgrp"] = np.select([R["round"] == "junyu", R["round"] == "yusho"], ["junyu", "yusho"], "other")
R["round4"] = R["round"].fillna("other").replace({"other": "ippan", "yosen": "yosen"})

# 前日までのセルの件数（同じ日のレースは数えない）
ok = R[R.gb.notna()]
daily = ok.groupby(["rgrp", "gb", "date"]).size().rename("n").reset_index().sort_values("date")
daily["cum"] = daily.groupby(["rgrp", "gb"]).n.cumsum() - daily.n   # その日より前の累積
R = R.merge(daily[["rgrp", "gb", "date", "cum"]], on=["rgrp", "gb", "date"], how="left")
R["cell_n"] = R.cum.fillna(0)
R["status"] = np.select(
    [R.gb.isna(), R.cell_n < 100, R.cell_n < 300], ["no_gap", "hidden", "low_sample"], "shown")

def summarize(d):
    out = {"races": int(len(d))}
    for s in ("hidden", "low_sample", "no_gap"):
        k = int((d.status == s).sum()); out[s] = {"n": k, "share": round(k / len(d), 5) if len(d) else None}
    return out

ROUND_JA = {"ippan": "一般", "yosen": "予選", "junyu": "準優", "yusho": "優勝戦"}
res = {"definition": "plan §1。hidden=セルが無い・前日までの件数100未満（出さない）、low_sample=100〜299件（件数少なめ）、no_gap=勝率差が出せない（勝率なし、出さない）",
       "source": str(SRC.name), "race_ok_only": True}
L = R[(R.date >= "2025-06-01") & (R.date <= "2026-10-10")]
res["a_prelaunch_2025-06-01_2026-10-10"] = {"all": summarize(L),
    "by_round": {ROUND_JA[k]: summarize(g) for k, g in L.groupby("round4")}}
M = R[(R.date >= "2026-09-11") & (R.date <= "2026-10-10")]
days = M.date.nunique()
b = {"days": int(days), "all": summarize(M),
     "per_day": {s: round(int((M.status == s).sum()) / days, 2) for s in ("hidden", "low_sample", "no_gap")}}
for gr in ("SG", "G1"):
    for rd in ("junyu", "yusho"):
        g = M[(M.grade == gr) & (M["round"] == rd)]
        b[f"{gr}_{ROUND_JA[rd]}"] = summarize(g)
res["b_last30_2026-09-11_2026-10-10"] = b
cols = ["race_id", "date", "venue_code", "race_number", "grade", "round", "nat_win", "top_other", "gb", "cell_n", "y"]
def ex(d, s, k=6):
    x = d[d.status == s].sort_values("date", ascending=False).head(k)[cols].copy()
    x["date"] = x.date.dt.strftime("%Y-%m-%d"); x["band"] = x.gb.map(lambda v: "−3.5未満" if v == -8 else ("+3.0以上" if v == 6 else f"{v*0.5:+.1f}〜{v*0.5+0.5:+.1f}"))
    return x.to_dict("records")
res["c_examples"] = {"hidden": ex(L, "hidden"), "low_sample": ex(L, "low_sample")}
res["cells_hidden_or_low_in_period"] = (L[L.status != "shown"].groupby(["rgrp", "gb", "status"]).size()
                                        .rename("races").reset_index().to_dict("records"))
OUT.write_text(json.dumps(res, ensure_ascii=False, indent=1, default=str))
print(json.dumps(res, ensure_ascii=False, indent=1, default=str))

# 追記: 公開前の検証の期間の SG・G1 の準優・優勝戦、分母から外れる完全レースでないレース
ext = {}
for gr in ("SG", "G1"):
    for rd in ("junyu", "yusho"):
        ext[f"{gr}_{ROUND_JA[rd]}"] = summarize(L[(L.grade == gr) & (L["round"] == rd)])
A = pd.read_pickle(SRC); A["date"] = pd.to_datetime(A.race_date)
AL = A[(A.date >= "2025-06-01") & (A.date <= "2026-10-10")]
ext["not_race_ok_in_period"] = {"n": int((~AL.race_ok).sum()), "of_all_rows": int(len(AL)),
    "note": "races.pkl の完全レースでない行（欠場・返還・1〜3着の返還艇など）。1艇欠場のレースは画面では残りの艇で出す（このファイルの分母に入っていない）"}
res["a2_prelaunch_sg_g1_and_excluded"] = ext
OUT.write_text(json.dumps(res, ensure_ascii=False, indent=1, default=str))
print(json.dumps(ext, ensure_ascii=False, indent=1))
