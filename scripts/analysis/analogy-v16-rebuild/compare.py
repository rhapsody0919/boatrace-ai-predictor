"""保存済み（saved）と作り直し（rebuilt）を、ファイルの種類ごとに比べる。
使い方: python compare.py SAVED_DIR REBUILT_DIR OUT_JSON"""
import gzip
import json
import math
import os
import sys
from collections import defaultdict

saved_dir, rebuilt_dir, out_json = sys.argv[1:4]
# 並び（順序）に意味のある一覧は、葉の位置での比較とは別に集合・上位 N で比べる
TOPN = (10, 50, 100, 800)


def load(p):
    with gzip.open(p) as f:
        return json.load(f)


def flatten(o, prefix="", out=None):
    out = {} if out is None else out
    if isinstance(o, dict):
        for k, v in o.items():
            flatten(v, f"{prefix}/{k}", out)
    elif isinstance(o, list):
        for i, v in enumerate(o):
            flatten(v, f"{prefix}[{i}]", out)
    else:
        out[prefix] = o
    return out


def isnum(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def generic(a, b):
    fa, fb = flatten(a), flatten(b)
    common = fa.keys() & fb.keys()
    eq = 0
    diffs = []
    diff_paths = defaultdict(int)
    for k in common:
        x, y = fa[k], fb[k]
        if isnum(x) and isnum(y):
            d = abs(x - y)
            diffs.append(d)
            if d <= 1e-9 * max(1, abs(x)):
                eq += 1
            else:
                diff_paths[norm_path(k)] += 1
        elif x == y:
            eq += 1
        else:
            diff_paths[norm_path(k)] += 1
    return {"leaves_saved": len(fa), "leaves_rebuilt": len(fb), "common": len(common), "equal": eq,
            "only_saved": len(fa.keys() - fb.keys()), "only_rebuilt": len(fb.keys() - fa.keys()),
            "num_diffs": diffs, "diff_paths": diff_paths}


def norm_path(p):
    import re
    return re.sub(r"\[\d+\]", "[]", p)


def overlap(xs, ys, n):
    return len(set(xs[:n]) & set(ys[:n])) / max(1, min(n, len(xs), len(ys)))


def main():
    res = {}
    for kind in sorted(os.listdir(saved_dir)):
        sd, rd = os.path.join(saved_dir, kind), os.path.join(rebuilt_dir, kind)
        files = sorted(os.listdir(sd))
        agg = {"files_saved": len(files), "files_missing_in_rebuilt": 0, "files_identical": 0,
               "leaves_common": 0, "leaves_equal": 0, "only_saved": 0, "only_rebuilt": 0,
               "num_n": 0, "num_nonzero": 0, "num_sum": 0.0, "num_max": 0.0, "diff_paths": defaultdict(int)}
        extra = defaultdict(list)
        if os.path.isdir(rd):
            agg["files_only_in_rebuilt"] = len(set(os.listdir(rd)) - set(files))
        for f in files:
            rp = os.path.join(rd, f)
            if not os.path.exists(rp):
                agg["files_missing_in_rebuilt"] += 1
                continue
            a, b = load(os.path.join(sd, f)), load(rp)
            if kind == "layer":  # run_id は実行ごとに違う
                a.pop("run_id", None), b.pop("run_id", None)
            g = generic(a, b)
            agg["files_identical"] += int(g["equal"] == g["common"] and not g["only_saved"] and not g["only_rebuilt"])
            agg["leaves_common"] += g["common"]
            agg["leaves_equal"] += g["equal"]
            agg["only_saved"] += g["only_saved"]
            agg["only_rebuilt"] += g["only_rebuilt"]
            for d in g["num_diffs"]:
                agg["num_n"] += 1
                agg["num_sum"] += d
                if d > 0:
                    agg["num_nonzero"] += 1
                agg["num_max"] = max(agg["num_max"], d)
            for k, v in g["diff_paths"].items():
                agg["diff_paths"][k] += v
            # 種類ごとの追加の比較
            if kind == "similar-racecard":
                xa = [n["race_id"] for n in a["neighbors"]]
                xb = [n["race_id"] for n in b["neighbors"]]
                for n in TOPN:
                    extra[f"top{n}_overlap"].append(overlap(xa, xb, n))
                extra["exact_order_top10"].append(xa[:10] == xb[:10])
                da = {n["race_id"]: n["distance"] for n in a["neighbors"]}
                db = {n["race_id"]: n["distance"] for n in b["neighbors"]}
                extra["dist_absdiff_same_race"].extend(abs(da[k] - db[k]) for k in da.keys() & db.keys())
                extra["n_layer_diff"].append(b["n_layer"] - a["n_layer"])
            if kind == "similar":
                xa, xb = a["candidates"], b["candidates"]
                for n in (100, 1000, 10000, 30000):
                    extra[f"top{n}_overlap"].append(overlap(xa, xb, n))
                extra["candidates_set_jaccard"].append(len(set(xa) & set(xb)) / max(1, len(set(xa) | set(xb))))
                extra["n_layer_diff"].append(b["n_layer"] - a["n_layer"])
            if kind == "layer":
                ra = [r["race_id"] for r in a["rows"]]
                rb = [r["race_id"] for r in b["rows"]]
                extra["n_total_diff"].append(b["n_total"] - a["n_total"])
                extra["rows_set_jaccard"].append(len(set(ra) & set(rb)) / max(1, len(set(ra) | set(rb))))
                extra["only_saved_ids"].extend(sorted(set(ra) - set(rb)))
                extra["only_rebuilt_ids"].extend(sorted(set(rb) - set(ra)))
            if kind in ("facts", "scenario", "scenario-boat", "scenario-races", "scenario-boat-races"):
                extra["n_diff"].append(b.get("n", 0) - a.get("n", 0))
        agg["leaf_match_rate"] = agg["leaves_equal"] / max(1, agg["leaves_common"])
        agg["num_mean_absdiff"] = agg["num_sum"] / max(1, agg["num_n"])
        agg["num_mean_absdiff_nonzero"] = agg["num_sum"] / max(1, agg["num_nonzero"])
        agg["top_diff_paths"] = sorted(agg.pop("diff_paths").items(), key=lambda x: -x[1])[:15]
        ex = {}
        for k, v in extra.items():
            if k.endswith("_ids"):
                ex[k] = {"n": len(v), "dates": count_dates(v)}
            elif v and isinstance(v[0], bool):
                ex[k] = sum(v) / len(v)
            elif v:
                nz = [x for x in v if x != 0]
                ex[k] = {"mean": sum(v) / len(v), "min": min(v), "max": max(v), "n": len(v), "n_nonzero": len(nz)}
        agg["extra"] = ex
        res[kind] = agg
    json.dump(res, open(out_json, "w"), ensure_ascii=False, indent=1, default=float)
    for kind, r in res.items():
        print(f"== {kind}: files {r['files_saved']} missing {r['files_missing_in_rebuilt']} identical {r['files_identical']}"
              f" leaf_match {r['leaf_match_rate']:.4%} (only_saved {r['only_saved']} only_rebuilt {r['only_rebuilt']})"
              f" num n={r['num_n']} nonzero={r['num_nonzero']} mean={r['num_mean_absdiff']:.3g}"
              f" mean_nz={r['num_mean_absdiff_nonzero']:.3g} max={r['num_max']:.4g}")
        for p, c in r["top_diff_paths"][:8]:
            print("   ", c, p)
        for k, v in r["extra"].items():
            print("   *", k, v)


def count_dates(ids):
    c = defaultdict(int)
    for i in ids:
        c[i[:7]] += 1
    return dict(sorted(c.items()))


main()
