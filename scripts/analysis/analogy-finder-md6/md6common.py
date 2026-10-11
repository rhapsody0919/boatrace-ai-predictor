"""BOA-271 MD-6 共通: データ読み込み・重みベクトル・近傍探索"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "analogy-finder-phase-m"))
import common as C  # noqa: E402

OUT = C.D / "md6"
KMAX = 6400
KS = [100, 200, 400, 800, 1600, 3200, 6400]
N_CLUSTERS = 4


def load():
    r = pd.read_pickle(OUT / "races.pkl")
    Z = np.load(OUT / "Z.npy", mmap_mode="r")
    meta = json.loads((OUT / "cols.json").read_text())
    return r, Z, meta


def weight_vector(meta, wfile: str) -> np.ndarray:
    """列ごとの重み。艇別の数値=その艇番スロットの重み、レース共通=6艇分の和。
    one-hot は w/√2 を掛ける（不一致で距離²に w²＝数値の1SD差と同じ）。"""
    w = json.loads((OUT / wfile).read_text())["weights"]
    out = np.empty(len(meta), np.float32)
    for i, m in enumerate(meta):
        f = m["feature"]
        v = w[f][m["slot"] - 1] if m["slot"] else sum(w[f])
        if m["kind"] in ("race_cat", "boat_cat"):
            v /= np.sqrt(2)
        out[i] = v
    return out


def weighted(Z, wv, rows=None) -> np.ndarray:
    Zs = Z if rows is None else Z[rows]
    return (np.asarray(Zs, dtype=np.float32) * wv).astype(np.float32)


def venue_clusters(r: pd.DataFrame, pool_mask: np.ndarray) -> dict:
    """会場クラスタ: pool 期間の1号艇1着率で24場を4群（各6場）に分ける（イン有利度が似た会場）。"""
    p = r[pool_mask].groupby("venue_code")["win_boat"].apply(lambda s: (s == 1).mean()).sort_values()
    groups = np.array_split(p.index.to_numpy(), N_CLUSTERS)
    return {int(v): gi for gi, g in enumerate(groups) for v in g}, {int(k): float(x) for k, x in p.items()}


def _topk(M, k):
    k = min(k, M.shape[1] - 1)
    part = np.argpartition(M, k, axis=1)[:, :k]
    dv = np.take_along_axis(M, part, 1)
    o = np.argsort(dv, 1)
    return np.take_along_axis(part, o, 1), np.take_along_axis(dv, o, 1)


def search(Xq, Xp, qv, pv, qc, pc, lams, thr_d=None, labels=None, store_idx=True, chunk=128, log=""):
    """重み付きユークリッド距離の近傍（上位 KMAX、距離順。idx は Xp の行番号）。
    variants: knn（全会場）/ knn_v（同一会場）/ knn_c（同じ会場クラスタ）/ knn_p<i>（会場不一致に距離² + λ_i）。
    ペナルティ版は「全会場の上位 2×KMAX ∪ 同一会場の上位 KMAX」の候補から選ぶ（不一致側の上位 KMAX が
    全会場の上位 2×KMAX に収まる限り厳密。収まらなかったクエリ数を返す）。
    thr_d: 距離がしきい値以下の母集団件数（全会場・同一会場）も返す。
    labels: 母集団のラベル配列のリスト（-1=欠損）。渡すと各 k（KS）までの近傍のラベル件数
            counts[variant] = (Q, len(KS), len(labels), 6) を返す（idx を保存せずに済む）。"""
    nq = len(Xq)
    pn = (Xp ** 2).sum(1)
    names = ["knn", "knn_v", "knn_c"] + [f"knn_p{i}" for i in range(len(lams))]
    idx = {n: np.empty((nq, KMAX), np.int32) for n in names} if store_idx else None
    counts = ({n: np.zeros((nq, len(KS), len(labels), 6), np.int16) for n in names}
              if labels is not None else None)
    kpos = np.array(KS) - 1
    cnt = None
    if thr_d is not None:
        cnt = {n: np.empty((nq, len(thr_d)), np.int32) for n in ("knn", "knn_v")}
        thr2 = np.asarray(thr_d, np.float32) ** 2
    inexact = 0
    t0 = time.time()
    done = 0
    pool_by_v = {x: np.where(pv == x)[0] for x in np.unique(pv)}
    pool_by_c = {x: np.where(pc == x)[0] for x in np.unique(pc)}

    def put(name, s, nbr):
        if store_idx:
            idx[name][s] = nbr
        if labels is not None:
            for t, lab in enumerate(labels):
                oh = np.eye(7, dtype=np.int16)[lab[nbr] + 1][:, :, 1:]  # (q, KMAX, 6)、欠損は数えない
                counts[name][s, :, t, :] = np.cumsum(oh, axis=1, dtype=np.int16)[:, kpos, :]

    for venue in np.unique(qv):
        qi = np.where(qv == venue)[0]
        pv_idx = pool_by_v[venue]
        pc_idx = pool_by_c[qc[qi[0]]]
        for s0 in range(0, len(qi), chunk):
            s = qi[s0:s0 + chunk]
            q = Xq[s]
            Dm = (q ** 2).sum(1)[:, None] + pn[None, :] - 2.0 * (q @ Xp.T)
            np.maximum(Dm, 0, out=Dm)
            Dv = Dm[:, pv_idx]
            if cnt is not None:
                for j, t in enumerate(thr2):
                    cnt["knn"][s, j] = (Dm <= t).sum(1)
                    cnt["knn_v"][s, j] = (Dv <= t).sum(1)
            gi, gd = _topk(Dm, 2 * KMAX)
            put("knn", s, gi[:, :KMAX])
            vi, vd = _topk(Dv, KMAX)
            vi = pv_idx[vi]
            put("knn_v", s, vi)
            ci, _ = _topk(Dm[:, pc_idx], KMAX)
            put("knn_c", s, pc_idx[ci])
            g_mis = pv[gi] != venue
            inexact += int((g_mis.sum(1) < KMAX).sum())
            cand_i = np.concatenate([np.where(g_mis, gi, -1), vi], 1)
            for i, lam in enumerate(lams):
                cand_d = np.concatenate([np.where(g_mis, gd + np.float32(lam), np.inf), vd], 1)
                o = np.argsort(cand_d, 1)[:, :KMAX]
                put(f"knn_p{i}", s, np.take_along_axis(cand_i, o, 1))
            done += len(s)
        print(f"  {log} venue {venue} done {done:,}/{nq:,}  {time.time()-t0:.0f}s", flush=True)
    return idx, cnt, inexact, counts
