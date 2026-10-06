"""BOA-271 T1-1 優勝戦・準優勝戦の判定を広げる（事前登録 preregistration-t1.md「共通」「T1-1」、コミット 238e0bb5a）。

入力: $ANALOGY_SCRATCH/t1/t1_1_raw/*.csv（t1_1_stage_rule_fetch.mjs が本番 DB から読み取りのみで取得）
      $ANALOGY_SCRATCH/t1/t1_1_accept22.json（prep10 の取りこぼし22R。受入の判定に使う）
出力: docs/design/analogy-finder/analysis/t1/t1-1-stage-rule.json
      $ANALOGY_SCRATCH/t1/rounds.csv（他の分析が使う表。2019-04-01〜2026-10-03 の全レース）

規則の版:
  v1 = 事前登録の新しいルール
  v2 = v1 に、c・b の名前の一覧を見て1回だけ足した規則（EXTRA_RULES。無ければ v1 と同じ）
rounds.csv の round_new・category_new は最終版（v2）。
"""
from __future__ import annotations

import hashlib
import json
import bisect
import math
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

SCRATCH = Path(os.environ["ANALOGY_SCRATCH"])
RAW = SCRATCH / "t1" / "t1_1_raw"
REPO = Path(__file__).resolve().parents[3]
OUT_JSON = REPO / "docs/design/analogy-finder/analysis/t1/t1-1-stage-rule.json"
OUT_ROUNDS = SCRATCH / "t1" / "rounds.csv"
PERIOD = ("2019-04-01", "2026-10-03")
KB_END = "2025-12-02"
PREREG_COMMIT = "238e0bb5a"


# ------------------------------------------------------------------ 名前の判定
def nfkc(s) -> str | None:
    if not isinstance(s, str) or s == "":
        return None
    return unicodedata.normalize("NFKC", s)


def _has_special(s: str) -> bool:
    return any(k in s for k in ("特選", "特賞", "特別", "選抜"))


def _is_semi_old(s: str) -> bool:
    return re.search(r"準優勝?戦", s) is not None


_TAIL_RULES = [
    ("dream", lambda s: "ドリーム" in s or "DR" in s),
    ("qualifierSpecial", lambda s: "予選" in s and _has_special(s)),
    ("generalSpecial", lambda s: "一般" in s and _has_special(s)),
    ("selection", lambda s: "選抜" in s),
    ("special", _has_special),
    ("qualifier", lambda s: "予選" in s),
    ("general", lambda s: "一般" in s),
]

# 今のルール（raceStageConfig.js の RACE_STAGE_CATEGORY_RULES／features.py の _STAGE_RULES）
RULES_OLD = [
    ("semifinalQualifier", lambda s: "準々" in s or "準優進出" in s),
    ("semifinal", _is_semi_old),
    ("final", lambda s: "優勝戦" in s),
    *_TAIL_RULES,
]


def _strip_ws(s: str) -> str:
    return re.sub(r"\s", "", s)


def _final_new(s: str) -> bool:
    return (
        "優勝戦" in s
        or any(k in s for k in ("決勝戦", "王座決定戦", "賞金女王決定", "王将位決定戦"))
        or ("ファイナル" in s and "進出" not in s)
        or (_strip_ws(s).endswith("優") and "準優" not in s)
    )


# 事前登録の新しいルール（v1）
RULES_V1 = [
    ("semifinalQualifier", lambda s: "準々" in s or "準優進出" in s),
    ("semifinal", lambda s: _is_semi_old(s) or "準決" in s or "セミファイナル" in s),
    ("final", _final_new),
    *_TAIL_RULES,
]

# c・b の名前の一覧を見て1回だけ足した規則（事前登録「判定」）。v1 の結果（JSON の v1.b_c）を見て決めた。
# 各規則: (種類, 判定する関数, 規則の文, 理由)
EXTRA_RULES: list[tuple[str, object, str, str]] = [
    (
        "final_exclude",
        lambda s: "ファイナル選" in s,
        "「ファイナル選」を含む名前は優勝戦にしない（c 由来）",
        "c（新しいルールで優勝戦なのに fd12 でない）に kb『ファイナル選』1件（2019-12-24-16-12、児島。開催名『児島ファイナル2019』の初日12R。"
        "同じ節の最終日 2019-12-29 の12Rに別に『優勝戦』があり、初日の『ファイナル選抜』＝選抜戦と読める）。v1 の規則『ファイナルを含み進出を含まない』が拾った誤判定",
    ),
    (
        "final_include",
        lambda s: _strip_ws(s).endswith("優勝") and "準優" not in s,
        "空白を除いた末尾が「優勝」で「準優」を含まない名前は優勝戦（b 由来）",
        "b（fd12 なのに優勝戦にならない）に、長期の名前が6文字で切れて『〜優勝戦』の『戦』が落ちたものが並んだ"
        "（団体・優勝 9・個性派王優勝 4・ツッピー優勝 3・ダービー優勝 2・PRGT優勝・ゴールド優勝・スピード優勝・パタち杯優勝・内山信二優勝・海の安全優勝 各1、いずれも12Rで同じ日に別の優勝戦が無い）。"
        "v1 の『末尾が優』は『〜優』で切れたものしか拾わない。同じ形の名前は全期間で他に『シリーズ優勝』5（11R、GP・QC のシリーズ優勝戦）・『ツッキー優勝』3（11R、男女Ｗ優勝戦の日）・stage_kind=final の『優勝』だけで、どれも優勝戦",
    ),
]


def _final_v2(s: str) -> bool:
    for kind, test, _, _ in EXTRA_RULES:
        if kind == "final_include" and test(s):
            return True
    for kind, test, _, _ in EXTRA_RULES:
        if kind == "final_exclude" and test(s):
            return False
    return _final_new(s)


RULES_V2 = [
    RULES_V1[0],
    RULES_V1[1],
    ("final", _final_v2),
    *_TAIL_RULES,
]


def category(s_raw, rules) -> str | None:
    s = nfkc(s_raw)
    if s is None:
        return None
    return next((k for k, t in rules if t(s)), None)


CAT_ROUND = {"qualifier": "yosen", "qualifierSpecial": "yosen", "semifinal": "junyu", "final": "yusho"}
KIND_ROUND = {"qualifier": "yosen", "semifinal": "junyu", "final": "yusho", "other": "other"}
KIND_CAT = {"qualifier": "qualifier", "semifinal": "semifinal", "final": "final"}


def round_main(stage, rules) -> str | None:
    c = category(stage, rules)
    if nfkc(stage) is None:
        return None
    return CAT_ROUND.get(c, "other")


def kb_old(stage, kind) -> str | None:
    """prep10（p10_executed_check_kb.sql）の長期の round: 名前で 準々/準優進出→other、準優勝戦→junyu、優勝戦→yusho、それ以外は stage_kind。"""
    s = nfkc(stage)
    kr = KIND_ROUND.get(kind) if isinstance(kind, str) else None
    if s is None:
        return kr
    if "準優進出" in s or "準々" in s:
        return "other"
    if "準優勝戦" in s:
        return "junyu"
    if "優勝戦" in s:
        return "yusho"
    return kr


def kb_new(stage, kind, rules) -> tuple[str | None, str | None]:
    """事前登録の長期の優先: 名前が準優勝戦→準優勝戦。そうでなく名前か stage_kind が優勝戦→優勝戦。
    そうでなく stage_kind が semifinal→準優勝戦。名前が空なら stage_kind だけ。
    戻り値 (round, category)。準優・優勝戦以外の round は今と同じ（名前が 準々/準優進出 なら other、ほかは stage_kind）。
    category は準優・優勝戦以外では名前の種別（名前が空なら stage_kind の qualifier→qualifier、ほかは None）。"""
    s = nfkc(stage)
    ncat = category(stage, rules) if s is not None else None
    # 新しいルールの1（準々・準優進出→優勝戦でも準優勝戦でもない、今のまま）を stage_kind より先に当てる。
    # 事前登録の長期の優先の文だけを字面どおりに読むと stage_kind=semifinal の「準優進出戦」が準優勝戦になるが、
    # 規則1と今のルール（prep10）がどちらも「どちらでもない」なので、規則1を先にした（件数は JSON の kb_rule1_vs_kind）
    if ncat == "semifinalQualifier":
        return "other", ncat
    if ncat == "semifinal":
        return "junyu", "semifinal"
    if ncat == "final" or kind == "final":
        return "yusho", "final"
    if kind == "semifinal":
        return "junyu", "semifinal"
    kr = KIND_ROUND.get(kind) if isinstance(kind, str) else None
    if s is None:
        return kr, KIND_CAT.get(kind)
    return kr, ncat


# サイトのバッジ（getRaceStageKey）と今節の得点（seriesPoints.js classifyStage）
def badge_old(raw) -> str | None:
    if not isinstance(raw, str) or raw == "":
        return None
    if "準々" in raw or "準優進出" in raw:
        return None
    if _is_semi_old(raw):
        return "semifinal"
    if "優勝戦" in raw:
        return "final"
    return None


def badge_new(raw, rules) -> str | None:
    c = category(raw, rules)
    return c if c in ("final", "semifinal") else None


def normalize_stage_sp(stage) -> str:
    if not isinstance(stage, str) or not stage:
        return ""
    s = re.sub(r"[Ａ-Ｚａ-ｚ０-９]", lambda m: chr(ord(m.group(0)) - 0xFEE0), stage)
    s = re.sub(r"\s", "", s).replace("　", "")
    return s.upper()


def sp_excluded_old(stage) -> bool:
    s = normalize_stage_sp(stage)
    return bool(s) and ("準優" in s or "優勝戦" in s)


def sp_excluded_new(stage, rules) -> bool:
    return sp_excluded_old(stage) or badge_new(stage, rules) is not None


# ------------------------------------------------------------------ 読み込み
def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def read(name: str) -> pd.DataFrame:
    return pd.read_csv(RAW / f"{name}.csv", dtype=str, keep_default_na=False, na_values=[""])


def tf(s: pd.Series) -> pd.Series:
    return s.map(lambda v: str(v).lower() == "true" if isinstance(v, str) else False)


def wilson(x: int, n: int) -> list[float] | None:
    if n == 0:
        return None
    z = 1.959963984540054
    p = x / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(p, 4), round(c - h, 4), round(c + h, 4)]


def load():
    kb = read("kb_races")
    kb = kb[(kb.race_date >= PERIOD[0]) & (kb.race_date <= KB_END)].copy()
    vd = read("kb_venue_days")
    kb = kb.merge(vd[["venue_day_id", "is_final_day", "title"]], on="venue_day_id", how="left")
    a1 = read("kb_boats_a1").groupby("race_id").size().rename("n_a1")
    kb = kb.merge(a1, left_on="race_id", right_index=True, how="left")
    kb = pd.DataFrame({
        "race_id": kb.race_id, "race_date": kb.race_date, "venue_code": kb.venue_code.astype(int),
        "race_number": kb.race_number.astype(int), "stage_name": kb.stage, "stage_kind": kb.stage_kind,
        "held": tf(kb.has_result), "is_final_day": tf(kb.is_final_day),
        "all_a1": kb.n_a1.fillna(0).astype(int).eq(6), "title": kb.title, "source": "kb",
    })

    mr = read("races")
    mr = mr[(mr.race_date >= "2025-12-03") & (mr.race_date <= PERIOD[1])].copy()
    cond = read("conditions")
    res = read("results")
    mr = mr.merge(cond, on="race_id", how="left").merge(res, on="race_id", how="left")
    a1m = read("entries_a1").groupby("race_id").size().rename("n_a1")
    mr = mr.merge(a1m, left_on="race_id", right_index=True, how="left")
    held = (
        mr.cancellation_status.fillna("").eq("")
        & mr.rank1.notna()
        & ~tf(mr.is_cancelled) & ~tf(mr.is_no_race)
        & mr.race_status.fillna("normal").ne("no_race")
    )
    main = pd.DataFrame({
        "race_id": mr.race_id, "race_date": mr.race_date, "venue_code": mr.venue_code.astype(int),
        "race_number": mr.race_number.astype(int), "stage_name": mr.race_stage, "stage_kind": None,
        "held": held, "is_final_day": tf(mr.is_final_day),
        "all_a1": mr.n_a1.fillna(0).astype(int).eq(6), "title": mr.race_title, "source": "main",
    })
    rs = read("race_series")
    rs["venue_code"] = rs.venue_code.astype(int)
    return pd.concat([kb, main], ignore_index=True), rs


def add_fd12(df: pd.DataFrame, rs: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    ends = set(zip(rs.venue_code, rs.end_date))
    is12 = df.race_number.eq(12)
    end_hit = pd.Series([(v, d) in ends for v, d in zip(df.venue_code, df.race_date)], index=df.index)
    # 定義1: 最終日（長期 is_final_day、本体は race_series.end_date か race_conditions.is_final_day＝prep10 と同じ）の12R
    df["fd12_end"] = is12 & ((df.source.eq("kb") & df.is_final_day) | (df.source.eq("main") & (end_hit | df.is_final_day)))
    df["fd12_end_seriesonly"] = is12 & end_hit  # 参考: 両方とも race_series.end_date だけで決めた版
    # 定義2: 節で実際に走った最後の日の12R。節＝同じ会場で開始日がそのレースの日以前で最も遅い race_series
    #        （順延で end_date を越えても次の節の開始日までは同じ節に入る）
    df = df.sort_values(["venue_code", "race_date", "race_number"]).reset_index(drop=True)
    rs2 = rs.sort_values(["venue_code", "start_date"])
    keys = pd.Series(None, index=df.index, dtype=object)
    ends_of = {}
    for v, g in df.groupby("venue_code", sort=False):
        rv = rs2[rs2.venue_code == v]
        starts = rv.start_date.tolist()
        for st, en in zip(rv.start_date, rv.end_date):
            ends_of[f"{v}:{st}"] = en
        idx = [bisect.bisect_right(starts, d) - 1 for d in g.race_date]
        keys.loc[g.index] = [f"{v}:{starts[i]}" if i >= 0 else None for i in idx]
    df["series_key"] = keys
    # 期間の終わり（2026-10-03）より後に end_date がある節は、まだ終わっていないので最後の日を決めない
    unfinished = {k for k, en in ends_of.items() if en > PERIOD[1]}
    last = df[df.held & df.series_key.notna() & ~df.series_key.isin(unfinished)].groupby("series_key").race_date.max()
    df["series_last_held"] = df.series_key.map(last)
    df["fd12_last"] = df.race_number.eq(12) & df.held & df.race_date.eq(df.series_last_held)
    info = {
        "races_without_series": int(df.series_key.isna().sum()),
        "held_races_without_series": int((df.series_key.isna() & df.held).sum()),
        "series_with_held_races_finished": int(last.shape[0]),
        "unfinished_series_excluded": len(unfinished),
        "held_races_in_unfinished_series": int((df.held & df.series_key.isin(unfinished)).sum()),
    }
    return df, info


# ------------------------------------------------------------------ 集計
def apply_rules(df: pd.DataFrame, rules, tag: str) -> pd.DataFrame:
    names = df.stage_name.dropna().unique()
    cat = {n: category(n, rules) for n in names}
    out = []
    for src, name, kind in zip(df.source, df.stage_name, df.stage_kind):
        if src == "kb":
            out.append(kb_new(name, kind, rules))
        else:
            c = cat.get(name) if isinstance(name, str) else None
            r = None if nfkc(name) is None else CAT_ROUND.get(c, "other")
            out.append((r, c))
    df[f"round_{tag}"] = [o[0] for o in out]
    df[f"cat_{tag}"] = [o[1] for o in out]
    return df


def name_table(sub: pd.DataFrame, extra_cols=(), limit=None) -> list[dict]:
    if sub.empty:
        return []
    g = sub.assign(nm=sub.stage_name.fillna("(空)"), kind=sub.stage_kind.fillna("-"))
    keys = ["source", "nm", "kind", *extra_cols]
    agg = g.groupby(keys, dropna=False).agg(
        n=("race_id", "size"), n_all_a1=("all_a1", "sum"),
        race_numbers=("race_number", lambda s: ",".join(str(x) for x in sorted(set(s)))),
        example=("race_id", "max"),
    ).reset_index().sort_values(["n", "nm"], ascending=[False, True])
    rows = [
        {"source": r.source, "stage_name": r.nm, "stage_kind": r.kind,
         **{c: getattr(r, c) for c in extra_cols},
         "n": int(r.n), "n_all_a1": int(r.n_all_a1), "race_numbers": r.race_numbers, "example_race_id": r.example}
        for r in agg.itertuples()
    ]
    return rows[:limit] if limit else rows


def counts_ab(h: pd.DataFrame, col: str) -> dict:
    out = {}
    for scope, sub in (("all", h), ("all_a1", h[h.all_a1])):
        out[scope] = {
            src: {k: int((s[col] == r).sum()) for k, r in (("final", "yusho"), ("semifinal", "junyu"))}
            for src, s in (("kb", sub[sub.source == "kb"]), ("main", sub[sub.source == "main"]), ("total", sub))
        }
    return out


def fd12_block(h: pd.DataFrame, tag: str) -> dict:
    out = {}
    fin = h[f"round_{tag}"].eq("yusho")
    for fd in ("fd12_end", "fd12_last"):
        blk = {}
        for scope, m in (("all", pd.Series(True, index=h.index)), ("all_a1", h.all_a1)):
            s = {}
            for src in ("kb", "main", "total"):
                ms = m if src == "total" else (m & h.source.eq(src))
                n_fd = int((ms & h[fd]).sum())
                miss = int((ms & h[fd] & ~fin).sum())
                fp = int((ms & fin & ~h[fd]).sum())
                s[src] = {"fd12": n_fd, "fd12_and_final": n_fd - miss, "fd12_not_final": miss,
                          "miss_rate_wilson95": wilson(miss, n_fd), "final_not_fd12": fp}
            blk[scope] = s
        blk["b_missed_names"] = name_table(h[h[fd] & ~fin])
        blk["c_final_not_fd12_names"] = name_table(h[fin & ~h[fd]])
        out[fd] = blk
    return out


def main_block_d(df: pd.DataFrame, rules) -> dict:
    m = df[df.source == "main"]
    out = {}
    for scope, sub in (("all_races", m), ("held", m[m.held])):
        bo = sub.stage_name.map(badge_old)
        bn = sub.stage_name.map(lambda s: badge_new(s, rules))
        eo = sub.stage_name.map(sp_excluded_old)
        en = sub.stage_name.map(lambda s: sp_excluded_new(s, rules))
        chg_b = bo.fillna("-").ne(bn.fillna("-"))
        chg_e = eo.ne(en)
        t = sub.assign(badge_old=bo.fillna("-"), badge_new=bn.fillna("-"), sp_old=eo, sp_new=en)
        out[scope] = {
            "n_races": int(len(sub)),
            "badge_changed": int(chg_b.sum()),
            "badge_changed_all_a1": int((chg_b & sub.all_a1).sum()),
            "series_points_excluded_changed": int(chg_e.sum()),
            "series_points_excluded_changed_all_a1": int((chg_e & sub.all_a1).sum()),
            "either_changed": int((chg_b | chg_e).sum()),
            "badge_changes_by_name": name_table(t[chg_b], extra_cols=("badge_old", "badge_new")),
            "series_points_changes_by_name": name_table(t[chg_e], extra_cols=("sp_old", "sp_new")),
        }
    return out


def block_e(h: pd.DataFrame, rules) -> dict:
    kb = h[h.source == "kb"]
    named = kb.stage_name.map(nfkc).notna()
    ncat = kb.stage_name.map(lambda s: category(s, rules))
    nround = ncat.map(lambda c: {"final": "final", "semifinal": "semifinal"}.get(c, "other"))
    kround = kb.stage_kind.map(lambda k: {"final": "final", "semifinal": "semifinal"}.get(k, "other"))
    dis = named & nround.ne(kround)
    t = kb.assign(name_judgement=nround, kind_judgement=kround)
    return {
        "kb_held": int(len(kb)), "kb_held_named": int(named.sum()), "kb_held_unnamed": int((~named).sum()),
        "disagree": int(dis.sum()), "disagree_all_a1": int((dis & kb.all_a1).sum()),
        "by_pair": {f"name={a}/kind={b}": int(n) for (a, b), n in t[dis].groupby(["name_judgement", "kind_judgement"]).size().items()},
        "names": name_table(t[dis], extra_cols=("name_judgement",)),
    }


def block_a(h: pd.DataFrame, tag: str) -> dict:
    chg = h.round_old.fillna("-").ne(h[f"round_{tag}"].fillna("-"))
    chg_fs = chg & (h.round_old.isin(["yusho", "junyu"]) | h[f"round_{tag}"].isin(["yusho", "junyu"]))
    t = h.assign(round_old_=h.round_old.fillna("-"), round_new_=h[f"round_{tag}"].fillna("-"))
    return {
        "old": counts_ab(h, "round_old"),
        "new": counts_ab(h, f"round_{tag}"),
        "changed_final_or_semifinal": int(chg_fs.sum()),
        "changed_final_or_semifinal_all_a1": int((chg_fs & h.all_a1).sum()),
        "changed_names": name_table(t[chg_fs], extra_cols=("round_old_", "round_new_")),
    }


def acceptance(df: pd.DataFrame, tag: str) -> dict:
    acc = json.loads((SCRATCH / "t1" / "t1_1_accept22.json").read_text())
    ids = [x.split("|")[0] for x in acc["kb"] + acc["main"]]
    sub = df.set_index("race_id").loc[ids]
    ok = sub[f"round_{tag}"].eq("yusho")
    return {
        "n": len(ids), "final_under_new": int(ok.sum()), "passed": bool(ok.all()),
        "not_final": [{"race_id": i, "stage_name": sub.loc[i, "stage_name"], "round": sub.loc[i, f"round_{tag}"]}
                      for i in ok[~ok].index],
    }


def main():
    df, rs = load()
    df, fd_info = add_fd12(df, rs)
    df["round_old"] = [kb_old(n, k) if s == "kb" else round_main(n, RULES_OLD)
                       for s, n, k in zip(df.source, df.stage_name, df.stage_kind)]
    df["round_kind_only"] = [KIND_ROUND.get(k) if s == "kb" and isinstance(k, str) else None
                             for s, k in zip(df.source, df.stage_kind)]
    df = apply_rules(df, RULES_V1, "v1")
    has_extra = bool(EXTRA_RULES)
    df = apply_rules(df, RULES_V2, "v2")
    h = df[df.held].copy()

    res = {
        "analysis": "T1-1 優勝戦・準優勝戦の判定を広げる",
        "preregistration": "docs/design/analogy-finder/analysis/t1/preregistration-t1.md「共通」「T1-1」",
        "preregistration_commit": PREREG_COMMIT,
        "period": list(PERIOD),
        "data_version": "本番 Supabase（読み取りのみ）。取得時刻・行数・最大日・sha256 は inputs",
        "in_sample_note": "モデルを評価しない名前の判定の数え上げ（全件・in-sample）",
        "population": "a〜c・e は開催されたレース（長期 has_result、本体 cancellation_status 空・race_results.rank1 あり・is_cancelled/is_no_race でない・race_status≠no_race）。d は本体の全レースと開催分の両方。all_a1＝出走表の級別が A1 の艇が6艇（長期 kb_archive_boats.class、本体 race_entries.grade）",
        "inputs": {},
        "rules": {
            "old": "本体: raceStageConfig.js の RACE_STAGE_CATEGORY_RULES（NFKC）→ features.py の round。長期: prep10（p10_executed_check_kb.sql）と同じく、名前で 準々/準優進出→other、準優勝戦→junyu、優勝戦→yusho、それ以外は stage_kind",
            "v1": "事前登録の新しいルール。準々/準優進出→どちらでもない。/準優勝?戦/・準決・セミファイナル→準優勝戦。優勝戦・決勝戦・王座決定戦・賞金女王決定・王将位決定戦・（ファイナル かつ 進出なし）・（空白を除いた末尾が優 かつ 準優なし）→優勝戦。長期は 名前が準優勝戦→準優勝戦、名前か stage_kind が優勝戦→優勝戦、stage_kind が semifinal→準優勝戦",
            "v2_extra": [{"kind": k, "rule": t, "reason": r} for k, _, t, r in EXTRA_RULES],
            "v2_is_same_as_v1": not has_extra,
            "kind_only_reference": "features.py の load_kb は長期の round を stage_kind だけで決める（round_from_kb_kind）。参考に件数を出す",
        },
        "fd12_definitions": {
            "fd12_end": "長期: kb_archive_venue_days.is_final_day の日の12R。本体: race_series.end_date か race_conditions.is_final_day の日の12R（prep10 と同じ）",
            "fd12_last": "節（同じ会場で開始日がその日以前で最も遅い race_series）で開催されたレースのある最後の日の12R（開催されたもの）",
            "fd12_end_seriesonly": "参考: 長期・本体とも race_series.end_date の日の12R",
            **fd_info,
        },
        "counts": {
            "races_all": {s: int((df.source == s).sum()) for s in ("kb", "main")},
            "races_held": {s: int((h.source == s).sum()) for s in ("kb", "main")},
            "held_all_a1": {s: int(((h.source == s) & h.all_a1).sum()) for s in ("kb", "main")},
            "fd12_end_vs_last": {
                "both": int((h.fd12_end & h.fd12_last).sum()),
                "end_only": int((h.fd12_end & ~h.fd12_last).sum()),
                "last_only": int((~h.fd12_end & h.fd12_last).sum()),
                "end_seriesonly": int(h.fd12_end_seriesonly.sum()),
            },
            "kind_only_final_kb": int(((h.source == "kb") & h.round_kind_only.eq("yusho")).sum()),
            "kind_only_semifinal_kb": int(((h.source == "kb") & h.round_kind_only.eq("junyu")).sum()),
        },
        "kb_rule1_vs_kind": {
            "note": "長期で名前が 準々/準優進出（規則1＝どちらでもない）なのに stage_kind が semifinal/final のレース。規則1を先に当てたので round は other。事前登録の長期の優先の文を字面どおりに読むと stage_kind に従い junyu/yusho になる（features.py の round_from_kb_kind も junyu/yusho）",
            "names": name_table(h[(h.source == "kb") & h.cat_v1.eq("semifinalQualifier") & h.stage_kind.isin(["semifinal", "final"])]),
        },
    }
    for f in sorted(RAW.glob("*.csv")):
        res["inputs"][f.name] = {"sha256": sha256_file(f)}
    man = json.loads((SCRATCH / "t1" / "t1_1_fetch_manifest.json").read_text())
    for k, v in man["tables"].items():
        res["inputs"].setdefault(f"{k}.csv", {}).update(v)
    res["inputs"]["t1_1_accept22.json"] = {"sha256": sha256_file(SCRATCH / "t1" / "t1_1_accept22.json")}

    res["old_rule_fd12"] = fd12_block(h, "old")
    for tag, rules in (("v1", RULES_V1), ("v2", RULES_V2)):
        if tag == "v2" and not has_extra:
            continue
        res[tag] = {
            "a": block_a(h, tag),
            "b_c": fd12_block(h, tag),
            "d": main_block_d(df, rules),
            "e": block_e(h, rules),
            "acceptance_22R": acceptance(df, tag),
        }

    res["judgement"] = {
        "acceptance": "受入: prep10 の22R（6艇ともA1で今のルールが取りこぼしていたもの）が v1・v2 とも全件優勝戦（v1.acceptance_22R・v2.acceptance_22R）",
        "c_rule": "c に中身が優勝戦でない名前『ファイナル選』1件（児島ファイナル2019 の初日12R、ファイナル選抜）→ 除く規則を1回足した（rules.v2_extra）。v2 の c に残るのは11Rの優勝戦（同じ日の12Rに別の優勝戦がある GP・QC のシリーズ優勝戦、男女Ｗ優勝戦等）だけで、中身が優勝戦でない名前は残らない",
        "b_rule": "b に長期の名前が切れた『〜優勝』（戦が落ちたもの）が10名前・25件（v1.b_c.fd12_end.b_missed_names）→ 末尾『優勝』を優勝戦にする規則を1回足した（rules.v2_extra）",
        "b_remaining_other_kind": "v2 の b（fd12_end）に残るのは、同じ日の11Rに優勝戦があって12Rが選抜戦の節（大村・若松の 特別選抜戦A 系 25件）と 発祥地N選抜 4件（大村、選抜戦）。別の種別なので残す。fd12_last だけに出るもの（準優勝戦・一般戦・予選特選・DR 等）は節が途中で打ち切られ優勝戦が無かった日",
        "user_return": [
            {"stage_name": "関ヶ原決戦", "race_id": "2023-07-30-06-12", "n": 1, "context": "浜名湖『MB大賞天下無双!群雄割拠浜名湖の陣地区対抗戦』の最終日（6日目、is_final_day）12R。前日の11R・12Rが準優勝戦、当日に別の優勝戦なし。節の流れからは優勝戦に当たるが、名前（決戦）だけでは決められないので規則は足していない"},
            {"stage_name": "オオムラGP", "race_id": "2020-01-01-24-12", "n": 1, "context": "大村『第2回オオムラグランプリ日本財団会長杯』の最終日（4日目）12R。前日の11R・12Rが『A組トライア』、当日11Rが『B組優勝戦』。A組の優勝戦に当たると読めるが、名前（GP）だけでは決められないので規則は足していない"},
            {"stage_name": "準優進出戦 ほか（長期 stage_kind=semifinal）", "n": 1276, "context": "事前登録の規則1（準々・準優進出→どちらでもない、今のまま）と、長期の優先の文（stage_kind が semifinal なら準優勝戦）が食い違う。規則1を先にして other にした（kb_rule1_vs_kind）。features.py の今の学習（stage_kind だけ）は junyu にしている。6艇ともA1 は0件"},
        ],
    }

    # 一致検査用の固定の文字列（事前登録: a〜c・e に出た名前すべて＋境目の例）と v2 の答え。pytest に入れるのは実装側
    final = "v2" if has_extra else "v1"
    seen = set()
    for blk in (res[final]["a"]["changed_names"], res[final]["e"]["names"], res["v1"]["a"]["changed_names"], res["v1"]["e"]["names"]):
        seen.update(x["stage_name"] for x in blk)
    for tag in ("v1", final):
        for fd in ("fd12_end", "fd12_last"):
            for k in ("b_missed_names", "c_final_not_fd12_names"):
                seen.update(x["stage_name"] for x in res[tag]["b_c"][fd][k])
    seen.discard("(空)")
    boundary = ["準優", "Ｗ準優戦前半", "ファイナル進出戦", "ホットマン優", "準決勝戦", "準々決勝戦", "セミファイナル"]
    rules_final = RULES_V2 if has_extra else RULES_V1
    res["consistency_check_strings"] = {
        "note": "JS（raceStageConfig.js）と Python（features.py）が同じ答えになることを tests/test_features.py で固定するための一覧。expected は最終版のルールで NFKC 後に当てた種別キー（名前だけの判定。長期の stage_kind との組み合わせは含まない）",
        "cases": [{"stage": n, "expected_category": category(n, rules_final), "boundary_example": n in boundary}
                  for n in sorted(seen | set(boundary))],
    }

    # rounds.csv（最終版 = v2）
    rounds = df.sort_values("race_id")[["race_id", "source", "round_old", "round_v2", "cat_v2", "stage_name", "stage_kind"]]
    rounds = rounds.rename(columns={"round_v2": "round_new", "cat_v2": "category_new"})
    rounds.to_csv(OUT_ROUNDS, index=False)
    res["rounds_csv"] = {
        "path": "$ANALOGY_SCRATCH/t1/rounds.csv", "rows": int(len(rounds)),
        "rows_by_source": {s: int((rounds.source == s).sum()) for s in ("kb", "main")},
        "sha256": sha256_file(OUT_ROUNDS),
        "columns": list(rounds.columns),
        "note": "全レース（開催されなかったものを含む）。round_*: yosen/junyu/yusho/other（名前も stage_kind も無ければ空）。category_new: raceStageConfig の種別キー（v2 のルール）。長期で準優・優勝戦以外は名前の種別、名前が空なら stage_kind の qualifier→qualifier・ほかは空",
        "round_new_counts": {f"{s}:{r}": int(n) for (s, r), n in rounds.fillna({"round_new": "(空)"}).groupby(["source", "round_new"]).size().items()},
    }
    res["generated_at"] = datetime.now(timezone.utc).isoformat()
    dump = lambda o: json.dumps(o, ensure_ascii=False, indent=1, default=lambda v: v.item() if hasattr(v, "item") else str(v))
    # content_sha256 = このキーを除いた JSON（indent=1・ensure_ascii=False）の sha256
    res["content_sha256"] = hashlib.sha256(dump(res).encode()).hexdigest()
    OUT_JSON.write_text(dump(res) + "\n")
    print(f"wrote {OUT_JSON} / {OUT_ROUNDS} ({len(rounds)} rows)", file=sys.stderr)


if __name__ == "__main__":
    main()
