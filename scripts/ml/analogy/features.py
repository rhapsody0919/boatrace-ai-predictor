"""BOA-271 アナロジー・ファインダー: 艇単位の特徴量（学習・寄与度の集計で共通）

export_pool.js が書き出した CSV から、長期（kb_archive、〜2025-12-02）と本体テーブル
（2025-12-03〜）を同じ列名にそろえて連結し、as-of の特徴量を作る。
Phase M の scripts/analysis/analogy-finder-phase-m/build_dataset.py を本番用に直したもの。
Phase M からの変更点:
  - 選手の履歴（直近成績・過去 ST）は日単位でずらす。同じ日の前のレースの結果は、同じ日の
    後のレースの特徴量に入れない（出走表時点で分かるのは前日までの成績のため。plan「as-of」）
  - ラウンドは本体が getRaceStageCategory（src/constants/raceStageConfig.js）と同じ規則、
    長期は kb_archive_races.stage_kind（長期の stage の文字列は途中で切れているため）。
    会場の企画レース名など分類できないステージは「その他」、ステージが無いレースは None（「全ラウンド」にだけ入れる）
  - グレードは長期が kb_archive_venue_days.race_grade、本体が races.race_grade を先に使い、
    無ければ race_series の期間で補う
  - 1〜3着に返還艇（F・出遅れ）が入るレースは完全レースから外す（本体の rank は返還艇も
    公式の並びのまま入っている）。データの穴（2025-12〜2026-03）は K/B 補完で埋まったので外さない

レースごとの寄与度（B、ADR 案（#1134「レースごとの寄与度」）・plan「学習側の設計」）のため、出走表の時点（朝 6:40）に分かる値で
定義する列がある。朝の初期化は体重・支部・節の日目・最終日を書かず、2連率は toFixed(1) で丸めて書く
（発走60分前の取り直しで上書きされる）。学習の行は取り直し後の値なので、次のようにそろえる:
  - 本体期間の節の日目・最終日は race_series から導く（race_conditions の値は使わない）
  - 体重・支部は前日までに分かっている最後の値（当日の値は使わない）
  - 2連率4列は JS の toFixed(1) と同じ丸め
  - 風向が空で風速0は無風（0）

使い方: python features.py   → data/ml/analogy/boats.pkl・categorical_maps.json
"""

from __future__ import annotations

import json
import os
import re
import unicodedata
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
D = Path(os.environ.get("ANALOGY_DATA_DIR", ROOT / "data" / "ml" / "analogy"))

KB_END = pd.Timestamp("2025-12-02")
HISTORY_WINDOW = 30

CLASS_ORD = {"B2": 1, "B1": 2, "A2": 3, "A1": 4}
WEATHER_CODE = {"晴": 0, "曇り": 1, "雨": 2, "雪": 3, "霧": 4, "台風": 5}
GRADES = ["ippan", "G3", "G2", "G1", "SG"]
GRADE_CODE = {g: i for i, g in enumerate(GRADES)}
ROUNDS = ["yosen", "junyu", "yusho", "other"]
ROUND_CODE = {r: i for i, r in enumerate(ROUNDS)}
DIR16 = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東",
         "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"]
DIR_ANGLE = {d: i * 22.5 for i, d in enumerate(DIR16)}
# 本体の風向（直前情報・結果ページのアイコン）は方位ではなく、ページの水面の図（会場ごとに北の向きが違う）に対する向き。
# 長期分（K ファイル、方位）の基準に直す表。作り方と根拠は build-wind-basis.js と docs/design/analogy-finder/wind-basis.md
WIND_BASIS_FILE = Path(__file__).resolve().parent / "wind_basis.json"
# 本体で DB の風向が空・風速>0 のレース（2025-12・01 はほぼ全件、他の月は K/B の補完で風速だけ入った行）は、
# K ファイルの風向（方位、回転なし）で埋める
K_WIND_FILL_FILE = Path(__file__).resolve().parent / "k_wind_fill.csv"


def load_wind_basis(path: Path = WIND_BASIS_FILE) -> dict:
    """{"offsets_deg": {"1": 角度, …}}（per_race_meta.json にもそのまま入れる）"""
    return {"offsets_deg": json.loads(path.read_text())["offsets_deg"]}


def wind_offset(venue_code: pd.Series, basis: dict) -> pd.Series:
    """本体の風向から引く角度。表に無い会場は NaN（風向を欠損にする。無風は0のまま）"""
    return venue_code.astype(int).astype(str).map(basis["offsets_deg"]).astype("float64")
VENUE_PREF = {1: "群馬", 2: "埼玉", 3: "東京", 4: "東京", 5: "東京", 6: "静岡",
              7: "愛知", 8: "愛知", 9: "三重", 10: "福井", 11: "滋賀", 12: "大阪",
              13: "兵庫", 14: "徳島", 15: "香川", 16: "岡山", 17: "広島", 18: "山口",
              19: "山口", 20: "福岡", 21: "福岡", 22: "福岡", 23: "佐賀", 24: "長崎"}


# ---------------------------------------------------------------- ラウンド
def _has_special(s: str) -> bool:
    return any(k in s for k in ("特選", "特賞", "特別", "選抜"))


# 優勝戦・準優勝戦の判定 v2（#1134 の docs/design/analogy-finder/analysis/t1/t1-1-stage-rule.json の rules。
# 一致検査の82件は tests/test_features.py）。準々・準優進出は準優勝戦にしない（Q-C(3)）。
# src/constants/raceStageConfig.js の RACE_STAGE_CATEGORY_RULES は v16 T1-1 で v2 にそろえる。それまでは
# 準決・セミファイナル・決勝戦・〜優 などの名前（本体で6レース）だけ JS と答えが違う
def _strip_ws(s: str) -> str:
    return re.sub(r"\s", "", s)


def _is_final(s: str) -> bool:
    # 長期の名前は6文字で切れるので「〜優勝」「〜優」も優勝戦（準優を除く）
    if _strip_ws(s).endswith("優勝") and "準優" not in s:
        return True
    if "ファイナル選" in s:  # ファイナル選抜（選抜戦）
        return False
    return ("優勝戦" in s
            or any(k in s for k in ("決勝戦", "王座決定戦", "賞金女王決定", "王将位決定戦"))
            or ("ファイナル" in s and "進出" not in s)
            or (_strip_ws(s).endswith("優") and "準優" not in s))


_STAGE_RULES = [
    ("semifinalQualifier", lambda s: "準々" in s or "準優進出" in s),
    # 男女Ｗ優勝戦の「Ｗ準優戦前半/後半」も準優勝戦（BOA-728）
    ("semifinal", lambda s: re.search(r"準優勝?戦", s) is not None or "準決" in s
     or "セミファイナル" in s),
    ("final", _is_final),
    ("dream", lambda s: "ドリーム" in s or "DR" in s),
    ("qualifierSpecial", lambda s: "予選" in s and _has_special(s)),
    ("generalSpecial", lambda s: "一般" in s and _has_special(s)),
    ("selection", lambda s: "選抜" in s),
    ("special", _has_special),
    ("qualifier", lambda s: "予選" in s),
    ("general", lambda s: "一般" in s),
]
_CATEGORY_ROUND = {"qualifier": "yosen", "qualifierSpecial": "yosen", "semifinal": "junyu",
                   "final": "yusho"}
_KB_KIND_ROUND = {"qualifier": "yosen", "semifinal": "junyu", "final": "yusho", "other": "other"}


# 判定 v2 の前の規則（版 2026-10-02 までの学習）。事前登録5 の記録（ラウンドが変わった行数・参照版を旧定義で
# 評価した値）にだけ使う。名前の判定は準優勝戦・優勝戦の2つだけが v2 と違う
_STAGE_RULES_V1 = [
    _STAGE_RULES[0],
    ("semifinal", lambda s: re.search(r"準優勝?戦", s) is not None),
    ("final", lambda s: "優勝戦" in s),
    *_STAGE_RULES[3:],
]


def stage_category(stage) -> str | None:
    """レースの名前（NFKC）→ 種別キー（raceStageConfig.js の区分と同じキー）。空なら None。"""
    if not isinstance(stage, str) or not stage:
        return None
    s = unicodedata.normalize("NFKC", stage)
    return next((k for k, test in _STAGE_RULES if test(s)), None)


def round_from_stage(stage) -> str | None:
    """本体の race_conditions.race_stage → 4区分。ステージが空なら None。"""
    if not isinstance(stage, str) or not stage:
        return None
    return _CATEGORY_ROUND.get(stage_category(stage), "other")


def round_from_stage_v1(stage) -> str | None:
    if not isinstance(stage, str) or not stage:
        return None
    s = unicodedata.normalize("NFKC", stage)
    return _CATEGORY_ROUND.get(next((k for k, test in _STAGE_RULES_V1 if test(s)), None), "other")


def round_from_kb_kind(stage, kind) -> str | None:
    """長期の kb_archive_races の stage（名前）と stage_kind → 4区分。名前を先に見て、決まらないときだけ
    stage_kind（t1_1_stage_rule.py の kb_new）。名前が準々・準優進出なら stage_kind が semifinal でも
    準優勝戦にしない（Q-C(3)）。名前が優勝戦・準優勝戦でなければ、ほかの区分は stage_kind で決める
    （長期の名前は短く切れていて、予選などの判定は stage_kind の方が確か）。"""
    cat = stage_category(stage)
    if cat == "semifinalQualifier":
        return "other"
    if cat == "semifinal":
        return "junyu"
    if cat == "final" or kind == "final":
        return "yusho"
    return _KB_KIND_ROUND.get(kind) if isinstance(kind, str) else None


# ---------------------------------------------------------------- 読み込み
# 朝の経路（generate-predictions.js）が toFixed(1) で丸めて書く2連率の元の列名（長期・本体）
RATE_COLUMNS = {"national_2rate", "global_2rate", "local_2rate", "motor_2rate", "boat_2rate"}


def _round1(v: float) -> float:
    # float64 の正確な10進値で最も近い方、ちょうど中間なら大きい方（JS の Number.prototype.toFixed）
    return float(Decimal(v).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def round1_like_js(s: pd.Series) -> pd.Series:
    """JS の parseFloat(x.toFixed(1)) と同じ値（float64 のうちに丸める。値の種類が少ないので一意な値で計算）。"""
    s = pd.to_numeric(s, errors="coerce").astype("float64")
    u = s.dropna().unique()
    return s.map(dict(zip(u, (_round1(v) for v in u))))


def rid_to_int(s: pd.Series) -> pd.Series:
    """race_id 'YYYY-MM-DD-VV-RR' → int64 YYYYMMDDVVRR（文字列のままだとメモリが足りないため）。"""
    c = s.astype("category")
    cats = pd.Series(c.cat.categories).str.replace("-", "", regex=False).astype("int64").to_numpy()
    return pd.Series(cats[c.cat.codes.to_numpy()], index=s.index)


def int_to_rid(v: int) -> str:
    s = f"{int(v):012d}"
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}-{s[8:10]}-{s[10:12]}"


def read(name: str, src: Path = D, **kw) -> pd.DataFrame:
    path = src / f"{name}.csv"
    if not path.exists():
        raise FileNotFoundError(f"{path} がありません。先に export_pool.js を実行してください")
    d = pd.read_csv(path, low_memory=False, **kw)
    if "race_id" in d.columns:
        d["race_id"] = rid_to_int(d["race_id"])
    for c in RATE_COLUMNS & set(d.columns):
        d[c] = round1_like_js(d[c])
    for c in d.columns:
        if d[c].dtype == "float64":
            d[c] = d[c].astype("float32")
    return d


def _bool(s: pd.Series) -> pd.Series:
    return s.map({True: True, False: False, "true": True, "false": False,
                  "True": True, "False": False}).fillna(False).astype(bool)


def encode_race_level(r: pd.DataFrame, weather, wind_dir, wind_speed, final_day,
                      wind_offset: pd.Series | float = 0.0) -> pd.DataFrame:
    """wind_offset: 風向の角度から引く値（本体を K の基準に直す。長期分は0）。NaN は風向を欠損にする"""
    out = pd.DataFrame({"race_id": r["race_id"]})
    out["weather_code"] = r[weather].map(WEATHER_CODE).astype("float32")
    # 推論側の JS（analogyRaceFeatures.js の windComponents）と同じ計算の順（角度−回転 → ラジアン）にする
    ang = r[wind_dir].map(DIR_ANGLE) - wind_offset
    ws = pd.to_numeric(r[wind_speed], errors="coerce")
    # 本体は無風を「風向が空・風速0」で持つ（'無風' の行は無い）。風向が空で風速>0 は不明（NaN）
    calm = (r[wind_dir] == "無風") | (r[wind_dir].isna() & (ws == 0))
    # 風向は長期が8方位・本体が16方位なので、角度×風速のベクトル成分にそろえる（無風は0）
    out["wind_x"] = np.where(calm, 0.0, ws * np.sin(np.deg2rad(ang))).astype("float32")
    out["wind_y"] = np.where(calm, 0.0, ws * np.cos(np.deg2rad(ang))).astype("float32")
    out["is_final_day_num"] = r[final_day].map(
        {True: 1, False: 0, "True": 1, "False": 0, "true": 1, "false": 0}).astype("float32")
    return out


# 長期の会場日のうち最終日の割合の下限。BOA-696（#1166）の前は K/B が最終日も「第N日」と書くため全件 false
# だった（期待は 31,023 日中 約5,579＝約18%）。事前登録5 の前提で、満たさなければ学習しない
MIN_FINAL_DAY_RATE = 0.10


def check_final_day(is_final_day: pd.Series) -> None:
    v = is_final_day.astype(str).str.lower()
    rate = float((v == "true").mean()) if len(v) else 0.0
    if rate < MIN_FINAL_DAY_RATE:
        raise RuntimeError(
            f"長期の is_final_day が true の会場日が {rate:.1%}（下限 {MIN_FINAL_DAY_RATE:.0%}）。BOA-696 の修正が"
            "入っていないか、Storage のキャッシュが古い（export_pool.js の KB_CACHE_VERSION を上げる）")


def load_kb(src: Path = D) -> pd.DataFrame:
    b = read("kb_boats", src, usecols=[
        "race_id", "boat_number", "racer_id", "class", "age", "branch", "weight",
        "national_win_rate", "national_2rate", "local_win_rate", "local_2rate",
        "motor_2rate", "boat_2rate", "exhibition_time", "start_timing", "is_flying",
        "is_late_start", "finish_raw", "finish_rank"],
             dtype={"branch": "category", "class": "category", "finish_raw": "category",
                    "race_id": "category"})
    r = read("kb_races", src)
    r = r[_bool(r["has_result"]) & (pd.to_datetime(r["race_date"]) <= KB_END)]
    vd = pd.read_csv(src / "kb_venue_days.csv", low_memory=False)
    check_final_day(vd["is_final_day"])
    r = r.merge(vd[["venue_day_id", "series_day", "is_final_day", "race_grade"]],
                on="venue_day_id", how="left")
    enc = encode_race_level(r, "weather", "wind_direction", "wind_speed", "is_final_day")
    rr = pd.DataFrame({"race_id": r["race_id"], "race_date": pd.to_datetime(r["race_date"]),
                       "venue_code": r["venue_code"], "race_number": r["race_number"],
                       "wind_speed": r["wind_speed"], "wave_height": r["wave_height"],
                       "series_day": r["series_day"],
                       "grade": r["race_grade"].where(r["race_grade"].isin(GRADES)),
                       "round": [round_from_kb_kind(st, k) for st, k in zip(r["stage"], r["stage_kind"])],
                       # v2 の前の定義（長期は stage_kind だけ）。記録用
                       "round_v1": r["stage_kind"].map(_KB_KIND_ROUND),
                       }).merge(enc, on="race_id")
    # 欠場（K0/K1）・不明は、そのレースごと除外する（発走前に分かる欠場を含む6艇比較にしない）
    kcat = [c for c in b["finish_raw"].cat.categories if str(c).startswith("K")]
    bad = set(b.loc[b["finish_raw"].isin(kcat) | b["finish_raw"].isna(), "race_id"])
    b = b.drop(columns=["finish_raw"])
    b = b.rename(columns={"class": "cls", "national_win_rate": "nat_win", "national_2rate": "nat_2",
                          "local_win_rate": "loc_win", "local_2rate": "loc_2",
                          "motor_2rate": "motor_2", "boat_2rate": "boat_2",
                          "exhibition_time": "exh_time", "start_timing": "st_result",
                          "is_late_start": "is_late"})
    b["is_flying"] = _bool(b["is_flying"])
    b["is_late"] = _bool(b["is_late"])
    df = b.merge(rr, on="race_id", how="inner")
    df["race_ok"] = ~df["race_id"].isin(bad)
    return df


def main_wind(cond: pd.DataFrame, basis: dict,
              fill_path: Path = K_WIND_FILL_FILE) -> tuple[pd.DataFrame, pd.Series]:
    """本体の風向と、引く角度。DB の風向が空で風速>0 のうち K の風向があるレースは、K の値（方位）を入れて
    回転しない。それ以外は会場の回転を引く。"""
    cond = cond.copy()
    offset = wind_offset((cond["race_id"] // 100) % 100, basis)  # race_id は rid_to_int の後（YYYYMMDDVVRR）
    f = pd.read_csv(fill_path, dtype=str)
    fill = pd.Series(f["wind_direction"].to_numpy(), index=rid_to_int(f["race_id"]).to_numpy())
    ws = pd.to_numeric(cond["wind_speed"], errors="coerce")
    use_k = cond["wind_direction"].isna() & (ws > 0) & cond["race_id"].isin(fill.index)
    cond.loc[use_k, "wind_direction"] = cond.loc[use_k, "race_id"].map(fill)
    return cond, offset.where(~use_k, 0.0)


def load_main(src: Path = D) -> pd.DataFrame:
    races = read("races", src)
    ent = read("entries", src)
    exh = read("exhibition", src)
    cond = read("conditions", src)
    res = read("results", src)
    st = read("start_timings", src)
    races["race_date"] = pd.to_datetime(races["race_date"])
    races = races[races["race_date"] > KB_END]
    df = ent.merge(races, on="race_id", how="inner")
    df = df.merge(exh[["race_id", "boat_number", "exhibition_time", "is_absent"]]
                  .rename(columns={"is_absent": "exh_absent"}),
                  on=["race_id", "boat_number"], how="left")
    cond, offset = main_wind(cond, load_wind_basis())
    enc = encode_race_level(cond, "weather", "wind_direction", "wind_speed", "is_final_day",
                            wind_offset=offset)
    enc["round"] = cond["race_stage"].map(round_from_stage)
    enc["round_v1"] = cond["race_stage"].map(round_from_stage_v1)
    df = df.merge(cond[["race_id", "wind_speed", "wave_height", "series_day"]],
                  on="race_id", how="left").merge(enc, on="race_id", how="left")
    df = df.merge(st[["race_id", "boat_number", "start_timing", "is_flying", "is_late_start"]],
                  on=["race_id", "boat_number"], how="left")
    df = df.merge(res, on="race_id", how="left")
    # rank1..rank6 は「その着の艇番」
    fr = pd.Series(np.nan, index=df.index)
    for k in range(1, 7):
        fr = fr.where(df[f"rank{k}"] != df["boat_number"], k)
    has_res = (df["rank1"].notna() & ~_bool(df["is_cancelled"]) & ~_bool(df["is_no_race"])
               & ~races_cancelled(df))
    absent = _bool(df["is_absent"]) | _bool(df["exh_absent"])
    bad = set(df.loc[absent | ~has_res, "race_id"])
    out = pd.DataFrame({
        "race_id": df["race_id"], "race_date": df["race_date"],
        "venue_code": df["venue_code"], "race_number": df["race_number"],
        "boat_number": df["boat_number"], "racer_id": df["racer_id"],
        "cls": df["grade"], "age": df["age"], "branch": df["branch"],
        "weight": df["weight_kg"], "nat_win": df["win_rate"],
        "nat_2": df["global_2rate"], "loc_win": df["local_win_rate"],
        "loc_2": df["local_2rate"], "motor_2": df["motor_2rate"],
        "boat_2": df["boat_2rate"], "exh_time": df["exhibition_time"],
        "wind_speed": df["wind_speed"], "wave_height": df["wave_height"],
        "grade": df["race_grade"].where(df["race_grade"].isin(GRADES)),
        "series_day": df["series_day"],
        "weather_code": df["weather_code"], "wind_x": df["wind_x"], "wind_y": df["wind_y"],
        "round": df["round"], "round_v1": df["round_v1"], "is_final_day_num": df["is_final_day_num"],
        "finish_rank": fr,
        "st_result": df["start_timing"], "is_flying": _bool(df["is_flying"]),
        "is_late": _bool(df["is_late_start"]),
    })
    out["race_ok"] = ~out["race_id"].isin(bad)
    return out


def races_cancelled(df: pd.DataFrame) -> pd.Series:
    """races.cancellation_status が入っている（中止・順延）レース。"""
    if "cancellation_status" not in df.columns:
        return pd.Series(False, index=df.index)
    return df["cancellation_status"].notna() & (df["cancellation_status"].astype(str) != "")


def attach_grade_from_series(df: pd.DataFrame, series: pd.DataFrame) -> pd.DataFrame:
    """グレードが無いレースを race_series の期間（会場・開始日〜終了日）で補う。"""
    s = series.dropna(subset=["grade"]).copy()
    s["start_date"] = pd.to_datetime(s["start_date"])
    s["end_date"] = pd.to_datetime(s["end_date"])
    keys = df[["venue_code", "race_date"]].drop_duplicates()
    m = keys.merge(s[["venue_code", "start_date", "end_date", "grade"]], on="venue_code")
    m = m[(m["race_date"] >= m["start_date"]) & (m["race_date"] <= m["end_date"])]
    m = m.drop_duplicates(["venue_code", "race_date"])
    out = df.merge(m[["venue_code", "race_date", "grade"]].rename(columns={"grade": "grade_series"}),
                   on=["venue_code", "race_date"], how="left")
    g = out["grade"].astype(object).where(out["grade"].notna(), out["grade_series"])
    out["grade"] = g.where(g.isin(GRADES), None)
    return out.drop(columns=["grade_series"])


def series_day_from_series(df: pd.DataFrame, series: pd.DataFrame) -> pd.DataFrame:
    """節の日目・最終日を race_series（会場・開始日〜終了日）から導く。朝の初期化は race_conditions の
    series_day・is_final_day を書かないので、出走表の時点の値としてはこれを使う。節が重なる日は開始日が
    新しい方。節が無ければ NaN。"""
    s = series[["venue_code", "start_date", "end_date"]].copy()
    s["start_date"] = pd.to_datetime(s["start_date"])
    s["end_date"] = pd.to_datetime(s["end_date"])
    keys = df[["venue_code", "race_date"]].drop_duplicates()
    m = keys.merge(s, on="venue_code")
    m = m[(m["race_date"] >= m["start_date"]) & (m["race_date"] <= m["end_date"])]
    m = m.sort_values("start_date", ascending=False).drop_duplicates(["venue_code", "race_date"])
    m["series_day"] = ((m["race_date"] - m["start_date"]).dt.days + 1).astype("float32")
    m["is_final_day_num"] = (m["race_date"] == m["end_date"]).astype("float32")
    out = df.drop(columns=["series_day", "is_final_day_num"], errors="ignore")
    return out.merge(m[["venue_code", "race_date", "series_day", "is_final_day_num"]],
                     on=["venue_code", "race_date"], how="left")


# ---------------------------------------------------------------- 選手の履歴（日単位でずらす）
def _rolling_before(df: pd.DataFrame, col: str, min_periods: int, how: str) -> pd.Series:
    """その走より前の HISTORY_WINDOW 走の集計（df は racer_id・日付・R番号順）。"""
    prev = df.groupby("racer_id", sort=False)[col].shift(1)
    roll = prev.groupby(df["racer_id"], sort=False).rolling(HISTORY_WINDOW, min_periods=min_periods)
    r = roll.mean() if how == "mean" else roll.count()
    return r.reset_index(level=0, drop=True).sort_index()


def _first_of_day(df: pd.DataFrame, s: pd.Series) -> pd.Series:
    """その日の最初の走の値を、同じ日の全走に配る（＝前日までの走だけの集計）。
    transform("first") は NaN を飛ばして2走目以降の値（当日1走目の結果を含む）を配るので使わない。
    最初の走が NaN（min_periods に届かない）なら、その日は全走 NaN のまま"""
    keys = [df["racer_id"], df["race_date"]]
    first = s.where(df.groupby(keys, sort=False).cumcount() == 0)
    return first.groupby(keys, sort=False).transform("max")


def add_history(df: pd.DataFrame) -> pd.DataFrame:
    """過去 ST の平均・本数と直近成績。必要な列: racer_id, race_date, race_number, race_id,
    finish_rank, st_result, is_flying, is_late。"""
    df = df.sort_values(["racer_id", "race_date", "race_number", "race_id"]).reset_index(drop=True)
    st_ok = df["st_result"].where(~df["is_flying"].astype(bool) & ~df["is_late"].astype(bool))
    work = pd.DataFrame({"racer_id": df["racer_id"], "race_date": df["race_date"],
                         "_st": pd.to_numeric(st_ok, errors="coerce")})
    fr = df["finish_rank"]
    work["_win"] = np.where(fr.notna(), (fr == 1).astype(float), np.nan)
    work["_top3"] = np.where(fr.notna(), (fr <= 3).astype(float), np.nan)
    for name, col, mp, how in (("st_mean30", "_st", 3, "mean"), ("st_n", "_st", 1, "count"),
                               ("recent_win30", "_win", 5, "mean"),
                               ("recent_top3_30", "_top3", 5, "mean")):
        df[name] = _first_of_day(work, _rolling_before(work, col, mp, how)).astype("float32")
    return df


def profile_as_of_previous_day(df: pd.DataFrame) -> pd.DataFrame:
    """体重・支部を「前日までに分かっている最後の値」にする（df は racer_id・日付・R番号順）。
    朝の初期化は当日の体重・支部を書かない（発走60分前に入る）ので、当日の値も同じ日の前の走の値も使わない。"""
    first = df.groupby([df["racer_id"], df["race_date"]], sort=False).cumcount() == 0
    keys = [df["racer_id"], df["race_date"]]
    for c in ("weight", "branch"):
        prev = df.groupby("racer_id", sort=False)[c].shift(1)
        prev = prev.groupby(df["racer_id"], sort=False).ffill()
        df[c] = prev.where(first).groupby(keys, sort=False).ffill()
    return df


def make_branch_map(branch: pd.Series) -> dict[str, int]:
    """支部の文字列 → 番号（文字列の順。今までの astype("category").cat.codes と同じ番号）。
    学習時に作って categorical_maps.json に保存し、日次の特徴量ジョブはこの表で符号化する。"""
    return {b: i for i, b in enumerate(sorted(branch.dropna().astype(str).unique()))}


def encode_branch(branch: pd.Series, branch_map: dict[str, int]) -> pd.Series:
    """表に無い支部は NaN（学習で見ていない値を既存の番号に寄せない）。"""
    return branch.map(branch_map).astype("float32")


# ---------------------------------------------------------------- レース内の相対値・ラベル
def add_relative(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["race_date", "race_id", "boat_number"]).reset_index(drop=True)
    grp = df.groupby("race_id", sort=False)
    for c, asc in (("nat_win", False), ("loc_win", False), ("motor_2", False),
                   ("boat_2", False), ("exh_time", True), ("st_mean30", True),
                   ("recent_win30", False)):
        df[f"{c}_diff"] = (df[c] - grp[c].transform("mean")).astype("float32")
        df[f"{c}_rank"] = grp[c].rank(ascending=asc, method="min").astype("float32")
    b1 = df.loc[df["boat_number"] == 1, ["race_id", "cls_ord", "nat_win"]].rename(
        columns={"cls_ord": "b1_cls_ord", "nat_win": "b1_nat_win"})
    return df.merge(b1, on="race_id", how="left")


def add_labels(df: pd.DataFrame) -> pd.DataFrame:
    """1着／2着以内／3着以内のラベルと、完全レース（6艇・1着が1艇・1〜3着に返還艇なし）の印。"""
    df = df.copy()
    returned = df["is_flying"].astype(bool) | df["is_late"].astype(bool)
    fr = df["finish_rank"].where(~returned)
    returned_top3 = returned & (df["finish_rank"] <= 3)
    df["finish_rank"] = fr
    df["y_win"] = (fr == 1).astype("int8")
    df["y_top2"] = (fr <= 2).astype("int8")
    df["y_top3"] = (fr <= 3).astype("int8")
    g = df.groupby("race_id", sort=False)
    n1 = g["y_win"].transform("sum")
    nb = g["boat_number"].transform("size")
    bad = returned_top3.groupby(df["race_id"], sort=False).transform("any")
    df["race_ok"] = df["race_ok"] & (n1 == 1) & (nb == 6) & ~bad
    return df


def build_with_maps(src: Path = D, branch_map: dict[str, int] | None = None):
    """特徴量と、符号化の対応表。branch_map を渡すとその表で符号化する（日次の特徴量ジョブ）。
    渡さなければデータから作る（学習）。"""
    df = pd.concat([load_kb(src), load_main(src)], ignore_index=True)
    for c in df.columns:
        if df[c].dtype == "float64":
            df[c] = df[c].astype("float32")
    series = pd.read_csv(src / "race_series.csv")
    df = attach_grade_from_series(df, series)
    main = df["race_date"] > KB_END
    derived = series_day_from_series(df[["venue_code", "race_date"]], series)
    for c in ("series_day", "is_final_day_num"):
        df[c] = df[c].astype("float32").where(~main, derived[c].to_numpy())
    df = df.sort_values(["racer_id", "race_date", "race_number", "race_id"]).reset_index(drop=True)
    df = profile_as_of_previous_day(df)
    df = add_history(df)

    df["cls_ord"] = df["cls"].astype(object).map(CLASS_ORD).astype("float32")
    df["grade_code"] = df["grade"].map(GRADE_CODE).astype("float32")
    df["round_code"] = df["round"].map(ROUND_CODE).astype("float32")
    df["round_code_v1"] = df["round_v1"].map(ROUND_CODE).astype("float32")
    br = df["branch"].astype(object)
    df["is_local"] = np.where(br.isna(), np.nan,
                              (br == df["venue_code"].map(VENUE_PREF)).astype(float)).astype("float32")
    if branch_map is None:
        branch_map = make_branch_map(br)
    df["branch_code"] = encode_branch(br, branch_map)

    df = add_relative(df)
    df = add_labels(df)
    df = df.sort_values(["race_date", "race_id", "boat_number"]).reset_index(drop=True)
    return df, {"branch_code": branch_map}


def build(src: Path = D) -> pd.DataFrame:
    return build_with_maps(src)[0]


def complete_races(df: pd.DataFrame) -> pd.DataFrame:
    return df[df["race_ok"]].sort_values(["race_date", "race_id", "boat_number"]).reset_index(drop=True)


def main():
    df, maps = build_with_maps()
    df.to_pickle(D / "boats.pkl")
    (D / "categorical_maps.json").write_text(json.dumps(maps, ensure_ascii=False, indent=1))
    ok = df[df["race_ok"] & (df["boat_number"] == 1)]
    summary = {"rows": int(len(df)), "races": int(df["race_id"].nunique()),
               "races_ok": int(len(ok)),
               "date_range": [str(df["race_date"].min().date()), str(df["race_date"].max().date())],
               "races_ok_by_month": ok["race_date"].dt.strftime("%Y-%m").value_counts().sort_index()
               .to_dict()}
    (D / "dataset_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1))
    print(json.dumps({k: summary[k] for k in ("rows", "races", "races_ok", "date_range")},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
