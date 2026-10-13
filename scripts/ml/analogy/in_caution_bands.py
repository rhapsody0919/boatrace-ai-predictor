"""BOA-822 イン崩れ注意度: 日×ラウンド×勝率差の帯ごとの件数を in_caution_gap_band_daily に書く（ADR-0095）

完全レース（features.py の race_ok と add_labels。欠場・返還・不成立・中止なし、1着が1艇、1〜3着に返還艇なし）の
1号艇について、勝率差（1号艇の全国勝率 − 2〜6号艇の最高の全国勝率、1/100 の整数）の帯とラウンドを付け、
日ごとに件数 n と1号艇が1着を逃した数 non_win を数える。1号艇の F・L は「1着を逃した」。
統計検証 round4（scripts/analysis/in-collapse-caution/round4/r4.py の B05r）と同じ作り方。

- 帯 = clamp(floor(勝率差 / 50), bandMin, bandMax)（src/data/inCautionConfig.json）。勝率が無い（NULL）艇は
  最大を取るときに外す。勝率 0.00 は勝率として扱う（新人は 0.00 で入る）。1号艇か2〜6号艇の全部の勝率が無い
  レースは数えない
- ラウンド: features.round_from_stage（本体）・round_from_kb_kind（長期）の junyu・yusho はそのまま、ほかは other
- 書き方: 実行の開始時刻を computed_at に入れて upsert → 窓の中の computed_at が開始時刻より古い行を DELETE
  （件数が0になったセルを消す。CHECK n > 0 で0の行は書けない。full も先に全部消さない。plan §2・M1）
- 窓: 既定は対象日の14日前〜前日（結果の訂正・遅れて入った結果を拾う）。--full は inCautionConfig.json の from〜前日
- JST 04:30〜23:00 は --force が無ければ書かずに失敗する（日中に表を書き換えると、朝の生成と /today が食い違う）

使い方（export_pool.js の後）:
  python in_caution_bands.py                 # 直近14日（本体の CSV だけ読む）
  python in_caution_bands.py --full          # 全期間（長期の CSV も読む）
  python in_caution_bands.py --dry-run       # 書かずに件数だけ出す（時刻の制限なし）
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

import db
import features as F

CONFIG_PATH = F.ROOT / "src" / "data" / "inCautionConfig.json"
TABLE = "in_caution_gap_band_daily"
WINDOW_DAYS = 14
JST = ZoneInfo("Asia/Tokyo")
QUIET_FROM = time(4, 30)   # この時刻〜QUIET_TO（JST）は書かない
QUIET_TO = time(23, 0)


def load_config(path: Path = CONFIG_PATH) -> dict:
    # 無ければ FileNotFoundError で落ちる（workflow が Slack に出す）
    return json.loads(path.read_text())


def gap_band(gap_cents, cfg: dict):
    """勝率差（1/100 の整数）→ 帯。NaN は NaN のまま。"""
    g = np.asarray(gap_cents, dtype="float64")
    return np.clip(np.floor(g / cfg["bandWidthCents"]), cfg["bandMin"], cfg["bandMax"])


def round_grp(round_: pd.Series) -> pd.Series:
    """4区分（yosen・junyu・yusho・other、空は None）→ 表のラウンド（junyu・yusho・other）"""
    return pd.Series(np.select([round_ == "junyu", round_ == "yusho"], ["junyu", "yusho"], "other"),
                     index=round_.index)


def boat1_rows(df: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    """add_labels の後の艇の行 → 完全レースの1号艇の行（race_date・round_grp・gap_cents・gap_band・non_win）。
    勝率差が出せないレースは入れない。"""
    ok = df[df["race_ok"]]
    # float32 の 4.81 は 4.80999994…。float64 にして100倍し、最も近い整数にする（r4.py の nat_i・top_i と同じ）
    cents = ok.set_index(["race_id", "boat_number"])["nat_win"].unstack().reindex(columns=range(1, 7))
    cents = np.round(cents.astype("float64") * 100)
    others = cents[[2, 3, 4, 5, 6]]
    top = others.max(axis=1, skipna=True)  # 全部 NaN なら NaN
    b1 = ok[ok["boat_number"] == 1].set_index("race_id")
    out = pd.DataFrame({
        "race_date": pd.to_datetime(b1["race_date"]).dt.date,
        "round_grp": round_grp(b1["round"]),
        "gap_cents": cents[1].reindex(b1.index) - top.reindex(b1.index),
        "non_win": (b1["y_win"] == 0).astype("int64"),
    }, index=b1.index)
    out = out[out["gap_cents"].notna()].copy()
    out["gap_band"] = gap_band(out["gap_cents"], cfg).astype("int64")
    return out.reset_index()


def count_bands(rows: pd.DataFrame) -> pd.DataFrame:
    """1号艇の行 → 日×ラウンド×帯の n・non_win・source（kb は長期、main は本体）"""
    if rows.empty:
        return pd.DataFrame(columns=["race_date", "round_grp", "gap_band", "n", "non_win", "source"])
    c = (rows.groupby(["race_date", "round_grp", "gap_band"], sort=True)
         .agg(n=("non_win", "size"), non_win=("non_win", "sum")).reset_index())
    c["source"] = np.where(pd.to_datetime(c["race_date"]) <= F.KB_END, "kb", "main")
    return c


def window(target: date, full: bool, cfg: dict) -> tuple[date, date]:
    """書く窓（両端を含む）。対象日（今日）のレースはまだ結果が無いので前日まで"""
    hi = target - timedelta(days=1)
    lo = date.fromisoformat(cfg["from"]) if full else target - timedelta(days=WINDOW_DAYS)
    return lo, hi


def in_quiet_hours(now: datetime) -> bool:
    t = now.astimezone(JST).time()
    return QUIET_FROM <= t < QUIET_TO


def payload(counts: pd.DataFrame, computed_at: str) -> list[dict]:
    return [{"race_date": d.isoformat(), "round_grp": r, "gap_band": int(b), "n": int(n),
             "non_win": int(k), "source": s, "computed_at": computed_at}
            for d, r, b, n, k, s in counts[["race_date", "round_grp", "gap_band", "n", "non_win", "source"]]
            .itertuples(index=False)]


def write_table(counts: pd.DataFrame, lo: date, hi: date, computed_at: str, request=db.request) -> dict:
    """upsert してから、窓の中の古い行（computed_at が今回より前）を消す。書いた行数と表の行数が合わなければ失敗"""
    rows = payload(counts, computed_at)
    if not rows:
        raise db.PostgrestError(f"{lo}〜{hi} の行が0件（結果が入っていないか、export が空）")
    for i in range(0, len(rows), db.BATCH):
        request("POST", f"{TABLE}?on_conflict=race_date,round_grp,gap_band", rows[i:i + db.BATCH],
                prefer="resolution=merge-duplicates,return=minimal")
    rng = f"race_date=gte.{lo.isoformat()}&race_date=lte.{hi.isoformat()}"
    request("DELETE", f"{TABLE}?{rng}&computed_at=lt.{db.q(computed_at)}", prefer="return=minimal")
    _, h = request("HEAD", f"{TABLE}?{rng}", prefer="count=exact")
    in_table = int(h["Content-Range"].split("/")[-1])
    if in_table != len(rows):
        raise db.PostgrestError(f"{lo}〜{hi} の行数が合わない（書いた {len(rows):,} / 表 {in_table:,}）")
    return {"rows": len(rows), "n": int(counts["n"].sum()), "non_win": int(counts["non_win"].sum())}


def load(full: bool, src: Path = F.D) -> pd.DataFrame:
    parts = ([F.load_kb(src)] if full else []) + [F.load_main(src)]
    return F.add_labels(pd.concat(parts, ignore_index=True))


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true", help="全期間を書き直す")
    ap.add_argument("--force", action="store_true", help="JST 04:30〜23:00 でも書く")
    ap.add_argument("--dry-run", action="store_true", help="書かずに件数だけ出す")
    ap.add_argument("--date", help="対象日（YYYY-MM-DD、JST。省略時は今日）。窓は前日まで")
    a = ap.parse_args(argv)
    cfg = load_config()
    started = datetime.now(timezone.utc)
    if not a.dry_run and not a.force and in_quiet_hours(started):
        # 遅れて動いた日を黙って成功にしない（design-reviewer 指摘6）
        sys.exit(f"JST {started.astimezone(JST):%H:%M} は書かない時間（04:30〜23:00）。書くなら --force")
    target = date.fromisoformat(a.date) if a.date else started.astimezone(JST).date()
    lo, hi = window(target, a.full, cfg)
    rows = boat1_rows(load(a.full), cfg)
    rows = rows[(rows["race_date"] >= lo) & (rows["race_date"] <= hi)]
    counts = count_bands(rows)
    summary = {"window": [lo.isoformat(), hi.isoformat()], "full": a.full, "rows": int(len(counts)),
               "n": int(counts["n"].sum()), "non_win": int(counts["non_win"].sum()),
               "n_by_year": {str(y): int(v) for y, v in
                             counts.groupby(pd.to_datetime(counts["race_date"]).dt.year)["n"].sum().items()}}
    if not a.dry_run:
        try:
            summary["written"] = write_table(counts, lo, hi, started.isoformat())
        except db.PostgrestError as e:
            sys.exit(f"書き込み失敗: {e}")
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
