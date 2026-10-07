"""BOA-271 v16 朝のバッチ（出走表の時点、tasks T2-5。plan「朝のバッチ」）。

今日（JST）のレースについて、facts（タブ1）・scenario（タブ3）を範囲キーごとに、today・similar（候補と表示用）・
layer（BOA-635）をレースごとに作る。--upload のときは Storage の非公開のバケット analogy-v16 の
`{日付}/{実行ID}/` に書き終えてから、analogy_v16_snapshots（stage=racecard）を書く（逆にするとファイルの無い
snapshot が残る）。--upload なしは --out の下に同じ並びで書くだけ（手元の確認・例のレースの固定データ）。

入力: export_pool.js の CSV（ANALOGY_DATA_DIR）と、表示中の版の model_win.txt（--model、類似レースの距離の重み）。
使い方:
  python v16_morning.py --date 2026-09-27 --races 2026-09-27-20-12 --model out/active/model_win.txt --out /tmp/v16
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

import features as F
import v16_defs as V
import v16_facts as FA
import v16_history as H
import v16_pool as P
import v16_scenario as SC
import v16_similar as S

JST = timezone(timedelta(hours=9))
WIND_BASIS = F.load_wind_basis()
POOL_FROM = "2019-04-01"
MAX_CANDIDATES = 30_000  # 層の中の出走表の距離の上位。展示後の並べ直しの一致率を 99% 以上にする（T2-4、10,000 では層4万件超で 91%）
MAX_SHOWN = 800
MAX_LAYER_ROWS = 2_000
SHAP_SAMPLE = ("2025-01-01", "2025-12-02")
SHAP_RACES, SHAP_SEED = 5000, 7
POOL_CAL, CAL = ("2019-04-01", "2025-05-31"), ("2025-06-01", "2025-12-02")
CLASS_NAME = {4.0: "A1", 3.0: "A2", 2.0: "B1", 1.0: "B2"}
FACT_ITEMS = [i for i, _ in FA.ITEMS]


# ---------------------------------------------------------------- 入力
def race_arrays(df: pd.DataFrame, cols: list[str]) -> tuple[pd.DataFrame, dict[str, np.ndarray]]:
    """features の艇の行（6艇そろうレースだけ、レース順・艇番順）→ 1号艇の行のレース表と (n,6) の配列"""
    df = df.sort_values(["race_date", "race_id", "boat_number"])
    n6 = df.groupby("race_id")["boat_number"].transform("size") == 6
    df = df[n6].reset_index(drop=True)
    n = len(df) // 6
    races = df[df["boat_number"] == 1].reset_index(drop=True)
    arrays = {c: df[c].to_numpy(dtype="float64").reshape(n, 6) for c in cols}
    return races, arrays


def attach_series(arrays: dict, races: pd.DataFrame, series: pd.DataFrame) -> None:
    """今節の平均着順点（前日まで）と走数を (n,6) で足す"""
    rid = series["race_id"]
    if not pd.api.types.is_integer_dtype(rid):  # series_runs の race_id は文字列（pandas 3 は str 型）
        rid = F.rid_to_int(rid.astype(str))
    s = pd.DataFrame({"race_id": rid, "boat_number": series["boat_number"].astype(int),
                      "value": series["value"], "n_prior": series["n_prior"]})
    pos = pd.Series(np.arange(len(races)), index=races["race_id"].to_numpy())
    s = s[s["race_id"].isin(pos.index)]
    i, b = pos[s["race_id"]].to_numpy(), s["boat_number"].to_numpy() - 1
    arrays["series_score"] = np.full((len(races), 6), np.nan)
    arrays["series_runs"] = np.zeros((len(races), 6))
    arrays["series_score"][i, b] = s["value"].to_numpy()
    arrays["series_runs"][i, b] = s["n_prior"].fillna(0).to_numpy()


def class_names(cls_ord: np.ndarray) -> np.ndarray:
    return np.vectorize(lambda v: CLASS_NAME.get(v))(np.where(np.isfinite(cls_ord), cls_ord, 0.0))


def top3_boats(finish_rank: np.ndarray) -> np.ndarray:
    """(n,6) の艇番順の着 → (n,3) の1〜3着の艇番（着のある艇を (着, 艇番) の順に並べた先頭3艇。無ければ 0）。
    長期の同着は着を 1,2,2,4 のように付けるので、「着が k の艇」で引くと同着の2艇目が抜ける（v16_pool.build_races と同じ並べ方）"""
    fr = np.asarray(finish_rank, dtype=float)
    key = np.where(np.isfinite(fr) & (fr >= 1), fr * 10 + np.arange(6), np.inf)
    order = np.argsort(key, axis=1, kind="stable")[:, :3]
    ok = np.take_along_axis(np.isfinite(key), order, axis=1)
    return np.where(ok, order + 1, 0)


# ---------------------------------------------------------------- 範囲
def scope_masks(key: str, races: pd.DataFrame, cls: np.ndarray, combos: np.ndarray) -> np.ndarray:
    """範囲キー（v16_defs.scope_keys の値）→ races のマスク"""
    parts = key.split(":")
    venue = races["venue_code"].astype(int).to_numpy()
    if parts[0] == "NA":
        return np.ones(len(races), bool)
    if parts[0] == "VA":
        return venue == int(parts[1])
    if parts[0] == "VG":
        return (venue == int(parts[1])) & np.isin(races["grade"].to_numpy(dtype=object), S.GRADE_G1_PLUS)
    combo, sel = (parts[2], parts[3]) if parts[0] == "VC" else (parts[1], parts[2])
    boat, c = int(sel[0]), sel[1:]
    m = (combos == combo) & (cls[:, boat - 1] == c)
    if parts[0] == "VC":
        m &= venue == int(parts[1])
    if parts[0] == "NCR":
        m &= races["round"].to_numpy(dtype=object) == parts[3]
    return m


# ---------------------------------------------------------------- 類似レース
def load_weights(model_path: Path, df: pd.DataFrame, pool_races: pd.DataFrame) -> tuple[dict, list[str]]:
    import lightgbm as lgb

    m = lgb.Booster(model_file=str(model_path))
    feats = m.feature_name()
    rd = pool_races["race_date"]
    cand = pool_races.loc[(rd >= SHAP_SAMPLE[0]) & (rd <= SHAP_SAMPLE[1]), "race_id"].to_numpy()
    ids = np.random.default_rng(SHAP_SEED).choice(cand, min(SHAP_RACES, len(cand)), replace=False)
    rows = df[df["race_id"].isin(ids)].sort_values(["race_id", "boat_number"])
    contrib = m.predict(rows[feats].astype("float32"), pred_contrib=True)
    return S.shap_weights(contrib, feats), feats


def build_distance(arrays: dict, races: pd.DataFrame, feats: list[str], weights: dict, stage: str,
                   pool: np.ndarray) -> tuple[np.ndarray, dict]:
    boat_num = S.boat_num_features(feats, stage)
    Z, meta, norm, cats = S.build_z(arrays, races, boat_num, stage, pool)
    X = Z * S.weight_vector(meta, weights)
    rd = races["race_date"]
    pool_cal = np.where((rd >= POOL_CAL[0]) & (rd <= POOL_CAL[1]) & pool)[0]
    cal = np.where((rd >= CAL[0]) & (rd <= CAL[1]) & pool)[0]
    L = S.lambda_base(X, pool_cal, cal)
    return X, {"boat_num": boat_num, "meta": meta, "norm": norm, "categories": cats, "L": L,
               "lambda": L * S.LAM_MULT}


# ---------------------------------------------------------------- 1レース分
def today_payload(i: int, races: pd.DataFrame, arrays: dict, keys: dict, course_st: dict) -> dict:
    """today/{race_id}.json（plan「1レースごとに作るもの」）"""
    vals = {}
    for item, hib in FA.ITEMS:
        if item == "exh_time":
            continue
        v = arrays[item][i]
        ranks = V.rank_positions(v, hib)
        vals[item] = {"values": [None if not np.isfinite(x) else round(float(x), 4) for x in v],
                      "positions": [sorted(p) for p in ranks]}
    runs = [int(x) for x in arrays["series_runs"][i]]
    return {
        "race_id": F.int_to_rid(int(races["race_id"].iat[i])),
        "venue_code": int(races["venue_code"].iat[i]), "grade": races["grade"].iat[i],
        "round": races["round"].iat[i], "class_combo": V.class_combo(list(arrays["cls_name"][i])),
        "classes": list(arrays["cls_name"][i]), "scope_keys": keys, "items": vals,
        "series_runs_before_today": runs, "early_series_note": V.early_series_note(runs),
        "course_st": course_st,
        # 展示後の段（JS）が今日の風の成分を作るときの、会場の風向の回転（features.py の wind_basis.json）
        "wind_offset_deg": WIND_BASIS["offsets_deg"].get(str(int(races["venue_code"].iat[i]))),
        "hints": {"course": V.hint_conditions(course_st["course_filled"]),
                  "overall": V.hint_conditions(course_st["overall"])},
    }


EXH_RACE_COLS = ("weather_code", "wind_x", "wind_y", "wind_speed", "wave_height")
# 展示タイムの差・順位は JS が展示タイムから作る（src/utils/analogyRaceFeatures.js の meanFloat32・rankMinAscending は
# pandas の float32 と一致を検査済み）ので、候補ファイルには展示タイムだけを持たせる
EXH_BOAT_COLS = ("exh_time",)


def f32_list(values) -> list:
    """float32 の値を、float32 に戻すと同じ値になる最短の10進表記の数にする（欠損は null）"""
    return [None if not np.isfinite(v) else float(str(np.float32(v))) for v in values]


def pool_exhibition(races: pd.DataFrame, exh_time: np.ndarray, pool: np.ndarray) -> dict:
    """母集団（pool）の展示で決まる値（展示後の段が、展示で決まる5項目の pool_rate を今日の展示の値で数える）。
    天候・風・波は値の組ごとの件数（組は数百しかない）、展示タイムは 1/100秒の整数（レース×6、欠損は null）。
    展示タイムは 1/100秒刻みなので整数にしても float32 の値は変わらない（変わる値があれば失敗にする）"""
    rc = list(EXH_RACE_COLS)
    vals = races.loc[pool, rc].astype(np.float32)
    grp = vals.groupby(rc, dropna=False).size().reset_index(name="n")
    rows = [f32_list(r[:-1]) + [int(r[-1])] for r in grp.to_numpy(dtype=float)]
    e = np.asarray(exh_time, dtype=np.float32)[pool]
    ok = np.isfinite(e)
    h = np.round(e.astype(np.float64) * 100)
    if not np.array_equal(np.float32(h[ok] / 100), e[ok]):
        raise ValueError("展示タイムに 1/100秒刻みでない値がある（pool/exhibition を整数で持てない）")
    flat = np.where(ok, h, np.nan).ravel()
    return {"n": int(pool.sum()), "race_cols": rc, "race_rows": rows,
            "exh_time": [None if not np.isfinite(v) else int(v) for v in flat]}


def gz(obj) -> bytes:
    # 圧縮レベルは5（既定の9は1日分で約8分かかり、大きさは数%しか変わらない。T2-6）
    return gzip.compress(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode(), compresslevel=5)


def write_local(out: Path, rel: str, obj) -> None:
    p = out / (rel + ".gz" if not rel.endswith(".gz") else rel)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(gz(obj))


# ---------------------------------------------------------------- Storage・DB（--upload）
BUCKET = "analogy-v16"


def _storage(method: str, path: str, body: bytes | None = None, headers: dict | None = None):
    import urllib.error
    import urllib.request

    from db import PostgrestError, _env

    url, key = _env()
    h = {"apikey": key, "Authorization": f"Bearer {key}"} | (headers or {})
    req = urllib.request.Request(f"{url}/storage/v1/{path}", data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as e:
        if e.code in (400, 404) and method == "GET":
            return e.code, e.read()
        raise PostgrestError(f"storage {method} {path}: HTTP {e.code} {e.read().decode(errors='replace')[:300]}") from e


def ensure_bucket() -> None:
    """非公開のバケット analogy-v16（analogy とは分ける。plan「Storage」）。無ければ作る"""
    status, _ = _storage("GET", f"bucket/{BUCKET}")
    if status == 200:
        return
    _storage("POST", "bucket", json.dumps({"id": BUCKET, "name": BUCKET, "public": False}).encode(),
             {"Content-Type": "application/json"})


UPLOAD_WORKERS = 16


def upload_dir(local: Path, prefix: str, workers: int = UPLOAD_WORKERS) -> int:
    """local の下の全ファイルを {prefix}/… に置く。上書きしない（x-upsert: false。同じパスがあれば失敗）。
    1日 約2,000ファイルを1件ずつ送ると約18分かかったので並列に送る（T2-6）。1件でも失敗すれば例外にする"""
    from concurrent.futures import ThreadPoolExecutor

    files = sorted(local.rglob("*.gz"))

    def put(p: Path) -> None:
        rel = p.relative_to(local).as_posix()
        _storage("POST", f"object/{BUCKET}/{prefix}/{rel}", p.read_bytes(),
                 {"Content-Type": "application/gzip", "x-upsert": "false"})

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(put, files))  # 例外はここで投げ直される
    return len(files)


def write_snapshots(rows: list[dict]) -> None:
    """racecard の段の snapshot。出走表のハッシュが変わったレースだけを作り直すので、同じ (race_id, stage) は上書きする"""
    from db import request

    if rows:
        request("POST", "analogy_v16_snapshots?on_conflict=race_id,stage", rows,
                prefer="resolution=merge-duplicates,return=minimal")


MIN_MINUTES_BEFORE_DEADLINE = 10


def select_targets(rows: list[dict], now: datetime, hashes: dict[str, str]) -> list[str]:
    """作るレース（plan「朝のバッチ」の対象）: 締切まで10分以上・中止でない・欠場が分かっていない、かつ
    racecard の snapshot が無いか、出走表のハッシュが変わった（選手の差し替え）。rows は fetch_today の戻り値、
    hashes は今の出走表のハッシュ {race_id: hash}"""
    out = []
    for r in rows:
        if r["cancelled"] or r["absent"] or r["deadline"] is None:
            continue
        if r["deadline"] - now < timedelta(minutes=MIN_MINUTES_BEFORE_DEADLINE):
            continue
        if r["race_id"] not in hashes:  # 6艇の出走表がそろっていない
            continue
        if r["snapshot_hash"] is not None and r["snapshot_hash"] == hashes[r["race_id"]]:
            continue
        out.append(r["race_id"])
    return out


def fetch_today(date: str) -> list[dict]:
    """今日のレースの締切・中止・欠場と、racecard の snapshot のハッシュ（DB は読み取りのみ）。
    races.start_time を締切時刻（JST）として使う"""
    from db import request

    races, _ = request("GET", f"races?race_date=eq.{date}&select=race_id,start_time,cancellation_status")
    ids = ",".join(r["race_id"] for r in races) or "none"
    absent = set()
    for table in ("race_entries", "exhibition_data"):
        rows, _ = request("GET", f"{table}?race_id=in.({ids})&is_absent=is.true&select=race_id")
        absent |= {r["race_id"] for r in rows}
    snaps, _ = request("GET", f"analogy_v16_snapshots?race_id=in.({ids})&stage=eq.racecard"
                              "&select=race_id,racecard_hash")
    snap = {r["race_id"]: r["racecard_hash"] for r in snaps}
    out = []
    for r in races:
        st = r["start_time"]
        deadline = None if not st else datetime.fromisoformat(f"{date}T{st}").replace(tzinfo=JST)
        out.append({"race_id": r["race_id"], "deadline": deadline, "cancelled": bool(r["cancellation_status"]),
                    "absent": r["race_id"] in absent, "snapshot_hash": snap.get(r["race_id"])})
    return out


def late_for(deadline: datetime | None, now: datetime) -> bool:
    """snapshot を書く時点で締切を過ぎているか（締切が分からなければ過ぎていないとみなす。--races の手元の実行）"""
    return deadline is not None and now >= deadline


def racecard_hash(arrays: dict, i: int) -> str:
    """出走表の内容のハッシュ（選手の差し替えを見分ける）。6艇の選手番号・級別・勝率・モーター・ボートの2連率"""
    import hashlib

    keys = ("racer_id", "cls_ord", "nat_win", "loc_win", "motor_2", "boat_2")
    payload = [[None if not np.isfinite(x) else round(float(x), 3) for x in arrays[k][i]] for k in keys]
    return hashlib.sha256(json.dumps(payload).encode()).hexdigest()[:16]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=datetime.now(JST).strftime("%Y-%m-%d"))
    ap.add_argument("--races", default="", help="対象の race_id（カンマ区切り）。省略時は今日の全レース")
    ap.add_argument("--model", required=True, help="表示中の版の model_win.txt")
    ap.add_argument("--out", required=True)
    ap.add_argument("--upload", action="store_true", help="Storage と analogy_v16_snapshots に書く")
    ap.add_argument("--model-version", default="", help="重みに使った版（snapshot の model_version）")
    ap.add_argument("--run-id", default=datetime.now(JST).strftime("%H%M%S") + "-" + os.environ.get("GITHUB_RUN_ID",
                                                                                                    "local"))
    a = ap.parse_args()
    t0 = time.time()
    log = lambda *x: print(f"[{time.time() - t0:6.0f}s]", *x, flush=True)  # noqa: E731
    src = F.D
    date = pd.Timestamp(a.date)
    cutoff = date - pd.Timedelta(days=1)
    out = Path(a.out) / a.date / a.run_id

    df = F.build(src)
    log("features", len(df))
    series = H.series_score_asof(H.assign_series(H.series_runs(src), pd.read_csv(src / "race_series.csv")))
    log("series")
    keep = (df["race_ok"] & (df["race_date"] >= POOL_FROM) & (df["race_date"] <= cutoff)) | (df["race_date"] == date)
    cols = sorted(set(FACT_ITEMS + ["racer_id", "cls_ord", "branch_code", "nat_win_rank", "st_mean30_rank", "recent_top3_30",
                                    "age", "weight", "is_local", "exh_time_diff", "exh_time_rank", "finish_rank"]
                      + [f for f in df.columns if f not in ("race_id", "race_date", "branch", "cls",
                                                            "grade", "round", "race_ok")
                         and (pd.api.types.is_numeric_dtype(df[f]) or pd.api.types.is_bool_dtype(df[f]))]))
    races, arrays = race_arrays(df[keep], [c for c in cols if c in df.columns])
    attach_series(arrays, races, series)
    arrays["cls_name"] = class_names(arrays["cls_ord"])
    combos = np.array([V.class_combo(list(c)) for c in arrays["cls_name"]], dtype=object)
    pool = (races["race_date"] <= cutoff).to_numpy()
    today = np.where(races["race_date"] == date)[0]
    deadlines = {}  # race_id → 締切（--upload で今日のレースを選ぶとき。snapshot を締切前だけ書くため）
    if a.races:
        want = {F.rid_to_int(pd.Series([r])).iat[0] for r in a.races.split(",")}
        today = np.array([i for i in today if int(races["race_id"].iat[i]) in want])
    elif a.upload:
        hashes = {F.int_to_rid(int(races["race_id"].iat[i])): racecard_hash(arrays, i) for i in today}
        rows_today = fetch_today(a.date)
        deadlines = {r["race_id"]: r["deadline"] for r in rows_today}
        no_deadline = [r["race_id"] for r in rows_today if r["deadline"] is None and not r["cancelled"]]
        if no_deadline:
            log("締切時刻（races.start_time）が無いので作らない:", ",".join(no_deadline))
        want = set(select_targets(rows_today, datetime.now(JST), hashes))
        today = np.array([i for i in today if F.int_to_rid(int(races["race_id"].iat[i])) in want], dtype=int)
        if len(today) == 0:
            log("作るレースが無い（すべて作成済み・締切間近・中止・欠場）")
            return
    fr = arrays["finish_rank"]
    ranks = top3_boats(fr)
    log("races", len(races), "pool", int(pool.sum()), "today", len(today))

    # 範囲ごと: facts（タブ1）
    prep = FA.prepare({k: arrays[k] for k in FACT_ITEMS})
    keys_by_race = {}
    for i in today:
        for b in range(1, 7):
            keys_by_race.setdefault(i, {})[b] = V.scope_keys(int(races["venue_code"].iat[i]),
                                                             list(arrays["cls_name"][i]), b, races["round"].iat[i],
                                                             races["grade"].iat[i])
    fact_keys = sorted({k for ks in keys_by_race.values() for kb in ks.values() for s, k in kb.items()
                        if s in ("VC", "NC", "NCR", "VA")})
    for key in fact_keys:
        m = scope_masks(key, races, arrays["cls_name"], combos) & pool
        va = key.startswith("VA")
        f = FA.scope_facts(m, prep, ranks, races["wind_speed"].to_numpy() if va else None,
                           races["wave_height"].to_numpy() if va else None)
        f["key"], f["period"] = key, [POOL_FROM, str(cutoff.date())]
        write_local(out, f"facts/{key.replace(':', '_')}.json", f)
    log("facts", len(fact_keys))

    # 範囲ごと: scenario（タブ3。1号艇の範囲キー）
    all_races = P.load_races(src)  # 過去レースの結果の行（タブ3の母集団・layer・枠なりの判定）。重いので1回だけ
    pr = all_races[(all_races["race_date"] >= POOL_FROM) & (all_races["race_date"] <= str(cutoff.date()))
                   & all_races["tab3_ok"]]
    pr = pr.assign(_rid=F.rid_to_int(pr["race_id"])).set_index("_rid")
    t3 = races.loc[pool & races["race_id"].isin(pr.index).to_numpy()]
    t3i = t3.index.to_numpy()
    d = SC.prepare(pr.loc[t3["race_id"].to_numpy()].reset_index(drop=True))
    hist = H.st_history(df, all_races)  # F.build の行は load_kb・load_main と同じ行（窓に入れる走の集合が同じ）
    tgt = pd.DataFrame({"racer_id": arrays["racer_id"][t3i].ravel(),
                        "race_date": np.repeat(races["race_date"].to_numpy()[t3i], 6),
                        "course": np.tile(np.arange(1, 7, dtype=float), len(t3i))})
    tgt["racer_id"] = tgt["racer_id"].astype(hist["racer_id"].dtype)
    c = H.rolling_st_asof(hist[hist["waku"]], tgt, ["racer_id", "course"])
    A = arrays["st_mean30"][t3i]
    C = np.array(V.fill_course_st(list(c["mean"].where(c["mean"].notna(), None)), list(c["n"]),
                                  list(A.ravel())), dtype=float).reshape(-1, 6)
    C[np.isnan(A).any(1)] = np.nan
    motor_rank = np.where(np.isnan(arrays["motor_2"][t3i]).any(1, keepdims=True), np.nan,
                          V.min_rank(arrays["motor_2"][t3i], True))
    exh_rank = np.where(np.isnan(arrays["exh_time"][t3i]).any(1, keepdims=True), np.nan,
                        V.min_rank(arrays["exh_time"][t3i], False))
    st6 = SC.matrix(pr.loc[t3["race_id"].to_numpy(), "st_by_course"])
    base3 = ~np.isnan(st6).any(1) & ~np.isnan(A).any(1)
    scn_keys = sorted({k for ks in keys_by_race.values() for k in ks[1].values()})
    for key in scn_keys:
        m = scope_masks(key, t3.reset_index(drop=True), arrays["cls_name"][t3i], combos[t3i])
        s = SC.scope_cells(m, d)
        s["hints"] = SC.scope_hints(m, d, {"course": C, "overall": A})
        s["attack"] = SC.scope_attack(m & d["entries"]["waku"] & base3, d["forms"], d["ranks"][:, 0],
                                      d["ranks"][:, 1], d["tech"], motor_rank, exh_rank, V.st_cent(np.nan_to_num(st6)))
        # 脚注「返還（F・L・欠場）があったレースなど{n}件を除く」（spec C-5）: タブ1・2の母集団との差（返還のほか、
        # 3着が無い・実進入が分からないレースも除く。どちらの件数とも合うように差で持つ）
        s["n_refund_excluded"] = int((scope_masks(key, races, arrays["cls_name"], combos) & pool).sum()) - s["n"]
        s["key"], s["period"] = key, [POOL_FROM, str(cutoff.date())]
        write_local(out, f"scenario/{key.replace(':', '_')}.json", s)
    log("scenario", len(scn_keys))

    # 今日のレースの「このコース」の平均ST（前日まで。コース＝艇番、5走未満は全体で埋める）
    tt = pd.DataFrame({"racer_id": arrays["racer_id"][today].ravel(),
                       "race_date": np.repeat(races["race_date"].to_numpy()[today], 6),
                       "course": np.tile(np.arange(1, 7, dtype=float), len(today))})
    tt["racer_id"] = tt["racer_id"].astype(hist["racer_id"].dtype)
    tc = H.rolling_st_asof(hist[hist["waku"]], tt, ["racer_id", "course"])
    tv = tt.assign(venue_code=np.repeat(races["venue_code"].to_numpy(dtype="float64")[today], 6))
    vc = H.rolling_st_asof(hist, tv, ["racer_id", "venue_code"])  # 会場での直近30走（コースを問わない）
    today_course = {i: {"course": [None if pd.isna(m) else float(m) for m in tc["mean"].iloc[6 * k:6 * k + 6]],
                        "course_n": [int(n) for n in tc["n"].iloc[6 * k:6 * k + 6]],
                        "venue": [None if pd.isna(m) else float(m) for m in vc["mean"].iloc[6 * k:6 * k + 6]],
                        "venue_n": [int(n) for n in vc["n"].iloc[6 * k:6 * k + 6]],
                        "venue_course_all": H.venue_course_st(hist, int(races["venue_code"].iat[i]), a.date)}
                    for k, i in enumerate(today)}
    # 展示→本番の一致率（全国、展示の進入の記録がある期間。spec C-1・C-3 の注記。今日のレースによらない）
    agreement = SC.exhibition_agreement(pr.reset_index(drop=True), P.load_exhibition_layout(src))

    # レースごと: similar・layer・today
    weights, feats = load_weights(Path(a.model), df[df["race_id"].isin(races["race_id"][pool])], races[pool])
    X, info = build_distance(arrays, races, feats, weights, "racecard", pool)
    log("distance", X.shape, "L", round(info["L"], 4))
    # 展示後の段（JS）の並べ直しに使う列: 展示後の表し方（knn8）にあって出走表の表し方（knn7）に無い列。
    # 標準化・カテゴリ・重みは同じなので、展示後の距離² ＝ 出走表の距離² ＋ これらの列の距離²
    Xe, info_e = build_distance(arrays, races, feats, weights, "exhibition", pool)
    rc_cols = {(m["feature"], m["slot"], m.get("cat")) for m in info["meta"]}
    extra = [j for j, m in enumerate(info_e["meta"]) if (m["feature"], m["slot"], m.get("cat")) not in rc_cols]
    del Xe  # 列の情報と L だけ使う（候補の値は生の値で持たせ、JS が重み付けする）
    extra_meta = [info_e["meta"][j] for j in extra]
    extra_feats = sorted({m["feature"] for m in extra_meta})
    exh_header = {"lambda": info_e["lambda"], "L": info_e["L"], "columns": extra_meta,
                  "weights": S.weight_vector(extra_meta, weights).tolist(),
                  "norm": {f: info_e["norm"][f] for f in extra_feats if f in info_e["norm"]},
                  "categories": {f: info_e["categories"][f] for f in extra_feats if f in info_e["categories"]}}
    log("exhibition columns", len(extra), "L", round(info_e["L"], 4))
    b1 = arrays["cls_name"][:, 0]
    gap, top = S.gap_band(arrays["nat_win"]), S.top_boat(arrays["nat_win"])
    venue = races["venue_code"].astype(int).to_numpy()
    clusters = S.venue_clusters(venue, ranks[:, 0], pool)
    is_kb = (races["race_date"] <= F.KB_END).to_numpy()
    n_layers = {}
    prl = all_races.assign(_rid=lambda x: F.rid_to_int(x["race_id"])).set_index("_rid")
    def write_race(i: int, rid: str, out: Path) -> None:
        """1レース分の similar（候補）・similar-racecard・layer・today"""
        cond = S.layer_conditions(b1[i], gap[i], top[i], races["round"].iat[i], races["grade"].iat[i])
        lm = S.layer_mask(cond, b1, gap, top, races["round"].to_numpy(dtype=object),
                          races["grade"].to_numpy(dtype=object)) & pool
        n_layer = int(lm.sum())
        n_layers[i] = n_layer
        idx, d2, d2p = S.rank_layer(X, X[i], venue, int(venue[i]), info["lambda"], lm, MAX_CANDIDATES)
        lv = S.item_levels(races, arrays, i, clusters, is_kb)
        shown = idx[:MAX_SHOWN]
        cmp_cond, cmp_name = S.compare_conditions(cond)
        disp = S.display_columns(races, arrays, idx, is_kb)  # 候補すべての表示用の値（展示後の段が800件に付ける）
        today_disp = S.display_row(S.display_columns(races, arrays, np.array([i]), is_kb), 0)
        cm = S.layer_mask(cmp_cond, b1, gap, top, races["round"].to_numpy(dtype=object),
                          races["grade"].to_numpy(dtype=object)) & pool
        write_local(out, f"similar-racecard/{rid}.json", {
            "race_id": rid, "conditions": cond, "n_layer": n_layer,
            "pool_rate": {k: float((v[pool] == 2).mean()) for k, v in lv.items()},
            "today_display": today_disp,
            "compare": {"name": cmp_name, "conditions": cmp_cond} | outcome_counts(cm),
            "national": national_counts,
            "neighbors": [{"race_id": F.int_to_rid(int(races["race_id"].iat[j])), "distance": round(float(np.sqrt(e)), 4),
                           "items": {k: int(v[j]) for k, v in lv.items()}, "display": S.display_row(disp, c)}
                          | result_of(j)
                          for c, (j, e) in enumerate(zip(shown, d2p[:MAX_SHOWN]))],
        })
        # 展示後の段（JS）が並べ直した800件に、33項目と結果を付けられるように: 出走表の時点で決まる項目の判定、
        # 展示で決まる項目（天候・風・波・展示タイムの差）の生の値、結果を候補ごとに持たせる
        write_local(out, f"similar/{rid}.json", {
            "race_id": rid, "candidates": [F.int_to_rid(int(races["race_id"].iat[j])) for j in idx],
            "n_layer": n_layer, "lambda_racecard": info["lambda"],
            "d2_racecard": [round(float(x), 6) for x in d2], "venue_match": [bool(venue[j] == venue[i]) for j in idx],
            "exhibition": exh_header,
            "items_racecard": {k: v[idx].tolist() for k, v in lv.items() if k not in S.EXHIBITION_ITEMS},
            # 展示の列の生の値。float32 の最短表記で持たせ、JS が今日の値と同じ式で z 化・重み付けする
            # （Python の float32 の値を JSON を通して変えずに渡すため。展示後の33項目の判定にも使う）
            "exhibition_raw": {"race": {k: f32_list(races[k].to_numpy()[idx]) for k in EXH_RACE_COLS},
                               "boats": {k: [f32_list(row) for row in arrays[k][idx]] for k in EXH_BOAT_COLS}},
            "results": [{k: v for k, v in result_of(j).items() if k not in ("date", "venue_code", "race_number")}
                        for j in idx],  # 日付・会場・R は race_id から分かる
        })
        # 表示用の値は候補ファイルと別に置く（展示後の段だけが読む。候補ファイルの大きさを増やさない）
        write_local(out, f"similar-display/{rid}.json", {"race_id": rid, "today": today_disp, "columns": disp})
        lay = prl.loc[prl.index.isin(races["race_id"][lm]) & prl["layer_ok"]].sort_values(
            ["race_date", "race_id"], ascending=False)
        write_local(out, f"layer/{rid}.json", {
            "run_id": a.run_id, "race_id": rid, "conditions": cond, "n_total": int(len(lay)),
            "n_returned": int(min(len(lay), MAX_LAYER_ROWS)), "pool_from": POOL_FROM, "pool_cutoff": str(cutoff.date()),
            "rows": [P.layer_row(r | {"race_id": rid_}) for rid_, r in
                     zip(lay["race_id"].head(MAX_LAYER_ROWS), lay.head(MAX_LAYER_ROWS).to_dict("records"))],
        })
        overall = [None if not np.isfinite(x) else float(x) for x in arrays["st_mean30"][i]]
        tcs = today_course[i]
        payload = today_payload(i, races, arrays, keys_by_race[i], {
            "overall": overall, "course": tcs["course"], "course_n": tcs["course_n"],
            "course_filled": V.fill_course_st(tcs["course"], tcs["course_n"], overall),
            "venue": tcs["venue"], "venue_n": tcs["venue_n"], "venue_course_all": tcs["venue_course_all"]})
        write_local(out, f"today/{rid}.json", payload | {"exh_agreement": agreement})

    tech_all = races["race_id"].map(prl["winning_technique"]).to_numpy(dtype=object)

    def outcome_counts(m: np.ndarray) -> dict:
        """比べる相手・全国の件数（spec B-8 の点線）: 1着・2着以内・3着以内の艇番ごとの件数と決まり手"""
        top2 = [(m & ((ranks[:, 0] == b) | (ranks[:, 1] == b))).sum() for b in range(1, 7)]
        top3 = [(m & (ranks[:, :3] == b).any(axis=1)).sum() for b in range(1, 7)]
        tech = pd.Series(tech_all[m]).dropna().value_counts()
        return {"n": int(m.sum()), "winner": [int((m & (ranks[:, 0] == b)).sum()) for b in range(1, 7)],
                "top2": [int(x) for x in top2], "top3": [int(x) for x in top3],
                "technique": {str(k): int(v) for k, v in tech.items()}}

    national_counts = outcome_counts(pool)  # どのレースでも同じなので1回だけ数える

    # 展示後の段が、展示で決まる5項目の pool_rate を今日の展示の値で数えるための母集団の値（全レースで共通）
    write_local(out, "pool/exhibition.json", pool_exhibition(races, arrays["exh_time"], pool))

    failed = {}
    # 過去レースの結果を races の並びにそろえて1回だけ作る（候補1万件ごとに pandas の .loc で引くと遅い。T2-6）
    aligned = prl.reindex(races["race_id"].to_numpy())
    res_has = aligned["race_date"].notna().to_numpy()
    res_tech = aligned["winning_technique"].to_numpy(dtype=object)
    res_pay = aligned["payout_3tan"].to_numpy(dtype=float)
    res_course = aligned["course_by_boat"].to_numpy(dtype=object)
    res_st = aligned["st_by_course"].where(aligned["layer_ok"].fillna(False).astype(bool), None).to_numpy(dtype=object)
    res_date = races["race_date"].astype(str).str[:10].to_numpy()
    res_rn = races["race_number"].to_numpy()
    res_grade = races["grade"].to_numpy(dtype=object)
    res_round = races["round"].to_numpy(dtype=object)

    def result_of(j: int) -> dict:
        """過去レースの結果（similar の各件。spec B-7・B-8）"""
        out = {"date": res_date[j], "venue_code": int(venue[j]), "race_number": int(res_rn[j]),
               "grade": res_grade[j], "round": res_round[j], "finish": [int(x) for x in ranks[j]]}
        if res_has[j]:
            st = res_st[j]
            out |= {"technique": None if pd.isna(res_tech[j]) else res_tech[j],
                    "payout_3tan": None if np.isnan(res_pay[j]) else int(res_pay[j]),
                    "course_by_boat": list(res_course[j]), "st_by_course": None if st is None else list(st)}
        return out

    for i in today:
        rid = F.int_to_rid(int(races["race_id"].iat[i]))
        try:
            write_race(i, rid, out)
        except Exception as e:  # 1レースの失敗で他のレースを止めない（書けた分は書いてから失敗にする）
            failed[rid] = f"{type(e).__name__}: {e}"
            log("失敗", rid, failed[rid])
    done = [i for i in today if F.int_to_rid(int(races["race_id"].iat[i])) not in failed]

    log("races done", len(done), "failed", len(failed))
    if a.upload:
        ensure_bucket()
        n = upload_dir(out, f"{a.date}/{a.run_id}")
        snaps, late = [], []
        for i in done:
            rid = F.int_to_rid(int(races["race_id"].iat[i]))
            if late_for(deadlines.get(rid), datetime.now(JST)):
                late.append(rid)  # 作っている間に締切を過ぎた（plan「締切前だけ書く」）。ファイルは置いたまま
                continue
            snaps.append({"race_id": rid, "stage": "racecard", "run_id": a.run_id,
                          "computed_at": datetime.now(timezone.utc).isoformat(), "pool_cutoff": str(cutoff.date()),
                          "model_version": a.model_version or None, "n_layer": n_layers[i],
                          "status": "ok" if n_layers[i] > 0 else "empty_layer",
                          "racecard_hash": racecard_hash(arrays, i)})
        write_snapshots(snaps)
        log("uploaded", n, "files", len(snaps), "snapshots", f"締切を過ぎて書かなかった {len(late)}: {','.join(late)}")
    if failed:
        raise SystemExit(f"today・similar を作れなかったレース {len(failed)} 件: {failed}")


if __name__ == "__main__":
    main()
