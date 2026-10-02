"""BOA-271 レースごとの寄与度（B）の学習側の書き出しと記録

推論側（Vercel の JS）がレースごとに TreeSHAP を計算するために、学習ジョブが版ごとに書き出すもの
（ADR-0083、plan「学習側の設計」）:
  - model_win.json・model_win_racecard.json: LightGBM の dump_model() をそのまま（storage.js が gzip して置く）
  - per_race_meta.json: モデルの特徴量の並び・直前情報8列・支部の対応表・テーマ
  - parity_fixture.json: 一致検査の固定データ。test の本体分から 50R、DB の行の形の生の値と、Python の
    特徴量・pred_contrib の組。推論側の treeshap-parity.js が「DB の行 → 特徴量 → SHAP」を通して照合する
記録（事前登録5、止めない）: 展示の効果、ファンに見える値（テーマのシェア等）、分岐の欠損の向き。
"""

from __future__ import annotations

import json
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

import features as F
import metrics as M
from themes import LIVE_FEATURES, THEMES, theme_features

FIXTURE_N = 50
# 事前登録5: 2026-04-01 以降の test は、探索（ablate.py）・FR-2 の事前登録1〜3で見ている。
# 展示の効果を確認的に読むのは、これより前だけ
EXPLORED_FROM = pd.Timestamp("2026-04-01")
RECORD_N_RACES = 2000
CHIP_GAP = 0.05
EXHIBITION_GROUP = ["exh_time", "exh_time_diff", "exh_time_rank"]


# ---------------------------------------------------------------- 書き出し
def model_dump(m: lgb.Booster, path: Path) -> dict:
    d = m.dump_model()
    path.write_text(json.dumps(d))
    return d


def model_entry(m: lgb.Booster, dump: dict, file: str) -> dict:
    return {"file": file, "feature_names": m.feature_name(), "num_trees": m.num_trees(),
            "objective": dump.get("objective")}


def per_race_meta(version: str, win: tuple, racecard: tuple, maps: dict) -> dict:
    """win・racecard: (booster, dump)。file は out/ のファイル名（Storage では storage.js が .gz を付けて置く）。
    themes は themes.py の THEMES そのもの（groups[].features あり。推論側がグループごとに集計するため）。"""
    return {
        "model_version": version,
        "dtype": "float32",
        "models": {"win": model_entry(*win, "model_win.json"),
                   "win_racecard": model_entry(*racecard, "model_win_racecard.json")},
        "live_features": LIVE_FEATURES,
        "categorical_maps": maps,
        "themes": THEMES,
    }


def _num(v: str):
    return None if v == "" else float(v)


def _rid_int(s: pd.Series) -> pd.Series:
    return s.str.replace("-", "", regex=False).astype("int64")


def read_raw(src: Path, name: str) -> pd.DataFrame:
    """CSV を DB の値のまま（文字列、空は ""）読む。"""
    d = pd.read_csv(src / f"{name}.csv", dtype=str, keep_default_na=False)
    d["rid"] = _rid_int(d["race_id"])
    return d


def select_parity_races(test: pd.DataFrame, cond_raw: pd.DataFrame, n: int = FIXTURE_N,
                        seed: int = 0) -> list[int]:
    """一致検査に使うレース（本体分だけ。DB の行の形が取れる期間）。境目になりやすい例を先に入れ、
    残りを無作為に足す: 無風（風向が空・風速0）、風向が空で風速>0、展示タイムの同値、本体に現れる
    天候の各値、支部の番号の最小・最大、ラウンド・グレード不明。"""
    t = test[test["race_date"] > F.KB_END]
    cand = sorted(t["race_id"].unique().tolist())
    cset = set(cand)
    c = cond_raw[cond_raw["rid"].isin(cset)]
    ws = pd.to_numeric(c["wind_speed"], errors="coerce")
    picks: list[int] = []

    def add(ids):
        for r in sorted(set(ids) & cset):
            if r not in picks:
                picks.append(int(r))
                return

    add(c.loc[(c["wind_direction"] == "") & (ws == 0), "rid"])
    add(c.loc[(c["wind_direction"] == "") & (ws > 0), "rid"])
    for w in sorted(c.loc[c["weather"] != "", "weather"].unique()):
        add(c.loc[c["weather"] == w, "rid"])
    ex = t[t["exh_time"].notna()]
    add(ex.loc[ex.duplicated(["race_id", "exh_time"], keep=False), "race_id"])
    bc = t["branch_code"].dropna()
    if len(bc):
        add(t.loc[t["branch_code"] == bc.min(), "race_id"])
        add(t.loc[t["branch_code"] == bc.max(), "race_id"])
    add(t.loc[t["round_code"].isna(), "race_id"])
    add(t.loc[t["grade_code"].isna(), "race_id"])
    rest = [r for r in cand if r not in picks]
    k = max(0, min(n - len(picks), len(rest)))
    picks += [int(r) for r in np.random.default_rng(seed).choice(rest, k, replace=False)]
    return picks


def _floats(a) -> list:
    return [None if not np.isfinite(v) else float(v) for v in np.asarray(a, dtype="float64")]


def parity_fixture(version: str, test: pd.DataFrame, ids: list[int], cond_raw: pd.DataFrame,
                   exh_raw: pd.DataFrame, models: dict[str, lgb.Booster]) -> dict:
    """racecard_features は analogy_race_features.features に書くのと同じ値・並び（win_racecard の並び）。
    live_raw は exhibition_data・race_conditions の DB の値のまま。expected は Python の入力と pred_contrib
    （最後の列が期待値）。"""
    rc_names = models["win_racecard"].feature_name()
    races = []
    for rid in ids:
        rows = test[test["race_id"] == rid].sort_values("boat_number")
        ex = exh_raw[exh_raw["rid"] == rid].sort_values("boat_number")
        co = cond_raw[cond_raw["rid"] == rid]
        cond = co.iloc[0] if len(co) else None
        expected = {}
        for name, m in models.items():
            x = rows[m.feature_name()].astype("float32")
            contrib = m.predict(x, pred_contrib=True)
            expected[name] = {"features": [_floats(r) for r in x.to_numpy()],
                              "contrib": [_floats(r) for r in contrib]}
        races.append({
            "race_id": F.int_to_rid(rid),
            "racecard_features": [{"boat_number": int(b), "features": _floats(r)} for b, r in
                                  zip(rows["boat_number"], rows[rc_names].astype("float32").to_numpy())],
            "live_raw": {
                "exhibition": [{"boat_number": int(r["boat_number"]),
                                "exhibition_time": _num(r["exhibition_time"]),
                                "is_absent": None if r["is_absent"] == "" else r["is_absent"] == "true"}
                               for _, r in ex.iterrows()],
                "conditions": None if cond is None else {
                    "weather": cond["weather"] or None,
                    "wind_direction": cond["wind_direction"] or None,
                    "wind_speed": _num(cond["wind_speed"]),
                    "wave_height": _num(cond["wave_height"])},
            },
            "expected": expected,
        })
    return {"model_version": version, "feature_names": {n: m.feature_name() for n, m in models.items()},
            "races": races}


# ---------------------------------------------------------------- 記録（事前登録5）
def live_complete(test: pd.DataFrame) -> np.ndarray:
    """レースごとに、6艇とも展示タイムがあるか（展示後の段を出すレースと同じ条件。欠場は完全レースで除外済み）。"""
    return test["exh_time"].notna().to_numpy().reshape(-1, 6).all(axis=1)


def exhibition_effect(ll_win: np.ndarray, ll_racecard: np.ndarray, test: pd.DataFrame) -> dict:
    """出走表時点専用 − 展示あり の1着の対数損失（正なら展示が効いている）。確認的に読むのは unexplored。"""
    first = test[test["boat_number"] == 1]
    days = first["race_date"].to_numpy()
    live = live_complete(test)
    unexplored = (first["race_date"] < EXPLORED_FROM).to_numpy()
    diff = ll_racecard - ll_win
    out = {}
    for key, mask in (("all", np.ones(len(diff), bool)), ("live_complete", live),
                      ("unexplored", unexplored), ("unexplored_live_complete", unexplored & live)):
        out[key] = M.paired_ci(diff[mask], days[mask]) if mask.any() else None
    return out


def centered_theme_shares(contrib: np.ndarray, names: list[str]) -> np.ndarray:
    """contrib: (6R, 特徴量+1) の pred_contrib。レース内で6艇の平均を引いた |SHAP| をテーマごとに足し、
    全テーマの合計で割る → (R, テーマ数)。推論側の JS の集計と同じ定義（ADR-0083）。"""
    c = contrib[:, :-1].reshape(-1, 6, len(names))
    c = np.abs(c - c.mean(axis=1, keepdims=True)).sum(axis=1)
    idx = {f: i for i, f in enumerate(names)}
    cols = [[idx[f] for f in theme_features(t) if f in idx] for t in THEMES]
    th = np.stack([c[:, ix].sum(axis=1) for ix in cols], axis=1)
    return th / th.sum(axis=1, keepdims=True)


def _dist(a: np.ndarray) -> dict:
    return {"mean": float(a.mean()), "p10": float(np.percentile(a, 10)),
            "p50": float(np.percentile(a, 50)), "p90": float(np.percentile(a, 90))}


def _top2_gap(sh: np.ndarray) -> np.ndarray:
    s = np.sort(sh, axis=1)
    return s[:, -1] - s[:, -2]


def fan_visible_record(test: pd.DataFrame, win: lgb.Booster, racecard: lgb.Booster,
                       racecard_reseeds: list[lgb.Booster], n: int = RECORD_N_RACES,
                       seed: int = 0) -> dict:
    """事前登録5 の記録2: test の本体分・展示がそろったレースから n レースを無作為に。"""
    first = test[test["boat_number"] == 1]
    ok = (first["race_date"] > F.KB_END).to_numpy() & live_complete(test)
    ids = first["race_id"].to_numpy()[ok]
    pick = np.sort(np.random.default_rng(seed).choice(ids, min(n, len(ids)), replace=False))
    s = test[test["race_id"].isin(pick)].sort_values(["race_date", "race_id", "boat_number"])

    def shares(m):
        return centered_theme_shares(m.predict(s[m.feature_name()].astype("float32"), pred_contrib=True),
                                     m.feature_name())
    sw, sr = shares(win), shares(racecard)
    keys = [t["key"] for t in THEMES]
    # 展示が押し上げた艇: win の中で、展示タイムのグループの中心化した SHAP の合計が最大の艇
    cw = win.predict(s[win.feature_name()].astype("float32"), pred_contrib=True)[:, :-1]
    gi = [win.feature_name().index(f) for f in EXHIBITION_GROUP]
    g = cw[:, gi].sum(axis=1).reshape(-1, 6)
    g = g - g.mean(axis=1, keepdims=True)
    pushed = g.argmax(axis=1)
    exh_rank1 = s["exh_time_rank"].to_numpy().reshape(-1, 6)[np.arange(len(pushed)), pushed] == 1
    reseed = []
    for m in racecard_reseeds:
        so = shares(m)
        reseed.append({"mean_abs_diff": float(np.abs(so - sr).mean()),
                       "top1_changed_rate": float((so.argmax(1) != sr.argmax(1)).mean())})
    return {
        "n_races": int(len(sw)), "scale": f"sample{len(sw)}",
        "shares": {stage: {k: _dist(sh[:, i]) for i, k in enumerate(keys)}
                   for stage, sh in (("exhibition", sw), ("racecard", sr))},
        "top1_swap_rate": float((sw.argmax(1) != sr.argmax(1)).mean()),
        "l1_distance": _dist(np.abs(sw - sr).sum(axis=1)),
        "chip_emphasis_rate": {"exhibition": float((_top2_gap(sw) >= CHIP_GAP).mean()),
                               "racecard": float((_top2_gap(sr) >= CHIP_GAP).mean())},
        "exhibition_pushed_boat": {
            "boat_number_counts": {int(b) + 1: int(c) for b, c in
                                   zip(*np.unique(pushed, return_counts=True))},
            "is_exhibition_rank1_rate": float(exh_rank1.mean())},
        "racecard_reseed": reseed,
    }


def missing_types(dump: dict) -> dict:
    """特徴量ごとの分岐の欠損の扱い（missing_type の件数）。None は「NaN を0として読む」。"""
    names = dump["feature_names"]
    out: dict[str, dict[str, int]] = {}

    def walk(node):
        if "split_feature" not in node:
            return
        f = names[node["split_feature"]]
        mt = str(node.get("missing_type"))
        out.setdefault(f, {}).setdefault(mt, 0)
        out[f][mt] += 1
        walk(node["left_child"])
        walk(node["right_child"])
    for t in dump["tree_info"]:
        walk(t["tree_structure"])
    return out


def nan_rates(df: pd.DataFrame, cols: list[str]) -> dict:
    return {c: float(df[c].isna().mean()) for c in cols}



def definition_record(cond_raw: pd.DataFrame, series: pd.DataFrame, maps: dict) -> dict:
    """事前登録5 の記録6: 特徴量の約束の変更が効いた行数と、本体の節の日目の導出と DB の値の一致率。"""
    ws = pd.to_numeric(cond_raw["wind_speed"], errors="coerce")
    blank = cond_raw["wind_direction"] == ""
    known = cond_raw[cond_raw["series_day"] != ""]
    keys = pd.DataFrame({"venue_code": known["race_id"].str[11:13].astype(int).to_numpy(),
                         "race_date": pd.to_datetime(known["race_id"].str[:10]).to_numpy()})
    d = F.series_day_from_series(keys, series)
    db = pd.to_numeric(known["series_day"], errors="coerce").to_numpy()
    fin = known["is_final_day"].to_numpy()
    fin_known = fin != ""
    return {
        "calm_rows_wind_direction_blank_speed0": int((blank & (ws == 0)).sum()),
        "unknown_rows_wind_direction_blank_speed_pos": int((blank & (ws > 0)).sum()),
        "branch_map_size": len(maps.get("branch_code", {})),
        "series_day_db_rows": int(len(known)),
        "series_day_match_rate": float((d["series_day"].to_numpy() == db).mean()) if len(known) else None,
        "is_final_day_match_rate": (float((d["is_final_day_num"].to_numpy()[fin_known]
                                           == (fin[fin_known] == "true")).mean())
                                    if fin_known.any() else None),
        "series_not_found_rows": int(d["series_day"].isna().sum()),
    }
