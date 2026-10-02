"""BOA-271 レースごとの寄与度（B）の日次の特徴量ジョブ

今日（JST）のレースの36特徴量（出走表時点専用モデル win_racecard の入力）を analogy_race_features に書く。
推論側の Vercel の JS が、この行と直前情報8列から TreeSHAP を計算する（ADR 案（#1134「レースごとの寄与度」）、
plan「学習側の設計」）。

- 特徴量は features.build_with_maps() を読んだデータ全件にそのまま使い、今日のレースの行を選ぶ（学習と同じ関数）。
  支部の番号は、表示中の版の per_race_meta.json の対応表で付ける
- 対象: 締切（races.start_time）まで MIN_LEAD_MINUTES 分以上あり、開催中止でなく、欠場が分かっていないレース。
  6:40 の回は欠場がまだ分からない（is_absent は発走60分前に入る）ので全レースを書く。欠場が後で分かった行は消さない
- input_hash（版と36列）が同じ行は書かない。違えば上書きし、updated_at を入れる
- 対象の全レースに6艇の行がそろわなければ失敗する（書けた分は書いてから）。今日のレースが DB に無い（朝の初期化の
  遅れ）のも失敗にする

使い方（export_pool.js --daily と storage.js download-active-meta の後）: python daily_features.py
"""

from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

import db
import features as F

JST = timezone(timedelta(hours=9))
MIN_LEAD_MINUTES = 10
META = F.D / "out" / "active" / "per_race_meta.json"


def deadline(race_date: str, start_time: str | None) -> datetime | None:
    if not start_time:
        return None
    return datetime.fromisoformat(f"{race_date}T{start_time}").replace(tzinfo=JST)


def select_targets(races: list[dict], absent_race_ids: set[str], now: datetime) -> list[str]:
    """races: [{race_id, race_date, start_time, cancellation_status}]。締切まで MIN_LEAD_MINUTES 分以上、
    開催中止でない、欠場が分かっていないレース。締切時刻が無いレースは対象にしない（締切前か分からないため）。"""
    out = []
    for r in races:
        d = deadline(r["race_date"], r.get("start_time"))
        if d is None or d - now < timedelta(minutes=MIN_LEAD_MINUTES):
            continue
        if r.get("cancellation_status") == "confirmed" or r["race_id"] in absent_race_ids:
            continue
        out.append(r["race_id"])
    return sorted(out)


def input_hash(version: str, values: list) -> str:
    return hashlib.sha256(json.dumps([version, values]).encode()).hexdigest()


def _floats(a) -> list:
    return [None if not np.isfinite(v) else float(v) for v in np.asarray(a, dtype="float32").astype("float64")]


def _rid_int(race_id: str) -> int:
    return int(race_id.replace("-", ""))


def feature_rows(df: pd.DataFrame, race_ids: list[str], names: list[str], version: str) -> list[dict]:
    """対象レースの行（features は names の並びの float32 の値、欠損は None）。"""
    ids = {_rid_int(r) for r in race_ids}
    t = df[df["race_id"].isin(ids)].sort_values(["race_id", "boat_number"])
    rows = []
    for rid, b, vals in zip(t["race_id"], t["boat_number"], t[names].astype("float32").to_numpy()):
        f = _floats(vals)
        rows.append({"race_id": F.int_to_rid(rid), "boat_number": int(b), "model_version": version,
                     "features": f, "input_hash": input_hash(version, f)})
    return rows


def rows_to_write(rows: list[dict], existing: dict[tuple[str, int], str], now: datetime) -> list[dict]:
    """ハッシュが同じ行は書かない。上書きする行だけ updated_at を入れる。PostgREST のバルク upsert は行ごとに
    キーの集合がそろっていないと欠けたキーを NULL にするので、全行に updated_at のキーを持たせる。"""
    out = []
    for r in rows:
        key = (r["race_id"], r["boat_number"])
        if existing.get(key) == r["input_hash"]:
            continue
        out.append({**r, "updated_at": now.isoformat() if key in existing else None})
    return out


def missing_races(race_ids: list[str], rows: list[dict]) -> list[str]:
    n = {}
    for r in rows:
        n[r["race_id"]] = n.get(r["race_id"], 0) + 1
    return [rid for rid in race_ids if n.get(rid, 0) != 6]


def _get_all(path: str) -> list[dict]:
    out, offset = [], 0
    while True:
        page, _ = db.request("GET", f"{path}&limit=1000&offset={offset}")
        out += page
        if len(page) < 1000:
            return out
        offset += 1000


def main():
    if not META.exists():
        raise SystemExit(f"{META} がありません（storage.js download-active-meta）")
    meta = json.loads(META.read_text())
    version = meta["model_version"]
    names = meta["models"]["win_racecard"]["feature_names"]
    branch_map = meta["categorical_maps"]["branch_code"]
    now = datetime.now(JST)
    today = now.date().isoformat()

    races = _get_all(f"races?select=race_id,race_date,start_time,cancellation_status&race_date=eq.{today}"
                     "&order=race_id")
    if not races:
        raise SystemExit(f"{today} のレースが DB にありません（朝の初期化の遅れ）")
    absent = {e["race_id"] for e in _get_all(
        f"race_entries?select=race_id&is_absent=is.true&race_id=like.{today}*&order=race_id")}
    targets = select_targets(races, absent, now)

    df, _ = F.build_with_maps(F.D, branch_map=branch_map)
    rows = feature_rows(df, targets, names, version)
    existing = {(e["race_id"], e["boat_number"]): e["input_hash"] for e in _get_all(
        f"analogy_race_features?select=race_id,boat_number,input_hash&race_id=like.{today}*&order=race_id")}
    write = rows_to_write(rows, existing, now)
    for i in range(0, len(write), db.BATCH):
        db.request("POST", "analogy_race_features?on_conflict=race_id,boat_number", write[i:i + db.BATCH],
                   prefer="resolution=merge-duplicates,return=minimal")
    unknown = sorted(set(df.loc[df["race_id"].isin({_rid_int(r) for r in targets}),
                                "branch"].dropna().astype(str)) - set(branch_map))
    missing = missing_races(targets, rows)
    summary = {"date": today, "model_version": version, "races": len(races), "targets": len(targets),
               "absent_races": len(absent), "rows": len(rows), "written": len(write),
               "overwritten": sum(1 for r in write if r["updated_at"]), "missing_races": missing,
               "unknown_branches": unknown}
    print(json.dumps(summary, ensure_ascii=False))
    (F.D / "out" / "daily_features_summary.json").write_text(json.dumps(summary, ensure_ascii=False))
    if missing:
        sys.exit(f"特徴量の行がそろわないレースがある: {missing[:20]}（全{len(missing)}件）")


if __name__ == "__main__":
    main()
