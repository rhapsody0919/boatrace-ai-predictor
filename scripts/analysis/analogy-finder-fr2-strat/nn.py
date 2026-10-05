"""近傍探索の共通部品"""
import numpy as np


def neighbors(F, qidx, pidx, kmax, lam=0.0, vq=None, vp=None, chunk=128):
    """F の行で、各クエリ qidx に対し pidx の中から距離²（+会場不一致に lam）が近い順に kmax 件。戻り値は R の行番号"""
    F = F.astype(np.float32, copy=False)
    Fp = F[pidx]; pn = (Fp ** 2).sum(1)
    k = min(kmax, len(pidx))
    out = np.empty((len(qidx), k), np.int64)
    for s in range(0, len(qidx), chunk):
        q = F[qidx[s:s + chunk]]
        Dm = (q ** 2).sum(1)[:, None] + pn[None, :] - 2 * q @ Fp.T
        if lam:
            Dm += (vp[None, :] != vq[s:s + chunk][:, None]) * np.float32(lam)
        if k < len(pidx):
            part = np.argpartition(Dm, k - 1, axis=1)[:, :k]
        else:
            part = np.tile(np.arange(len(pidx)), (len(q), 1))
        dv = np.take_along_axis(Dm, part, 1); o = np.argsort(dv, 1, kind='stable')
        out[s:s + len(q)] = pidx[np.take_along_axis(part, o, 1)]
    return out


def lam_base(F, qidx, pidx, rank=400):
    """λ の基準 L: クエリ先頭300R の、全会場で rank 番目の距離²の中央値（MD-6 と同じ作り方）"""
    F = F.astype(np.float32, copy=False)
    q = F[qidx[:300]]; Fp = F[pidx]
    Dm = (q ** 2).sum(1)[:, None] + (Fp ** 2).sum(1)[None, :] - 2 * q @ Fp.T
    return float(np.median(np.partition(Dm, rank, axis=1)[:, rank]))


def probs(nb, k, lab, prior, alpha):
    l = lab[nb[:, :k]]
    cnt = np.stack([(l == c).sum(1) for c in range(prior.shape[1])], 1).astype(float)
    return (cnt + alpha * prior) / (cnt.sum(1, keepdims=True) + alpha)
