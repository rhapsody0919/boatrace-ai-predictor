#!/usr/bin/env python3
"""BOA-1280: 2号艇の逃がし率・1号艇の被まくられ率は、1号艇の1着・2連対に効くか。

  python3 -I scripts/analysis/nigashi-makurare/analyze.py [work_dir] [out_json]

方法（結果を見る前に決めたもの）
- 率はすべて「レース日より前」の走だけ（build-features.py）。窓 all / 365d / 90d
- 学習 2019-04-01〜2023-12-31（ロジットの係数を当てはめる）、検証 2024-01-01〜（ΔAUC・ΔLogLoss を検証だけで測る）
- 母集団 Q1: 1号艇が1コース・2号艇が2コースに入ったレース。Q2: 1号艇が1コースに入ったレース
- 基準のモデル B0 = 1号艇の全国勝率＋級（チケットの「勝率・級をそろえて」）、
  B1 = B0 ＋ 2号艇の全国勝率 ＋ 3〜6号艇の最高勝率（相手の強さ。率が相手の弱さの写しかを見る）
- 足す量: 率（n>=下限の選手だけ。足りない選手は会場の期待値で埋めて欠けの印を足す）と、率−期待値
- 区間: レース単位のブートストラップ 200 回（検証期間）。|z|>=1.96 を「効く」、複数の組は Bonferroni
- 層の差: 1号艇の級×勝率0.5刻みの層ごとに、率の上位1/3と下位1/3の1着率の差を件数で重み付け平均（Mantel-Haenszel 型のリスク差）
- 信頼性: 選手間の真の率の分散 = 観測の分散 − 平均の二項の分散（モーメント法）。信頼性 ρ(n)=σ²/(σ²+p(1−p)/n)
"""
import sys, os, json, hashlib, datetime
import numpy as np, pandas as pd

W = sys.argv[1] if len(sys.argv) > 1 else "data/analysis/nigashi-makurare/work"
OUT = sys.argv[2] if len(sys.argv) > 2 else "data/analysis/nigashi-makurare/nigashi-makurare-effect.json"
TEST_FROM = pd.Timestamp("2024-01-01")
B = int(os.environ.get("NM_BOOT", "200"))
rng = np.random.default_rng(1280)
R = pd.read_pickle(os.path.join(W, "races.pkl"))
R = R[R.b1_win_rate.notna()].copy()
R["y_win"] = (R.winner_bn == 1).astype(float)
R["y_top2"] = ((R.winner_bn == 1) | (R.second_bn == 1)).astype(float)
CLS = ["A1", "A2", "B1", "B2"]

def logit_fit(X, y, l2=1e-4, it=30):
    X = np.column_stack([np.ones(len(X)), X]); w = np.zeros(X.shape[1])
    for _ in range(it):
        p = 1 / (1 + np.exp(-X @ w)); g = X.T @ (y - p) - l2 * w
        H = (X * (p * (1 - p))[:, None]).T @ X + l2 * np.eye(len(w))
        step = np.linalg.solve(H, g); w += step
        if np.abs(step).max() < 1e-8: break
    cov = np.linalg.inv(H)
    return w, np.sqrt(np.diag(cov))

def predict(w, X): return 1 / (1 + np.exp(-(np.column_stack([np.ones(len(X)), X]) @ w)))

def auc(y, s):
    # 予測は連続値で同順位はほぼ無い（同順位は並びの順で割る。差は検証で 1e-4 未満）
    o = np.argsort(s); r = np.empty(len(s)); r[o] = np.arange(1, len(s) + 1)
    n1 = y.sum(); n0 = len(y) - n1
    return (r[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0)

def ll(y, p):
    p = np.clip(p, 1e-9, 1 - 1e-9); return -np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))

def design(D, cols): 
    X = []
    for c in cols:
        if c == "b1_cls": X += [(D.b1_cls == k).astype(float).values for k in CLS[1:]]
        else: X.append(D[c].astype(float).values)
    return np.column_stack(X)

def compare(D, base, add, yname):
    tr, te = D[D.d < TEST_FROM], D[D.d >= TEST_FROM]
    y_tr, y_te = tr[yname].values, te[yname].values
    w0, _ = logit_fit(design(tr, base), y_tr); w1, se1 = logit_fit(design(tr, base + add), y_tr)
    p0 = predict(w0, design(te, base)); p1 = predict(w1, design(te, base + add))
    a0, a1 = auc(y_te, p0), auc(y_te, p1)
    d_ll = ll(y_te, p1) - ll(y_te, p0)
    boots = []; boots_ll = []
    n = len(te)
    for _ in range(B):
        i = rng.integers(0, n, n)
        boots.append(auc(y_te[i], p1[i]) - auc(y_te[i], p0[i])); boots_ll.append(ll(y_te[i], p1[i]) - ll(y_te[i], p0[i]))
    boots, boots_ll = np.array(boots), np.array(boots_ll)
    k = len(design(tr, base)[0]) + 1
    coefs = {c: {"coef": round(float(w1[k + j]), 4), "se": round(float(se1[k + j]), 4), "z": round(float(w1[k + j] / se1[k + j]), 2)} for j, c in enumerate(add)}
    return {"n_train": int(len(tr)), "n_test": int(len(te)), "test_rate": round(float(y_te.mean()), 4),
            "auc_base": round(a0, 4), "auc_added": round(a1, 4), "d_auc": round(a1 - a0, 4),
            "d_auc_ci95": [round(float(np.percentile(boots, 2.5)), 4), round(float(np.percentile(boots, 97.5)), 4)],
            "d_auc_z": round(float((a1 - a0) / boots.std()), 2),
            "d_logloss": round(float(d_ll), 5), "d_logloss_ci95": [round(float(np.percentile(boots_ll, 2.5)), 5), round(float(np.percentile(boots_ll, 97.5)), 5)],
            "coef_train": coefs}

def strat_diff(D, rate, yname, nmin):
    """1号艇の級×勝率0.5刻みの層の中で、率の上位1/3 − 下位1/3 の結果の率の差（件数で重み付け）。検証期間だけ。"""
    T = D[(D.d >= TEST_FROM) & D[rate].notna()].copy()
    T["band"] = np.floor(T.b1_win_rate.astype(float) * 2)
    q = T[rate].quantile([1 / 3, 2 / 3]).values
    T["tert"] = np.where(T[rate] <= q[0], "low", np.where(T[rate] > q[1], "high", "mid"))
    num = 0.0; var = 0.0; wsum = 0.0; raw = {}
    for _, s in T.groupby(["b1_cls", "band"]):
        h, l = s[s.tert == "high"][yname], s[s.tert == "low"][yname]
        if len(h) < 10 or len(l) < 10: continue
        w = len(h) * len(l) / (len(h) + len(l))
        num += w * (h.mean() - l.mean()); wsum += w
        var += w ** 2 * (h.mean() * (1 - h.mean()) / len(h) + l.mean() * (1 - l.mean()) / len(l))
    d = num / wsum; se = np.sqrt(var) / wsum
    for t in ["low", "mid", "high"]:
        s = T[T.tert == t]; raw[t] = {"n": int(len(s)), "rate": round(float(s[yname].mean()), 4), "mean_x": round(float(s[rate].mean()), 4)}
    return {"nmin": nmin, "cut_low_high": [round(float(q[0]), 4), round(float(q[1]), 4)], "raw_by_tertile": raw,
            "adjusted_high_minus_low": round(float(d), 4), "ci95": [round(float(d - 1.96 * se), 4), round(float(d + 1.96 * se), 4)], "z": round(float(d / se), 2)}

def reliability(D, nc, kc, nmin, by=None):
    """選手間の真の率の分散（モーメント法）と、信頼性0.5・0.7に要る走数。D は1行1選手（直近の時点の値）。"""
    S = D[D[nc] >= nmin]
    def one(S):
        p = S[kc] / S[nc]; pbar = S[kc].sum() / S[nc].sum()
        noise = (p * (1 - p) / S[nc]).mean() * len(S) / (len(S) - 1)
        tv = p.var() - noise
        if tv <= 0: return {"n_racers": int(len(S)), "pbar": round(float(pbar), 4), "true_sd": 0.0, "n_for_rel_0.5": None, "n_for_rel_0.7": None}
        b = pbar * (1 - pbar)
        return {"n_racers": int(len(S)), "pbar": round(float(pbar), 4), "true_sd": round(float(np.sqrt(tv)), 4),
                "n_for_rel_0.5": int(np.ceil(b / tv)), "n_for_rel_0.7": int(np.ceil(b / tv * 0.7 / 0.3)),
                "median_runs": float(S[nc].median())}
    res = {"all": one(S)}
    if by: 
        for k, s in S.groupby(by): 
            if len(s) > 30: res[k] = one(s)
    return res

out = {"ticket": "BOA-1280", "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
       "data": {"races_boat1_course1": int(len(R)), "date_min": str(R.d.min().date()), "date_max": str(R.d.max().date()),
                "sha256_races_pkl": hashlib.sha256(open(os.path.join(W, "races.pkl"), "rb").read()).hexdigest()[:16],
                "train": "2019-04-01..2023-12-31", "test": f"{TEST_FROM.date()}..{R.d.max().date()}",
                "source": "kb_archive_races/boats (〜2025-12-02) + races/race_results/race_entries (2025-12-03〜)"}}

# ---------------- Q1 逃がし率 ----------------
Q1 = R[R.b2_in_course2 & R.b2_win_rate.notna() & R.max_wr_3to6.notna()].copy()
q1 = {"population": "1号艇1コース・2号艇2コース", "n_races": int(len(Q1)), "by_window": {}}
for win in os.environ.get("NM_WINDOWS", "all,365d,90d").split(","):
    n, k, e = Q1[f"b2_{win}_n"], Q1[f"b2_{win}_nige"], Q1[f"b2_{win}_bl_nige"]
    Q1[f"nig_{win}"] = np.where(n > 0, k / n.clip(lower=1), np.nan)
    Q1[f"nigexp_{win}"] = np.where(n > 0, e / n.clip(lower=1), np.nan)
    res = {}
    for nmin in [10, 30]:
        ok = n >= nmin
        Q1["x_rate"] = np.where(ok, Q1[f"nig_{win}"], Q1[f"nigexp_{win}"].fillna(Q1[f"nig_{win}"].mean()))
        Q1["x_rate"] = Q1["x_rate"].fillna(np.nanmean(Q1[f"nig_{win}"]))
        Q1["x_diff"] = np.where(ok, Q1[f"nig_{win}"] - Q1[f"nigexp_{win}"], 0.0)
        Q1["x_miss"] = (~ok).astype(float)
        Q1["x_rate10"] = Q1.x_rate * 10; Q1["x_diff10"] = Q1.x_diff * 10
        r = {"share_with_nmin": round(float(ok.mean()), 4)}
        for yn in ["y_win", "y_top2"]:
            r[yn] = {
                "B0+rate": compare(Q1, ["b1_win_rate", "b1_cls"], ["x_rate10", "x_miss"], yn),
                "B0+diff": compare(Q1, ["b1_win_rate", "b1_cls"], ["x_diff10", "x_miss"], yn),
                "B1+rate": compare(Q1, ["b1_win_rate", "b1_cls", "b2_win_rate", "max_wr_3to6"], ["x_rate10", "x_miss"], yn),
                "B1+diff": compare(Q1, ["b1_win_rate", "b1_cls", "b2_win_rate", "max_wr_3to6"], ["x_diff10", "x_miss"], yn),
            }
        Q1["s_rate"] = np.where(ok, Q1[f"nig_{win}"], np.nan)
        r["stratified_win"] = strat_diff(Q1, "s_rate", "y_win", nmin)
        res[f"nmin{nmin}"] = r
        print("Q1", win, nmin, {yn: {m: (v["d_auc"], v["d_auc_ci95"]) for m, v in r[yn].items()} for yn in ["y_win"]}, r["stratified_win"]["adjusted_high_minus_low"], r["stratified_win"]["ci95"], flush=True)
    q1["by_window"][win] = res
out["q1_nigashi_boat2"] = q1

# ---------------- Q2 被まくられ率・被差し率 ----------------
Q2 = R[R.max_wr_2to6.notna()].copy()
Q2["y_lose"] = 1 - Q2.y_win
Q2["y_out2"] = 1 - Q2.y_top2
q2 = {"population": "1号艇1コース", "n_races": int(len(Q2)), "by_window": {}}
for win in os.environ.get("NM_WINDOWS", "all,365d,90d").split(","):
    n = Q2[f"b1_{win}_n"]
    res = {}
    for nmin in [10, 30]:
        ok = n >= nmin
        r = {"share_with_nmin": round(float(ok.mean()), 4)}
        for kind in ["makuri", "sashi", "mz"]:
            rate = np.where(ok, Q2[f"b1_{win}_{kind}"] / n.clip(lower=1), np.nan)
            exp = np.where(ok, Q2[f"b1_{win}_bl_{kind}"] / n.clip(lower=1), np.nan) if kind != "mz" else np.zeros(len(Q2))
            pbar = np.nanmean(rate)
            Q2[f"x_{kind}10"] = np.where(ok, rate, pbar) * 10
            Q2[f"xd_{kind}10"] = np.where(ok, rate - exp, 0.0) * 10 if kind != "mz" else Q2[f"x_{kind}10"]
            Q2[f"s_{kind}"] = rate
        Q2["x_miss"] = (~ok).astype(float)
        # 1コースの自分の1着率（すでに勝率に入っているかを見るため、参考に足す）
        Q2["x_selfwin10"] = np.where(ok, Q2[f"b1_{win}_self_win"] / n.clip(lower=1), np.nan)
        Q2["x_selfwin10"] = Q2.x_selfwin10.fillna(np.nanmean(Q2.x_selfwin10)) * 10
        B0 = ["b1_win_rate", "b1_cls"]; B1 = B0 + ["max_wr_2to6"]
        for yn in ["y_lose", "y_out2"]:
            r[yn] = {
                "B0+makuri": compare(Q2, B0, ["x_makuri10", "x_miss"], yn),
                "B0+sashi": compare(Q2, B0, ["x_sashi10", "x_miss"], yn),
                "B1+makuri": compare(Q2, B1, ["x_makuri10", "x_miss"], yn),
                "B1+sashi": compare(Q2, B1, ["x_sashi10", "x_miss"], yn),
                "B1+makuri_diff": compare(Q2, B1, ["xd_makuri10", "x_miss"], yn),
                "B1+makuri+sashi+mz": compare(Q2, B1, ["x_makuri10", "x_sashi10", "x_mz10", "x_miss"], yn),
                "B1+course1_win": compare(Q2, B1, ["x_selfwin10", "x_miss"], yn),
                "B1+course1_win+makuri+sashi": compare(Q2, B1, ["x_selfwin10", "x_makuri10", "x_sashi10", "x_miss"], yn),
            }
        r["stratified_lose_makuri"] = strat_diff(Q2, "s_makuri", "y_lose", nmin)
        r["stratified_lose_sashi"] = strat_diff(Q2, "s_sashi", "y_lose", nmin)
        res[f"nmin{nmin}"] = r
        print("Q2", win, nmin, {m: (v["d_auc"], v["d_auc_ci95"]) for m, v in r["y_lose"].items()}, r["stratified_lose_makuri"]["adjusted_high_minus_low"], r["stratified_lose_makuri"]["ci95"], flush=True)
    q2["by_window"][win] = res
out["q2_makurare_boat1"] = q2

# ---------------- Q3 信頼性（選手差を言うのに要る走数） ----------------
# 時点: 検証の最終日。各選手の直近365日（DB の「全期間」2025-12-02〜 にほぼ相当）と全期間
last = R.d.max()
L1 = R.sort_values("d").groupby("b1_racer").tail(1)
L2 = R[R.b2_in_course2].sort_values("d").groupby("b2_racer").tail(1)
q3 = {"as_of": str(last.date()), "note": "各選手の最後の出走日の前日までの値。真の差の SD はモーメント法"}
for win in ["365d", "all"]:
    q3[f"nigashi_course2_{win}"] = reliability(L2, f"b2_{win}_n", f"b2_{win}_nige", 10, by="b2_cls")
    for kind in ["makuri", "sashi", "self_win"]:
        q3[f"{kind}_course1_{win}"] = reliability(L1, f"b1_{win}_n", f"b1_{win}_{kind}", 10, by="b1_cls")
out["q3_reliability"] = q3

# ---------------- Q4 動画の閾値 ----------------
T2 = Q2[(Q2.d >= TEST_FROM)].copy()
n365 = T2.b1_365d_n
T2["mk"] = np.where(n365 >= 30, T2.b1_365d_makuri / n365.clip(lower=1), np.nan)
T2["bin"] = pd.cut(T2.mk, [-0.001, 0.10, 0.20, 1.0], labels=["<10%", "10-20%", ">=20%"])
q4 = {"makurare_365d_nmin30_test": {}}
for b, s in T2.groupby("bin", observed=True):
    q4["makurare_365d_nmin30_test"][str(b)] = {"n": int(len(s)), "boat1_win": round(float(s.y_win.mean()), 4), "share": round(float(len(s) / T2.mk.notna().sum()), 4),
                                              "mean_b1_win_rate": round(float(s.b1_win_rate.mean()), 3)}
# 勝率の帯をそろえた差（<10% を基準に）
def band_adj(T, col, ref, tgt):
    T = T[T[col].isin([ref, tgt])].copy(); T["band"] = np.floor(T.b1_win_rate.astype(float) * 2)
    num = var = wsum = 0.0
    for _, s in T.groupby(["b1_cls", "band"]):
        h, l = s[s[col] == tgt].y_win, s[s[col] == ref].y_win
        if len(h) < 10 or len(l) < 10: continue
        w = len(h) * len(l) / (len(h) + len(l)); num += w * (h.mean() - l.mean()); wsum += w
        var += w ** 2 * (h.mean() * (1 - h.mean()) / len(h) + l.mean() * (1 - l.mean()) / len(l))
    d = num / wsum; se = np.sqrt(var) / wsum
    return {"adjusted_diff": round(float(d), 4), "ci95": [round(float(d - 1.96 * se), 4), round(float(d + 1.96 * se), 4)], "z": round(float(d / se), 2)}
T2["bin"] = T2["bin"].astype(str)
q4["makurare_adjusted_vs_lt10"] = {t: band_adj(T2, "bin", "<10%", t) for t in ["10-20%", ">=20%"]}
T1 = Q1[Q1.d >= TEST_FROM].copy(); n2 = T1.b2_365d_n
T1["ng"] = np.where(n2 >= 30, T1.b2_365d_nige / n2.clip(lower=1), np.nan)
T1["bin"] = np.where(T1.ng.isna(), "nan", np.where(T1.ng >= 0.5, ">=50%", "<50%"))
q4["nigashi_365d_nmin30_test"] = {b: {"n": int(len(s)), "boat1_win": round(float(s.y_win.mean()), 4), "mean_b2_win_rate": round(float(s.b2_win_rate.mean()), 3)} for b, s in T1.groupby("bin")}
q4["nigashi_adjusted_ge50_vs_lt50"] = band_adj(T1, "bin", "<50%", ">=50%")
q4["nigashi_365d_median"] = round(float(T1.ng.median()), 4)
out["q4_thresholds"] = q4

os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=1)
print(json.dumps(q3, ensure_ascii=False)); print(json.dumps(q4, ensure_ascii=False))
