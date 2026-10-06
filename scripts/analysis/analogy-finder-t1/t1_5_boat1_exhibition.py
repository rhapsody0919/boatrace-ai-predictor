"""BOA-271 v16 T1-5: 1号艇の展示タイムが系統的に速い理由（選手の違いか、位置・測り方か）。

事前登録: docs/design/analogy-finder/analysis/t1/preregistration-t1.md（「共通」「T1-5」、レビュー表の指摘8・10）、
コミット 238e0bb5a。

- 値: 展示タイムをレースの中で中心化した値（6艇の平均を引く。参考に中央値）。0以下と 6.30〜7.50秒の外は欠損、
  欠場の艇も除き、値のある艇が5艇以上のレースだけ
- 母集団: 完全レース（t1_3_refund.py の t1_3_races.pkl と同じ条件。2019-04-01〜2026-09-26）。主は予選
  （rounds.csv の category_new が qualifier・general。長期で名前が空なら stage_kind が qualifier・other）、参考に全レース
- 長期（kb_boats.exhibition_time）と本体（exhibition.exhibition_time）を分ける
- 指標: Δ_raw＝1号艇の平均 − 2〜6号艇の平均、Δ_fe＝選手×節ごとの（1号艇のときの平均 − 2〜6号艇のときの平均）を
  両方ある選手×節で単純平均、r＝Δ_fe／Δ_raw。艇番ごとに同じもの。展示順位1位の割合（同タイムは min 順位）。
  幅は日単位のブートストラップ（200回、seed 0）、割合は Wilson 95%
- 参考: 中央値で中心化した版、節の日目の差が1日以内の走どうしの比較

入力: $ANALOGY_SCRATCH/model-prep/data/{kb_boats,exhibition,entries,races,results}.csv、
      $ANALOGY_SCRATCH/t1/rounds.csv（T1-1 最終版 v2）、$ANALOGY_SCRATCH/t1/t1_3_races.pkl（完全レース）、
      $ANALOGY_SCRATCH/tab1/series_score_rows.pkl（節 series_key・日目 series_day）
出力: docs/design/analogy-finder/analysis/t1/t1-5-boat1-exhibition.json

使い方: ANALOGY_SCRATCH=~/boatrace-data-archive/boa271-fr2-scratch-2026-10-04 \
        $ANALOGY_SCRATCH/model-prep/venv/bin/python scripts/analysis/analogy-finder-t1/t1_5_boat1_exhibition.py
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import numpy as np
import pandas as pd

if not os.environ.get("ANALOGY_SCRATCH"):
    raise SystemExit("ANALOGY_SCRATCH が未設定（スクラッチのディレクトリを渡す）")
SCRATCH = Path(os.path.expanduser(os.environ["ANALOGY_SCRATCH"]))
DATA = SCRATCH / "model-prep" / "data"
T1 = SCRATCH / "t1"
REPO = Path(__file__).resolve().parents[3]
OUT_JSON = REPO / "docs/design/analogy-finder/analysis/t1/t1-5-boat1-exhibition.json"

START, KB_END, END = "2019-04-01", "2025-12-02", "2026-09-26"
LO, HI = 6.30, 7.50
MIN_BOATS = 5
QUAL_CATS = {"qualifier", "general"}
KB_EMPTY_NAME_KINDS = {"qualifier", "other"}
N_BOOT, SEED = 200, 0
Z = 1.959964
BOATS = np.arange(1, 7)


def fail(msg: str):
    raise SystemExit(f"検査に失敗: {msg}")


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for ch in iter(lambda: f.read(1 << 20), b""):
            h.update(ch)
    return h.hexdigest()


def wilson(x: int, n: int):
    if n == 0:
        return None
    p = x / n
    d = 1 + Z * Z / n
    c = (p + Z * Z / (2 * n)) / d
    h = Z * np.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / d
    return [round(p, 5), round(c - h, 5), round(c + h, 5)]


def to_bool(s: pd.Series) -> pd.Series:
    return s.astype(str).str.lower().eq("true")


def ci(a):
    a = np.asarray(a, float)
    a = a[np.isfinite(a)]
    if len(a) == 0:
        return None
    return [round(float(np.percentile(a, 2.5)), 5), round(float(np.percentile(a, 97.5)), 5)]


# ---------- 読み込み ----------
def load(inputs: dict) -> pd.DataFrame:
    p_pool = T1 / "t1_3_races.pkl"
    pool = pd.read_pickle(p_pool)[["race_id", "race_date", "src"]]
    pool["race_date"] = pd.to_datetime(pool["race_date"])
    inputs["t1/t1_3_races.pkl"] = {"rows": len(pool), "max_date": str(pool.race_date.max().date()),
                                   "sha256_file": sha256_file(p_pool),
                                   "note": "完全レース（t1_3_refund.py の build_races の pool。6艇・欠場なし・返還艇が3着以内でない・1着1艇・2着3着あり）"}
    if pool.race_date.min() < pd.Timestamp(START) or pool.race_date.max() > pd.Timestamp(END):
        fail("完全レースの期間が 2019-04-01〜2026-09-26 の外にある")

    # 長期
    p_kb = DATA / "kb_boats.csv"
    kb = pd.read_csv(p_kb, usecols=["race_id", "boat_number", "racer_id", "exhibition_time", "finish_raw"],
                     dtype={"finish_raw": str}, low_memory=False)
    inputs["model-prep/data/kb_boats.csv"] = {"rows": len(kb), "max_race_id": str(kb.race_id.max()),
                                              "sha256_file": sha256_file(p_kb)}
    kb["absent"] = kb["finish_raw"].isna() | kb["finish_raw"].str.startswith("K", na=False)
    kb = kb.merge(pool[pool.src == "kb"], on="race_id", how="inner")

    # 本体
    p_x, p_e, p_r, p_res = DATA / "exhibition.csv", DATA / "entries.csv", DATA / "races.csv", DATA / "results.csv"
    x = pd.read_csv(p_x, usecols=["race_id", "boat_number", "exhibition_time", "is_absent"])
    e = pd.read_csv(p_e, usecols=["race_id", "boat_number", "racer_id", "is_absent"])
    races = pd.read_csv(p_r, usecols=["race_id", "race_date"])
    res = pd.read_csv(p_res, usecols=["race_id", "rank1"])
    for key, p, df in [("exhibition", p_x, x), ("entries", p_e, e), ("races", p_r, races), ("results", p_res, res)]:
        inputs[f"model-prep/data/{key}.csv"] = {"rows": len(df), "max_race_id": str(df.race_id.max()),
                                                "sha256_file": sha256_file(p)}
    inputs["model-prep/data/races.csv"]["max_date"] = str(races.race_date.max())
    pm = pool[pool.src == "main"]
    # 照合: 完全レース（本体）はすべて races.csv にあり、results に1着がある
    if not pm.race_id.isin(races.race_id).all() or not pm.race_id.isin(res.loc[res.rank1.notna(), "race_id"]).all():
        fail("本体の完全レースが races.csv・results.csv と食い違う")
    mn = e.rename(columns={"is_absent": "e_absent"}).merge(
        x.rename(columns={"is_absent": "x_absent"}), on=["race_id", "boat_number"], how="left")
    mn["absent"] = to_bool(mn["e_absent"].fillna(False)) | to_bool(mn["x_absent"].fillna(False))
    mn = mn.merge(pm, on="race_id", how="inner")

    cols = ["race_id", "race_date", "src", "boat_number", "racer_id", "exhibition_time", "absent"]
    b = pd.concat([kb[cols], mn[cols]], ignore_index=True)
    if len(b) != 6 * len(pool):
        fail(f"完全レースの艇が 6×レース数にならない（{len(b)} vs {6 * len(pool)}）")

    # 節（選手×節）と日目
    p_ss = SCRATCH / "tab1" / "series_score_rows.pkl"
    ss = pd.read_pickle(p_ss)[["race_id", "boat_number", "racer_id", "series_key", "series_day"]]
    inputs["tab1/series_score_rows.pkl"] = {"rows": len(ss), "sha256_file": sha256_file(p_ss)}
    b["rid"] = b["race_id"].str.replace("-", "", regex=False).astype("int64")
    b = b.merge(ss.rename(columns={"race_id": "rid", "racer_id": "ss_racer"}), on=["rid", "boat_number"], how="left")
    if len(b) != 6 * len(pool):
        fail("series_score_rows の結合で行数が変わった")
    mism = b.ss_racer.notna() & (b.ss_racer != b.racer_id)
    if mism.any():
        fail(f"series_score_rows と選手が食い違う {int(mism.sum())} 行")

    # 種別（T1-1 v2）
    p_rd = T1 / "rounds.csv"
    rd = pd.read_csv(p_rd, dtype=str, keep_default_na=False)
    inputs["t1/rounds.csv"] = {"rows": len(rd), "max_race_id": str(rd.race_id.max()), "sha256_file": sha256_file(p_rd)}
    b = b.merge(rd[["race_id", "category_new", "stage_name", "stage_kind"]], on="race_id", how="left")
    if b.category_new.isna().any():
        fail("rounds.csv に無い完全レースがある")
    empty_kb = (b.src == "kb") & (b.stage_name == "")
    b["qual"] = b.category_new.isin(QUAL_CATS) | (empty_kb & b.stage_kind.isin(KB_EMPTY_NAME_KINDS))
    # 感度用: 名前の種別が決まらないレース（独自名の企画レース等。category_new が空）も足した版
    b["qual_wide"] = b["qual"] | (b.category_new == "")
    return b


# ---------- 中心化 ----------
def center(b: pd.DataFrame, info: dict) -> pd.DataFrame:
    t = pd.to_numeric(b["exhibition_time"], errors="coerce")
    bad_range = t.notna() & ((t <= 0) | (t < LO) | (t > HI))
    valid = t.notna() & ~bad_range & ~b["absent"]
    info["missing_rule"] = {
        "boats_total": int(len(b)),
        "by_src": {s: {"boats": int((b.src == s).sum()), "null": int((t.isna() & (b.src == s)).sum()),
                       "le0": int(((t <= 0) & (b.src == s)).sum()),
                       "out_of_6.30_7.50": int((t.notna() & (t > 0) & ((t < LO) | (t > HI)) & (b.src == s)).sum()),
                       "absent": int((b.absent & (b.src == s)).sum()),
                       "valid": int((valid & (b.src == s)).sum())} for s in ["kb", "main"]}}
    b = b.assign(t=t.where(valid))
    n_valid = b.groupby("race_id")["t"].transform("count")
    races_by = {}
    for s in ["kb", "main"]:
        m = b.src == s
        races_by[s] = {"races": int(b.loc[m, "race_id"].nunique()),
                       "races_ge5": int(b.loc[m & (n_valid >= MIN_BOATS), "race_id"].nunique()),
                       "races_6": int(b.loc[m & (n_valid == 6), "race_id"].nunique())}
    info["races_ge5_valid"] = races_by
    b = b[(n_valid >= MIN_BOATS) & b.t.notna()].copy()
    g = b.groupby("race_id")["t"]
    b["x_mean"] = b["t"] - g.transform("mean")
    b["x_median"] = b["t"] - g.transform("median")
    t100 = np.rint(b["t"] * 100).astype(int)
    b["rank1"] = t100 == t100.groupby(b["race_id"]).transform("min")
    chk = b.groupby("race_id")["x_mean"].sum().abs().max()
    if chk > 1e-9:
        fail("平均で中心化した値のレース内の和が0でない")
    return b


# ---------- 指標 ----------
def compute(sub: pd.DataFrame, xcol: str, W_day: np.ndarray, day_ix: np.ndarray) -> dict:
    """sub: 1行＝1艇。W_day: (N_BOOT, n_days) の日の重み、day_ix: 各行の日の番号"""
    x = sub[xcol].to_numpy(float)
    boat = sub["boat_number"].to_numpy(int)
    has_g = sub["series_key"].notna().to_numpy()
    gkey = sub.groupby(["racer_id", "series_key"], sort=False, dropna=False).ngroup().to_numpy()
    gkey = np.where(has_g, gkey, -1)
    ng = gkey.max() + 1
    out = {"rows": int(len(sub)), "races": int(sub["race_id"].nunique()),
           "rows_without_series_key": int((~has_g).sum())}

    weights = [np.ones(len(x))] + [W_day[i][day_ix] for i in range(N_BOOT)]
    gm = gkey >= 0
    gb = gkey[gm] * 6 + (boat[gm] - 1)
    xg = x[gm]
    raw_all, fe_all, nboth = [], [], None
    for w in weights:
        # 艇番ごとの重みつき合計（Δ_raw）
        Sb = np.bincount(boat - 1, w * x, 6); Nb = np.bincount(boat - 1, w, 6)
        raw_all.append(Sb / Nb - (Sb.sum() - Sb) / (Nb.sum() - Nb))
        # 選手×節×艇番の重みつき合計（Δ_fe）
        wg = w[gm]
        S = np.bincount(gb, wg * xg, ng * 6).reshape(ng, 6); N = np.bincount(gb, wg, ng * 6).reshape(ng, 6)
        St, Nt = S.sum(1, keepdims=True), N.sum(1, keepdims=True)
        S0, N0 = St - S, Nt - N
        v = (N > 0) & (N0 > 1e-12)
        with np.errstate(invalid="ignore", divide="ignore"):
            d = np.where(v, S / np.where(v, N, 1) - S0 / np.where(v, N0, 1), 0.0)
        fe_all.append(d.sum(0) / v.sum(0))
        if nboth is None:
            nboth = v.sum(0)
    raw_all, fe_all = np.array(raw_all), np.array(fe_all)

    by_boat = {}
    for k in BOATS:
        raws, fe = raw_all[:, k - 1], fe_all[:, k - 1]
        r = fe / raws
        m_k = x[boat == k]
        rk = sub["rank1"].to_numpy()[boat == k]
        by_boat[str(k)] = {
            "n_rows": int(len(m_k)),
            "mean_centered": round(float(m_k.mean()), 5),
            "mean_time_sec": round(float(sub["t"].to_numpy()[boat == k].mean()), 5),
            "delta_raw": round(float(raws[0]), 5), "delta_raw_boot95": ci(raws[1:]),
            "delta_fe": round(float(fe[0]), 5), "delta_fe_boot95": ci(fe[1:]),
            "n_groups_both": int(nboth[k - 1]),
            "r": round(float(r[0]), 4), "r_boot95": ci(r[1:]),
            "rank1_share_wilson": wilson(int(rk.sum()), int(len(rk))), "rank1_n": int(rk.sum()),
        }
    out["by_boat"] = by_boat

    # 参考: 同じ選手×節で、節の日目の差が1日以内の走どうし（1号艇 vs 2〜6号艇）
    sd = sub["series_day"].to_numpy(float)
    ok = gm & np.isfinite(sd)
    idx = np.arange(len(x))
    a = pd.DataFrame({"g": gkey[ok & (boat == 1)], "i": idx[ok & (boat == 1)]})
    c = pd.DataFrame({"g": gkey[ok & (boat != 1)], "j": idx[ok & (boat != 1)]})
    pr = a.merge(c, on="g")
    pr = pr[np.abs(sd[pr.i.to_numpy()] - sd[pr.j.to_numpy()]) <= 1]
    pi, pj, pg = pr.i.to_numpy(), pr.j.to_numpy(), pr.g.to_numpy()
    d = x[pi] - x[pj]
    near = []
    for w in weights:
        pw = w[pi] * w[pj]
        S = np.bincount(pg, pw * d, ng); N = np.bincount(pg, pw, ng)
        v = N > 0
        near.append(float(np.mean(S[v] / N[v])) if v.any() else np.nan)
    near = np.array(near)
    out["near_day_le1_boat1"] = {
        "def": "同じ選手×節で、1号艇の走と2〜6号艇の走の組のうち節の日目（series_day）の差が1日以内のものの差を、選手×節ごとに平均し、選手×節で単純平均",
        "n_pairs": int(len(pr)), "n_groups": int(len(np.unique(pg))),
        "rows_without_series_day": int((gm & ~np.isfinite(sd)).sum()),
        "delta": round(float(near[0]), 5), "delta_boot95": ci(near[1:]),
        "r_vs_delta_raw": round(float(near[0] / by_boat["1"]["delta_raw"]), 4),
    }
    return out


def judge(c: dict) -> dict:
    b1 = c["by_boat"]["1"]
    r, lo_hi = b1["r"], b1["delta_fe_boot95"]
    zero_in = lo_hi[0] <= 0 <= lo_hi[1]
    if r >= 2 / 3 and not zero_in:
        v = "position_or_measurement"
    elif r <= 1 / 3 or zero_in:
        v = "racer_difference"
    else:
        v = "both"
    return {"r": r, "delta_fe": b1["delta_fe"], "delta_fe_boot95": lo_hi, "delta_fe_ci_contains_0": bool(zero_in),
            "delta_raw": b1["delta_raw"], "verdict": v}


def main():
    inputs: dict = {}
    mf = json.loads((DATA / "fetch_manifest.json").read_text())
    inputs["model-prep/data/fetch_manifest.json"] = {"sha256_file": sha256_file(DATA / "fetch_manifest.json"),
                                                     "version": mf.get("version"), "tables": mf["tables"]}
    info: dict = {}
    b = load(inputs)
    b = center(b, info)

    results: dict = {}
    pops = {"qualifier": "qual", "all": None, "qualifier_wide_sensitivity": "qual_wide"}
    for src in ["kb", "main"]:
        s = b[b.src == src]
        uday, dix = np.unique(s["race_date"].to_numpy(), return_inverse=True)
        rng = np.random.default_rng(SEED)
        W = np.stack([np.bincount(rng.integers(0, len(uday), len(uday)), minlength=len(uday)) for _ in range(N_BOOT)]).astype(float)
        results[src] = {"n_days": int(len(uday)), "date_range": [str(pd.Timestamp(uday.min()).date()), str(pd.Timestamp(uday.max()).date())]}
        for pk, col in pops.items():
            m = np.ones(len(s), bool) if col is None else s[col].to_numpy()
            sub = s[m]
            results[src][pk] = {}
            for xc, name in [("x_mean", "mean_centered"), ("x_median", "median_centered")]:
                if pk == "qualifier_wide_sensitivity" and xc == "x_median":
                    continue
                results[src][pk][name] = compute(sub, xc, W, dix[m])
                print(src, pk, name, {k: results[src][pk][name]["by_boat"]["1"][k] for k in ["delta_raw", "delta_fe", "delta_fe_boot95", "r"]})

    J = {src: judge(results[src]["qualifier"]["mean_centered"]) for src in ["kb", "main"]}
    J_ref = {src: judge(results[src]["all"]["mean_centered"]) for src in ["kb", "main"]}
    J_med = {src: judge(results[src]["qualifier"]["median_centered"]) for src in ["kb", "main"]}
    same = J["kb"]["verdict"] == J["main"]["verdict"]
    final = J["main"]["verdict"]
    note_text = {
        "position_or_measurement": f"1号艇は展示タイムが速く出やすい（同じ選手でも1号艇のときに約{abs(J['main']['delta_fe']):.2f}秒速い）",
        "racer_difference": "1号艇には力のある選手が入りやすく、展示タイムでも上位に入りやすい",
        "both": "両方を書く案（1号艇には力のある選手が入りやすいことと、同じ選手でも1号艇のときに展示タイムが速く出ること）",
    }[final]

    notes = [
        "完全レースは t1_3_refund.py が作った t1_3_races.pkl（408,723レース＝prep7 の全国 n_pool と一致）をそのまま使った。期間 2019-04-01〜2026-09-26、長期は〜2025-12-02、本体は 2025-12-03〜",
        "欠損: exhibition_time が空・0以下・6.30秒未満・7.50秒超、または欠場（長期 finish_raw が空か K*、本体 entries/exhibition の is_absent）。完全レースは欠場なしなので欠場は0件になる",
        "予選: rounds.csv（T1-1 v2）の category_new が qualifier・general。長期で stage_name が空なら stage_kind が qualifier・other（長期の完全レースに名前が空のものは無く、この枝は0件）。本体で名前が空（204レース、全期間）は種別不明として除く",
        "名前から種別が決まらないレース（category_new が空。『ランチタイム』『モーニング予』等の独自名の企画レース。長期 stage_kind は other か qualifier）は事前登録の規則どおり主の母集団から除き、含めた版を qualifier_wide_sensitivity として参考に出した（判定には使わない）",
        "中心化はレースで値のある艇（5艇か6艇）の平均・中央値。展示順位1位は値のある艇の中で、タイムを1/100秒の整数にして最小と同じ艇（min 順位、同タイムは全員1位）。1位の割合の分母は、その艇番に値のあるレース",
        "Δ_raw＝その艇番の行の平均 − 他の艇番の行の平均（行で重みづけ）。Δ_fe＝選手×節（series_score_rows.pkl の racer_id×series_key）ごとに（その艇番のときの平均 − 他の艇番のときの平均）を取り、両方ある選手×節で単純平均。艇番ごとの値は1号艇と同じ式を k 号艇に当てたもの（k 号艇 vs それ以外）",
        "ブートストラップ: 長期・本体それぞれで、その出どころの完全レース（5艇以上）の日を np.random.default_rng(0) から200回復元抽出し、日の出現回数を行の重みにして同じ式で数え直した（選手×節の中の平均も重みつき、選手×節は重みが正の側が両方あるものを単純平均）。母集団・中心化・艇番どうしは同じ抽出を使う。幅は2.5/97.5%点",
        "日目1日以内の比較は series_day（長期 kb_venue_days、本体 conditions）で数え、series_day が空の行（本体の約0.8%）は除いた。1号艇だけ出した。組ごとの重みは両方の行の日の重みの積",
        "判定は事前登録の規則を機械的に当てた: 主（予選・平均で中心化）の1号艇で r≥2/3 かつ Δ_fe の幅が0を含まない→位置・測り方、r≤1/3 か幅が0を含む→選手の違い、その間→両方。長期と本体で違えば本体を採る",
        "in-sample の記述（モデルの評価はしない）。限界: 予選に絞っても、選手×節の中で1号艇の日と調子が相関しうる",
        "展示タイムは小さいほど速い。Δ が負＝1号艇が速い",
        "ブートストラップの偏り: 日の復元抽出では、選手×節の片側（その艇番の走か他の艇番の走）が抜けて数えられなくなる組が出るため、delta_fe の抽出分布が点推定から少しずれ、点推定が 2.5/97.5% 点の外に出るセルがある（例: 長期・全レース・1号艇 delta_fe −0.01834 に対し幅 [−0.01869, −0.01839]）。ずれは 0.0001 秒未満で、判定（幅が0を含むか）には効かない。幅は事前登録どおり百分位点のまま出した",
        "展示順位1位の割合は1号艇で約28〜30%（予選・全レースとも）。第11回の『全国で約半数』は slit-hint/mark1.md の展示上位（1〜2位、min 順位）の割合で、この分析の1位の割合とは別の数",
    ]

    res = {
        "preregistration": {"file": "docs/design/analogy-finder/analysis/t1/preregistration-t1.md", "section": "T1-5（レビュー表の指摘8・10）",
                            "commit": "238e0bb5a"},
        "script": "scripts/analysis/analogy-finder-t1/t1_5_boat1_exhibition.py",
        "definition": {
            "value": "展示タイムのレース内中心化（平均。参考に中央値）。欠損: 0以下・6.30〜7.50秒の外・欠場。値のある艇が5艇以上のレースだけ",
            "population_main": "完全レースのうち予選（category_new ∈ qualifier・general、長期で名前が空なら stage_kind ∈ qualifier・other）",
            "population_ref": "完全レースすべて",
            "sources": {"kb": "長期 kb_boats.exhibition_time（2019-04-01〜2025-12-02）", "main": "本体 exhibition.exhibition_time（2025-12-03〜2026-09-26）"},
            "metrics": "delta_raw＝1号艇 − 2〜6号艇、delta_fe＝選手×節の中の差の平均、r＝delta_fe/delta_raw、rank1_share_wilson＝[p, lo, hi]、*_boot95＝日単位ブートストラップ200回 seed 0",
            "rule": "r ≥ 2/3 かつ delta_fe の幅が0を含まない→位置・測り方 / r ≤ 1/3 か幅が0を含む→選手の違い / その間→両方。長期と本体で違えば本体を採る",
        },
        "inputs": inputs,
        "checks": info,
        "judgment": {"primary": J, "kb_main_agree": same, "adopted": final, "adopted_source": "main",
                     "proposed_note_text": note_text,
                     "reference_all_races": J_ref, "reference_median_centered": J_med},
        "results": results,
        "notes": notes,
    }

    def clean(o):
        if isinstance(o, dict):
            return {k: clean(v) for k, v in o.items()}
        if isinstance(o, (list, tuple)):
            return [clean(v) for v in o]
        if hasattr(o, "item"):
            o = o.item()
        if isinstance(o, float) and not np.isfinite(o):
            return None
        return o

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(clean(res), ensure_ascii=False, indent=1, allow_nan=False))
    print("judgment", json.dumps(clean(res["judgment"]), ensure_ascii=False))


if __name__ == "__main__":
    main()
