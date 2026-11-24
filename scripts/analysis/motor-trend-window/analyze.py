"""モーターの推移の線の窓の検証。work/runs.pkl（reconstruct.py の出力）→ result.json
期間（選手の検証 racer-form-window と同じ分け方）: 選手の基準モデル 2026-03-01〜05-31、係数 06-01〜07-31、試す 08-01〜09-14
単位: その節にその基が走った各走。特徴量はその節より前の走だけ（節の初日に分かる値）から作る
"""
import sys, json, numpy as np, pandas as pd
from datetime import datetime, timezone
from sklearn.linear_model import LogisticRegression
W, OUT = sys.argv[1], sys.argv[2]
NS = [10, 20, 30, 50]; OUTC = ["top2", "top3"]
rng = np.random.default_rng(0)
d = pd.read_pickle(f"{W}/runs.pkl")
links = json.load(open(f"{W}/links.json"))
for c in ["win_rate", "global_2rate", "global_3rate", "motor_2rate", "motor_3rate", "exhibition_time"]:
    d[c] = pd.to_numeric(d[c], errors="coerce")
d = d.sort_values(["race_date", "race_id", "boat_number"]).reset_index(drop=True)
# 選手の実力の基準（モーターを入れない）: 艇番×勝率・2連率・3連率・級
d = d.dropna(subset=["win_rate", "global_2rate", "global_3rate"]).copy()
B = pd.get_dummies(d.boat_number.astype(int), prefix="b").astype(float); G = pd.get_dummies(d.grade, prefix="g").astype(float)
def base_X(df):
    X = pd.concat([B.loc[df.index], G.reindex(df.index).fillna(0)], axis=1)
    for b in range(1, 7): X[f"wr_b{b}"] = df.win_rate * B.loc[df.index, f"b_{b}"]
    X["r2"] = df.global_2rate / 100; X["r3"] = df.global_3rate / 100
    return X
fitB = (d.race_date >= "2026-03-01") & (d.race_date <= "2026-05-31")
for o in OUTC + ["win"]:
    m = LogisticRegression(C=1e4, max_iter=3000).fit(base_X(d[fitB]), d.loc[fitB, o])
    d[f"p_{o}"] = m.predict_proba(base_X(d))[:, 1]; d[f"res_{o}"] = d[o] - d[f"p_{o}"]
# 展示タイムのレース内の差（速いほど負）
d["exh_dev"] = d.exhibition_time - d.groupby("race_id").exhibition_time.transform("mean")
# つないだ基（世代の初めからの鎖と、途中で表示から走数を推定して始めた鎖 a の両方。鎖の中の走だけで窓を作る）
L = d[d.motor_uid.notna()].copy()
L["fromStart"] = ~L.motor_uid.astype(str).str.endswith("a")
L = L.sort_values(["motor_uid", "race_date", "race_number"]).reset_index(drop=True)
g = L.groupby("motor_uid", sort=False)
L["j"] = g.cumcount()  # 世代の中でこの走より前の走数（写しでつないだ分）
L["mstart"] = L.groupby(["motor_uid", "meet"]).j.transform("min")  # この節の前の走数
gen_start = {v: pd.Timestamp(x["genStart"]) for v, x in links["byVenue"].items()}
L["days_since_gen"] = (L.date - L.venue_code.astype(str).map(gen_start)).dt.days
# 節の初日の時点の窓（この節より前の直近N走）
def prior_window(col, n):
    prev = g[col].shift(1)
    r = prev.groupby(L.motor_uid).transform(lambda x: x.rolling(n, min_periods=n).mean()) if n else prev.groupby(L.motor_uid).transform(lambda x: x.expanding().mean())
    first = L.j == L.mstart
    return r.where(first).groupby([L.motor_uid, L.meet]).transform("first")
for o in OUTC:
    L[f"cum_{o}"] = prior_window(o, None); L[f"cumres_{o}"] = prior_window(f"res_{o}", None)
    for n in NS:
        L[f"raw_{o}_r{n}"] = prior_window(o, n); L[f"res_{o}_r{n}"] = prior_window(f"res_{o}", n)
L["cum_exh"] = prior_window("exh_dev", None)
for n in NS:
    L[f"exh_r{n}"] = L.groupby("motor_uid", sort=False).exh_dev.shift(1).groupby(L.motor_uid).transform(lambda x, n=n: x.rolling(n, min_periods=int(n * 0.8)).mean()).where(L.j == L.mstart).groupby([L.motor_uid, L.meet]).transform("first")
L.to_pickle(f"{W}/linked_feats.pkl")
tot = {k: sum(x.get(k, 0) for x in links["byVenue"].values()) for k in ["stints", "exact", "exactSubstitute", "lag", "resync", "new", "anchor", "unmatched"]}
tot["linkedShare"] = (tot["exact"] + tot["exactSubstitute"] + tot["lag"] + tot["resync"]) / (tot["stints"] - tot["new"])
links["total"] = tot
res = {"generatedAt": datetime.now(timezone.utc).isoformat(),
       "source": "data/ml/dataset.csv・start_timings.csv（scripts/ml/export-training-data.js、2026-09-14 書き出しの本番の写し。motor_number は無く reconstruct.py で再構成）",
       "reconstruction": links}
# Q2: 1基が何走・何節
mm = L.groupby(["venue_code", "motor_uid", "meet"]).size().rename("runs").reset_index()
per_meet = mm.groupby("venue_code").runs.median().to_dict()
venue_meets = L.groupby("venue_code").meet.nunique()
q2 = {"runsPerMeetPerMotor": {"all": mm.runs.describe(percentiles=[.1, .5, .9]).to_dict(), "medianByVenue": {int(k): float(v) for k, v in per_meet.items()}}}
# 入れ替えから何日で何走（つないだ基の、その日の時点の世代内の走数の中央値）
acc = {}
# 世代の初めからの鎖の、節の前の世代内の走数（表示に合わせて同期した数。写しの抜けを公式の数に寄せてある）
F = L[L.fromStart].drop_duplicates(["motor_uid", "meet"])
for dd in [14, 30, 45, 60, 90, 120, 150, 180]:
    x = F[(F.days_since_gen >= dd - 4) & (F.days_since_gen <= dd + 4)]
    if len(x) < 20: continue
    gr = x.gen_runs_before_meet
    acc[str(dd)] = {"motorMeets": int(len(x)), "venues": int(x.venue_code.nunique()), "medianRunsBefore": float(gr.median()), "p10": float(gr.quantile(.1)), "p90": float(gr.quantile(.9)),
                    "shareAtLeast": {str(n): float((gr >= n).mean()) for n in NS}}
q2["runsSinceGenerationByDays"] = acc
lin = L[L.fromStart].groupby("motor_uid").agg(days=("days_since_gen", "max"), runs=("j", "max"), meets=("meet", "nunique"))
lin = lin[lin.days >= 60]
q2["runsPerDay"] = {"motorsWith60daysPlus": int(len(lin)), "medianRunsPerDay": float((lin.runs / lin.days).median()), "medianMeetsPerDay": float((lin.meets / lin.days).median()),
                    "impliedPerYear": {"runs": float((lin.runs / lin.days).median() * 365), "meets": float((lin.meets / lin.days).median() * 365)}}
res["q2_runsPerGeneration"] = q2
# Q3: 次の節の各走を当てるか（選手の基準＋特徴量、対数損失の差）
def ll(y, p):
    p = np.clip(p, 1e-6, 1 - 1e-6); return -(y * np.log(p) + (1 - y) * np.log(1 - p))
def boot_day(diff, days, reps=1000):
    s = pd.DataFrame({"d": diff, "k": days}).groupby("k").d.agg(["sum", "count"])
    idx = rng.integers(0, len(s), (reps, len(s))); v = s["sum"].values[idx].sum(1) / s["count"].values[idx].sum(1)
    return [float(np.percentile(v, 2.5)), float(np.percentile(v, 97.5))]
need = [f"raw_{o}_r50" for o in OUTC] + [f"res_{o}_r50" for o in OUTC] + ["motor_2rate", "motor_3rate"]
ok = L[need].notna().all(axis=1) & (L.race_date >= "2026-06-01") & (L.motor_2rate > 0)
E = L[ok].copy(); tr = E.race_date <= "2026-07-31"; te = ~tr
q3 = {"population": {"rows": int(len(E)), "train": int(tr.sum()), "test": int(te.sum()), "motors": int(E.motor_uid.nunique()), "venues": int(E.venue_code.nunique()),
                     "condition": "つないだ基で、その節より前に世代内50走以上（全 N で同じ行）、出走表の2連率>0"}}
for o in OUTC:
    y = E[o].values; lp = np.log(E[f"p_{o}"] / (1 - E[f"p_{o}"])).rename("lp")
    base = ll(y[te.values], E.loc[te, f"p_{o}"].values)
    off = "motor_2rate" if o == "top2" else "motor_3rate"
    feats = {"official_cum": E[[off]] / 100, "own_cum_raw": E[[f"cum_{o}"]], "own_cum_resid": E[[f"cumres_{o}"]]}
    for n in NS:
        feats[f"raw_N{n}"] = E[[f"raw_{o}_r{n}"]]; feats[f"resid_N{n}"] = E[[f"res_{o}_r{n}"]]
        feats[f"official_plus_resid_N{n}"] = pd.concat([E[[off]] / 100, E[[f"res_{o}_r{n}"]]], axis=1)
        feats[f"official_plus_raw_N{n}"] = pd.concat([E[[off]] / 100, E[[f"raw_{o}_r{n}"]]], axis=1)
    out = {"baseLogloss": float(base.mean())}
    ref = None
    for name, F in feats.items():
        X = pd.concat([lp, F], axis=1); mdl = LogisticRegression(C=1e4, max_iter=2000).fit(X[tr], y[tr.values])
        p = mdl.predict_proba(X[te])[:, 1]; lossv = ll(y[te.values], p); diff = lossv - base
        out[name] = {"dLogloss": float(diff.mean()), "relPct": float(100 * diff.mean() / base.mean()), "ci95": boot_day(diff, E.loc[te, "race_date"].values), "coef": [float(c) for c in mdl.coef_[0][1:]]}
        if name == "official_cum": ref = lossv
        elif ref is not None and name.startswith(("raw_N", "resid_N", "official_plus")):
            dv = lossv - ref
            out[name]["vsOfficial"] = {"dLogloss": float(dv.mean()), "ci95": boot_day(dv, E.loc[te, "race_date"].values)}
    q3[o] = out
# 窓と公式の累積の相関（同じ行）
q3["corrWithOfficial"] = {f"raw_top2_r{n}": float(E[f"raw_top2_r{n}"].corr(E.motor_2rate)) for n in NS}
q3["corrWithOfficial"]["own_cum_top2"] = float(E.cum_top2.corr(E.motor_2rate))  # 再構成の確かめ: 鎖の走から数えた累積2連率と出走表の公式の値
# 次の節の残差の平均との相関（節ごとに1点）
S = E.groupby(["motor_uid", "meet"]).agg(next_res=("res_top2", "mean"), runs=("res_top2", "size"), **{f"res_r{n}": (f"res_top2_r{n}", "first") for n in NS},
                                         **{f"raw_r{n}": (f"raw_top2_r{n}", "first") for n in NS}, off=("motor_2rate", "first"), cumres=("cumres_top2", "first"))
def boot_corr(a, b, keys, reps=500):
    uk = np.unique(keys); idx = {k: np.where(keys == k)[0] for k in uk}; rs = []
    for _ in range(reps):
        pick = np.concatenate([idx[k] for k in rng.choice(uk, len(uk))]); rs.append(np.corrcoef(a[pick], b[pick])[0, 1])
    return [float(np.percentile(rs, 2.5)), float(np.percentile(rs, 97.5))]
keys = S.index.get_level_values(0).values
q3["meetLevelCorrNextMeetResidTop2"] = {"pairs": int(len(S)), "motors": int(len(np.unique(keys)))}
for c in [f"res_r{n}" for n in NS] + [f"raw_r{n}" for n in NS] + ["off", "cumres"]:
    q3["meetLevelCorrNextMeetResidTop2"][c] = {"r": float(np.corrcoef(S[c], S.next_res)[0, 1]), "ci95": boot_corr(S[c].values, S.next_res.values, keys)}
res["q3_nextMeet"] = q3
# 偶然の幅と、基の中の動きのうち偶然で説明できない割合
q3n = {"binomialHalfWidth95pt": {}, "withinMotorSignalShare": {}, "betweenMotorSignalShare": {}}
for o in OUTC:
    pm = float(L[o].mean())
    q3n["binomialHalfWidth95pt"][o] = {"pMean": pm, **{str(n): float(196 * np.sqrt(pm * (1 - pm) / n)) for n in NS}}
for o in OUTC:
    q3n["withinMotorSignalShare"][o] = {}; q3n["betweenMotorSignalShare"][o] = {}
    for n in NS:
        L["blk"] = L.j // n
        agg = L.groupby(["motor_uid", "blk"]).agg(m=(f"res_{o}", "mean"), c=(f"res_{o}", "size"), v=(f"p_{o}", lambda p: float((p * (1 - p)).sum())))
        agg = agg[agg.c == n]; agg["noise"] = agg.v / n ** 2
        k = agg.groupby(level=0).m.transform("size")
        # 基の間: 各基の最初の N 走の塊の平均の分散 vs 偶然
        b1 = agg.groupby(level=0).head(1)
        bv = float(b1.m.var()); bn = float(b1.noise.mean())
        q3n["betweenMotorSignalShare"][o][str(n)] = {"motors": int(len(b1)), "obsVar": bv, "noiseVar": bn, "signalShare": float(max(0, 1 - bn / bv))}
        a2 = agg[k >= 2].copy(); k2 = k[k >= 2]
        a2["dm"] = a2.m - a2.groupby(level=0).m.transform("mean")
        obs = float((a2.dm ** 2 * k2 / (k2 - 1)).mean()); noise = float(a2.noise.mean())
        q3n["withinMotorSignalShare"][o][str(n)] = {"blocks": int(len(a2)), "obsVarWithin": obs, "noiseVar": noise, "signalShare": float(max(0, 1 - noise / obs)) if obs > 0 else None}
res["q3_noise"] = q3n
# Q4: 展示タイムの差の平均（基の窓）: 次の節の展示の差と2連対を当てるか
ex = E.dropna(subset=["exh_dev", "cum_exh"] + [f"exh_r{n}" for n in NS]).copy()
trx = ex.race_date <= "2026-07-31"; tex = ~trx
q4 = {"rows": int(len(ex)), "test": int(tex.sum())}
y = ex.top2.values; lp = np.log(ex.p_top2 / (1 - ex.p_top2)).rename("lp")
X0 = pd.concat([lp, ex[["motor_2rate"]] / 100], axis=1); m0 = LogisticRegression(C=1e4, max_iter=2000).fit(X0[trx], y[trx.values]); l0 = ll(y[tex.values], m0.predict_proba(X0[tex])[:, 1])
q4["baseWithOfficialLogloss"] = float(l0.mean())
for n in NS + [None]:
    c = f"exh_r{n}" if n else "cum_exh"
    X = pd.concat([X0, ex[[c]]], axis=1); mdl = LogisticRegression(C=1e4, max_iter=2000).fit(X[trx], y[trx.values]); diff = ll(y[tex.values], mdl.predict_proba(X[tex])[:, 1]) - l0
    q4[c] = {"dLoglossVsOfficial": float(diff.mean()), "ci95": boot_day(diff, ex.loc[tex, "race_date"].values), "coef": float(mdl.coef_[0][-1]),
             "corrWithThisRunExhDev": float(ex[c].corr(ex.exh_dev))}
res["q4_exhibition"] = q4
json.dump(res, open(OUT, "w"), ensure_ascii=False, indent=1, default=float)
print(json.dumps({k: v for k, v in res.items() if k != "reconstruction"}, ensure_ascii=False, indent=1, default=float)[:15000])
