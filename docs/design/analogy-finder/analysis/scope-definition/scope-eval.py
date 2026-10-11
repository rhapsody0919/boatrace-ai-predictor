"""BOA-271 「集めるレース」の範囲の定義の比較（読み取りのみ。ローカルの本番DB書き出しを使う）。

艇ごとの行（レース×艇）を作り、範囲キーごとに学習期間の1着率・3着以内率を出し、検証期間の実際の結果と比べる。
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ANALOGY = Path(sys.argv[1])
sys.path.insert(0, str(ANALOGY))
import v16_pool as P  # noqa: E402

SRC = Path(sys.argv[2])
CUT = pd.Timestamp(sys.argv[3] if len(sys.argv) > 3 else "2025-04-01")
OUT = Path(sys.argv[4] if len(sys.argv) > 4 else ".")
CLS = ("A1", "A2", "B1", "B2")

kb_b, _ = P.load_kb_boats(SRC)
mn_b, _ = P.load_main_boats(SRC)
b = pd.concat([kb_b, mn_b], ignore_index=True)
b["race_date"] = pd.to_datetime(b["race_date"])

# レースの条件: 6艇・欠場なし・級別が全艇そろう・1着が1艇（返還艇は「1着でない」として扱う）
g = b.groupby("race_id")
ok = (g.size() == 6) & ~g["absent"].any() & g["cls"].apply(lambda s: s.isin(CLS).all()) \
     & ((b["finish_rank"] == 1).groupby(b["race_id"]).sum() == 1)
b = b[b["race_id"].isin(ok[ok].index)].sort_values(["race_id", "boat_number"]).reset_index(drop=True)
W = b.pivot(index="race_id", columns="boat_number", values="cls")
races = b.groupby("race_id").agg(race_date=("race_date", "first"), venue=("venue_code", "first"))
cl = W.to_numpy()  # (n,6)
cnt = np.stack([(cl == k).sum(1) for k in CLS], 1)
combo = pd.Series(["-".join(map(str, r)) for r in cnt], index=W.index)
ordered = pd.Series(["".join(r) for r in cl], index=W.index)
races = races.join(combo.rename("combo")).join(ordered.rename("ordered"))

b = b.join(races[["combo", "ordered"]], on="race_id")
b["win"] = (b["finish_rank"] == 1).astype(float)
b["top3"] = (b["finish_rank"] <= 3).astype(float)
bn = b["boat_number"].to_numpy()
ri = races.index.get_indexer(b["race_id"])
clr = cl[ri]  # 艇ごとに、そのレースの6艇の級別


def keyfn(name):
    """艇ごとの範囲キー（会場を含まない部分）"""
    sel = b["boat_number"].astype(str) + b["cls"]
    if name == "a_combo_sel":       # 今: 構成＋選んだ艇の艇番・級
        return b["combo"] + "|" + sel
    if name == "b_ordered":         # 6枠すべて同じ級（選んだ艇の艇番を付ける）
        return b["ordered"] + "|" + b["boat_number"].astype(str)
    if name == "c_in3_sel":         # 1〜3号艇は枠ごと＋選んだ艇＋残りは艇数
        out = []
        for k in range(len(b)):
            r, s = clr[k], bn[k]
            fixed = {1, 2, 3, s}
            rest = [r[i] for i in range(6) if i + 1 not in fixed]
            out.append("".join(r[i] if i + 1 in fixed else "_" for i in range(6)) + "|" +
                       "-".join(str(rest.count(c)) for c in CLS) + "|" + str(s))
        return pd.Series(out, index=b.index)
    if name == "d_nbr_sel":         # 選んだ艇と隣の枠は枠ごと＋残りは艇数
        out = []
        for k in range(len(b)):
            r, s = clr[k], bn[k]
            fixed = {s - 1, s, s + 1} & set(range(1, 7))
            rest = [r[i] for i in range(6) if i + 1 not in fixed]
            out.append("".join(r[i] if i + 1 in fixed else "_" for i in range(6)) + "|" +
                       "-".join(str(rest.count(c)) for c in CLS) + "|" + str(s))
        return pd.Series(out, index=b.index)
    if name == "e_inner_sel":       # 選んだ艇より内の枠は枠ごと＋選んだ艇＋外は艇数
        out = []
        for k in range(len(b)):
            r, s = clr[k], bn[k]
            rest = [r[i] for i in range(s, 6)]
            out.append("".join(r[:s]) + "|" + "-".join(str(rest.count(c)) for c in CLS) + "|" + str(s))
        return pd.Series(out, index=b.index)
    if name == "x_combo":           # 参考: 構成だけ（選んだ艇の級を問わない）
        return b["combo"] + "|" + b["boat_number"].astype(str)
    if name == "y_sel":             # 参考: 選んだ艇の艇番・級だけ
        return sel
    raise ValueError(name)


DEFS = ["y_sel", "x_combo", "a_combo_sel", "c_in3_sel", "d_nbr_sel", "e_inner_sel", "b_ordered"]
is_tr = (b["race_date"] < CUT).to_numpy()
is_te = ~is_tr
te = b[is_te].copy()
print(f"train races={races[races.race_date < CUT].shape[0]} test races={races[races.race_date >= CUT].shape[0]}"
      f" test boats={len(te)}  period train {b.race_date.min().date()}..{(CUT - pd.Timedelta(days=1)).date()}"
      f" test {CUT.date()}..{b.race_date.max().date()}", flush=True)

eps = 1e-6


def ll(p, y):
    p = np.clip(p, eps, 1 - eps)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


rows, cnt_rows = [], []
pred = {}
for name in DEFS:
    k = keyfn(name)
    for scope in ("NC", "VC"):
        full = (b["venue_code"].astype(str) + ":" + k) if scope == "VC" else k
        tr = pd.DataFrame({"key": full[is_tr], "win": b["win"][is_tr], "top3": b["top3"][is_tr]})
        agg = tr.groupby("key").agg(n=("win", "size"), w=("win", "sum"), t=("top3", "sum"))
        tk = full[is_te]
        m = agg.reindex(tk.to_numpy())
        pred[(name, scope)] = pd.DataFrame({"n": m["n"].fillna(0).to_numpy(), "w": m["w"].fillna(0).to_numpy(),
                                            "t": m["t"].fillna(0).to_numpy()}, index=te.index)
        n = pred[(name, scope)]["n"]
        cnt_rows.append({"def": name, "scope": scope, "median_n": float(n.median()),
                         "p10_n": float(n.quantile(.1)), "lt300": float((n < 300).mean()),
                         "lt100": float((n < 100).mean()), "lt30": float((n < 30).mean()),
                         "zero": float((n == 0).mean())})
cnt_df = pd.DataFrame(cnt_rows)
print("\n## 件数（検証期間の各艇の行から見た、学習期間の集めるレースの件数）")
print(cnt_df.to_string(index=False, float_format=lambda v: f"{v:.3f}"))


def score(p, y):
    return {"brier": float(np.mean((p - y) ** 2)), "logloss": float(np.mean(ll(p, y)))}


def evaluate(target, mask=None, label="all"):
    y = te[target].to_numpy()
    col = "w" if target == "win" else "t"
    res = []
    # 比べる元: 艇番だけ（全国）の率
    base = pred[("y_sel", "NC")]
    bp = (base[col] / base["n"]).to_numpy()
    M = np.ones(len(te), bool) if mask is None else mask
    for name in DEFS:
        for rule in ("NC", "VC300>NC", "VC"):
            nc, vc = pred[(name, "NC")], pred[(name, "VC")]
            if rule == "NC":
                n, w = nc["n"].to_numpy(), nc[col].to_numpy()
            elif rule == "VC":
                n, w = vc["n"].to_numpy(), vc[col].to_numpy()
            else:
                use = vc["n"].to_numpy() >= 300
                n = np.where(use, vc["n"], nc["n"])
                w = np.where(use, vc[col], nc[col])
            # 生の率（件数0は比べる対象から外さず、親の率=今の定義の全国で埋める。埋めた割合を出す）
            raw = np.where(n > 0, w / np.maximum(n, 1), np.nan)
            par = pred[("a_combo_sel", "NC")]
            pp = (par[col] / par["n"].clip(lower=1)).to_numpy()
            fill = np.isnan(raw)
            p = np.where(fill, pp, raw)
            p = np.where(np.isnan(p), bp, p)
            # 縮小版: 件数が少ない範囲を今の定義（全国）の率へ寄せる（擬似件数 m=100）
            m_ = 100
            ps = (w + m_ * np.where(np.isnan(pp), bp, pp)) / (n + m_)
            d = {"target": target, "subset": label, "def": name, "rule": rule, "rows": int(M.sum()),
                 "filled0": float(fill[M].mean()), "n_lt300": float((n[M] < 300).mean())}
            for tag, q in (("raw", p), ("shrunk", ps)):
                s = score(q[M], y[M])
                d[f"brier_{tag}"] = s["brier"]
                d[f"ll_{tag}"] = s["logloss"]
            d["brier_base"] = score(bp[M], y[M])["brier"]
            res.append(d)
    return res


allres = []
for target in ("win", "top3"):
    allres += evaluate(target)
    for s in range(1, 7):
        allres += evaluate(target, (te["boat_number"] == s).to_numpy(), f"boat{s}")
    # 級別がそろっていない（6艇が同じ級でない）レースだけ
    mixed = ~te["combo"].isin(["6-0-0-0", "0-6-0-0", "0-0-6-0", "0-0-0-6"]).to_numpy()
    allres += evaluate(target, mixed, "mixed")
R = pd.DataFrame(allres)
R.to_csv(OUT / "scope-eval-scores.csv", index=False)
cnt_df.to_csv(OUT / "scope-eval-counts.csv", index=False)

# ぶれ幅: 日単位ブートストラップで、今の定義との Brier の差の95%区間（1着・全艇・全国／切り替え）
te_day = te["race_date"].dt.date.to_numpy()
days = np.unique(te_day)
rng = np.random.default_rng(0)
day_idx = {d: np.nonzero(te_day == d)[0] for d in days}


def pvec(name, rule, col):
    nc, vc = pred[(name, "NC")], pred[(name, "VC")]
    if rule == "NC":
        n, w = nc["n"].to_numpy(), nc[col].to_numpy()
    else:
        use = vc["n"].to_numpy() >= 300
        n = np.where(use, vc["n"], nc["n"]); w = np.where(use, vc[col], nc[col])
    par = pred[("a_combo_sel", "NC")]
    pp = (par[col] / par["n"].clip(lower=1)).to_numpy()
    raw = np.where(n > 0, w / np.maximum(n, 1), pp)
    shr = (w + 100 * pp) / (n + 100)
    return raw, shr


boot = []
for target, col in (("win", "w"), ("top3", "t")):
    y = te[target].to_numpy()
    ref_raw, _ = pvec("a_combo_sel", "VC300>NC", col)
    e_ref = (ref_raw - y) ** 2
    for name in DEFS:
        for rule in ("NC", "VC300>NC"):
            raw, shr = pvec(name, rule, col)
            for tag, q in (("raw", raw), ("shrunk", shr)):
                diff = (q - y) ** 2 - e_ref
                per_day = np.array([diff[day_idx[d]].sum() for d in days])
                n_day = np.array([len(day_idx[d]) for d in days])
                bs = []
                for _ in range(500):
                    s = rng.integers(0, len(days), len(days))
                    bs.append(per_day[s].sum() / n_day[s].sum())
                boot.append({"target": target, "def": name, "rule": rule, "est": tag,
                             "dBrier_vs_now_x1e4": diff.mean() * 1e4,
                             "lo95": np.percentile(bs, 2.5) * 1e4, "hi95": np.percentile(bs, 97.5) * 1e4})
B = pd.DataFrame(boot)
B.to_csv(OUT / "scope-eval-boot.csv", index=False)
print("\n## 今の定義（VC300>NC・生の率）との Brier の差（×1e-4、負が良い）と日単位ブートストラップ95%区間")
print(B.to_string(index=False, float_format=lambda v: f"{v:.2f}"))

pd.set_option("display.width", 250)
print("\n## スコア（全艇）")
print(R[R.subset == "all"].to_string(index=False, float_format=lambda v: f"{v:.5f}"))
print("\n## スコア（1号艇・級別混在）")
print(R[R.subset.isin(["boat1", "mixed"])].to_string(index=False, float_format=lambda v: f"{v:.5f}"))
