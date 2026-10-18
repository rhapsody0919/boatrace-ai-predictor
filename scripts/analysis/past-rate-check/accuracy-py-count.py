"""BOA-635 検証: spec FR-1・FR-2 の式を JS を見ずに書き直し、本番の layer で数える。
使い方: python py-count.py <layersDir> <choices.json> <raceId...>  （決着は環境変数 DEC_<raceId の - を _ に> = "a-b-c"）"""
import json, os, sys
from decimal import Decimal, ROUND_HALF_UP

TECH = {"nige": "逃げ", "sashi": "差し", "makuri": "まくり", "makurizashi": "まくり差し"}
LEVEL = {1: dict(dent=5, kado=3, out=5), 2: dict(dent=8, kado=5, out=8)}

def cent(st):  # 1/100 秒の整数（十進で四捨五入。浮動小数の割れを避ける）
    return int((Decimal(repr(st)) * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))

def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)

def form_ok(f, c, lv):
    L = LEVEL[lv]; c1, c2, c3, c4, c5, c6 = c
    return {
        "flat": max(c) - min(c) <= 6,
        "wall": max(c1, c2, c3) - min(c1, c2, c3) <= 2,
        "d2": c2 - max(c1, c3) >= L["dent"],
        "d3": c3 - max(c2, c4) >= L["dent"],
        "kado": min(c1, c2, c3) - c4 >= L["kado"],
        "d1": c1 - c2 >= L["dent"],
        "dash": (c1 + c2 + c3) - (c4 + c5 + c6) >= 3 * L["out"],
    }[f]

def judge(r, typ, inp):
    """True/False、または None（分母から除く）"""
    top3 = (r["rank1"], r["rank2"], r["rank3"])
    if typ == "order":
        return (r["rank1"] == inp["first"] and r["rank2"] in inp["second"] and r["rank3"] in inp["third"]
                and len(set(top3)) == 3)
    if typ == "boat1":
        o = inp["outcome"]
        if o == "win": return r["rank1"] == 1
        if o == "top3": return 1 in top3
        return 1 not in top3
    if typ == "tenkai":
        if r["winning_technique"] is None: return None
        return r["rank1"] == inp["boat"] and r["winning_technique"] == TECH[inp["technique"]]
    if typ == "slit":
        st = r["st_by_course"]
        if st is None or len(st) != 6 or any(v is None for v in st): return None
        c = [cent(v) for v in st]
        if inp["mode"] == "custom":
            S = sum(c)
            for k, w in enumerate(inp["courses"]):
                if w == 1 and not (S - 6 * c[k] >= 30): return False
                if w == -1 and not (6 * c[k] - S >= 30): return False
            return True
        return all(form_ok(f, c, inp["level"]) for f in inp["patterns"])
    if typ == "entry":
        cb = r["course_by_boat"]
        if cb is None or cb[inp["boat"] - 1] is None: return None
        v = cb[inp["boat"] - 1]
        t = inp["target"]
        return v <= 3 if t == "within3" else v <= 4 if t == "within4" else v == inp["boat"]
    if typ == "payout":
        p = r["payout_3tan"]
        if p is None: return None
        b = inp["band"]
        return p < 1000 if b == "low" else (1000 <= p < 10000) if b == "mid" else p >= 10000
    raise ValueError(typ)

def count(rows, typ, inp):
    n = c = ex = 0
    for r in rows:
        v = judge(r, typ, inp)
        if v is None: ex += 1
        else:
            n += 1; c += bool(v)
    return n, c, ex

def pct(n, c):
    return None if n == 0 else str((Decimal(c) * 100 / Decimal(n)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))

def main_text(n, c, truncated):
    pre = "同じ条件の新しい" if truncated else "過去"
    return f"{pre}{n:,}レース中 {c:,}回（{pct(n, c)}%）"

def period(a, b):
    a, b = a[:7], b[:7]
    return a if a == b else f"{a}〜{b}"

layers_dir, choices_path, *ids = sys.argv[1:]
choices = json.load(open(choices_path))
out = {}
for rid in ids:
    L = json.load(open(os.path.join(layers_dir, f"{rid}.json")))
    rows = L["rows"]
    truncated = L["n_returned"] < L["n_total"]
    frm = min(r["race_date"] for r in rows) if truncated else L["pool_from"]
    res = []
    for ch in choices:
        n, c, ex = count(rows, ch["type"], ch["input"])
        res.append(dict(type=ch["type"], input=ch["input"], n=n, count=c, excluded=ex, pct=pct(n, c),
                        main=main_text(n, c, truncated) if n else None))
    o = dict(truncated=truncated, period=period(frm, L["pool_cutoff"]), n_returned=L["n_returned"],
             rows=len(rows), res=res)
    dec = os.environ.get("DEC_" + rid.replace("-", "_"))
    if dec:
        a, b, c3 = map(int, dec.split("-"))
        n, c, _ = count(rows, "order", {"first": a, "second": [b], "third": [c3]})
        o["decision"] = dict(combo=dec, n=n, count=c, main=main_text(n, c, truncated))
    out[rid] = o
print(json.dumps(out, ensure_ascii=False))
