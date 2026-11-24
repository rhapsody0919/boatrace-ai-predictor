"""モーター個体の再構成（手元の写しだけ。本番 DB に接続しない）。
入力: data/ml/dataset.csv・start_timings.csv（scripts/ml/export-training-data.js、2026-09-14 書き出し。motor_number の列は無い）
考え方:
  1. 選手×会場の連続した出走（日の間隔3日以内）を「節の中の1基」とみなす（出走表のモーター2連率が節の途中で固定なら同じ基）
  2. 会場の節: その日に新しく現れた選手が半分を超えた日を節の初日とする
  3. 世代の初め（会場の出走表のモーター2連率がほぼ全て0の節）から、節ごとに
     予想の表示値 = 累積の2連対数 / 累積の走数（3連も）と、次の節の表示値を突き合わせて基をつなぐ
使い方: python3 reconstruct.py <data/ml の場所> <出力 work/ の場所>
出力: work/runs.pkl（走ごと・motor_uid つき）、work/links.json（つなぎの品質）
"""
import sys, json, numpy as np, pandas as pd
ML, OUT = sys.argv[1], sys.argv[2]
TOL = 0.051  # 表示は小数1桁。丸めの幅（±0.05）だけ許す
d = pd.read_csv(f"{ML}/dataset.csv", low_memory=False)
s = pd.read_csv(f"{ML}/start_timings.csv").rename(columns={"racer_id": "rid_st"})
d = d.merge(s[["race_id", "boat_number", "rid_st", "start_timing", "is_flying"]], on=["race_id", "boat_number"], how="left")
d["racer_id"] = d.racer_id.fillna(d.rid_st)
d = d.dropna(subset=["racer_id"]).copy(); d["racer_id"] = d.racer_id.astype(int)
d["top2"] = ((d.boat_number == d.rank1) | (d.boat_number == d.rank2)).astype(int)
d["top3"] = (d.top2.astype(bool) | (d.boat_number == d.rank3)).astype(int)
d["win"] = (d.boat_number == d.rank1).astype(int)
d["date"] = pd.to_datetime(d.race_date)
d = d.sort_values(["venue_code", "racer_id", "date", "race_number"]).reset_index(drop=True)
# 1. 選手×会場の連続出走
g = d.groupby(["venue_code", "racer_id"], sort=False)
gap = (d.date - g.date.shift(1)).dt.days
newst = gap.isna() | (gap > 3)
# 同じ選手の連続でも、表示の2連率が変わったら別の基（節の途中の交換か、続けて次の節）
# 写しの値は小数1桁と2桁が混ざる（同じ節の同じ艇でも行で違う）ので、1桁に丸めて比べる
d["m2r1"] = d.motor_2rate.round(1)
newst |= (d.m2r1 != g.m2r1.shift(1)) & ~gap.isna()
d["stint"] = newst.cumsum()
# 2. 会場の節: 前の開催日から2日以上あき、その日の選手の半分以上が直前4日にその会場で走っていない日を節の初日とする
vdates = d[["venue_code", "date"]].drop_duplicates().sort_values(["venue_code", "date"])
vdates["gapd"] = vdates.groupby("venue_code").date.diff().dt.days
seen = d[["venue_code", "date", "racer_id"]].drop_duplicates()
prevseen = seen.merge(seen, on=["venue_code", "racer_id"], suffixes=("", "_p"))
prevseen = prevseen[(prevseen.date_p < prevseen.date) & ((prevseen.date - prevseen.date_p).dt.days <= 4)]
cont = prevseen.drop_duplicates(["venue_code", "date", "racer_id"]).groupby(["venue_code", "date"]).size()
tot = seen.groupby(["venue_code", "date"]).size()
newshare = (1 - cont.reindex(tot.index).fillna(0) / tot).rename("newshare").reset_index()
vdates = vdates.merge(newshare, on=["venue_code", "date"])
vdates["meet_start"] = vdates.gapd.isna() | ((vdates.gapd >= 2) & (vdates.newshare >= 0.5))
vdates["meet"] = vdates.groupby("venue_code").meet_start.cumsum()
d = d.merge(vdates[["venue_code", "date", "meet"]], on=["venue_code", "date"])
# 節の中で表示の2連率が変わる基（節の途中の交換）は別の基として扱う（stint で分かれている）
def precise(x):
    """節の中の行のうち小数2桁の値があればそれを、無ければ最初の値を返す"""
    x = x.dropna()
    if len(x) == 0: return np.nan
    two = x[(x * 10 - np.round(x * 10)).abs() > 1e-6]
    return float(two.iloc[0]) if len(two) else float(x.iloc[0])
def has2(x):
    x = x.dropna(); return bool(((x * 10 - np.round(x * 10)).abs() > 1e-6).any())
st = d.groupby("stint").agg(venue=("venue_code", "first"), meet=("meet", "min"), meet_max=("meet", "max"), start=("date", "min"), end=("date", "max"),
                            r2=("motor_2rate", precise), r3=("motor_3rate", precise), h2=("motor_2rate", has2), h3=("motor_3rate", has2),
                            m=("top2", "size"), k2=("top2", "sum"), k3=("top3", "sum")).reset_index()
# 2連率・3連率のどちらかに小数2桁の値があれば2桁の許容（±0.005）、無ければ1桁の許容（±0.05）
st["dec2"] = st.h2 | st.h3
def disp_arr(S):
    N = S[:, 0]
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(N > 0, 100.0 * S[:, 1] / N, 0.0), np.where(N > 0, 100.0 * S[:, 2] / N, 0.0)

def match_mask(S, r2, r3, tol):
    if len(S) == 0: return np.zeros(0, bool)
    t2, t3 = tol
    d2, d3 = disp_arr(S)
    ok = ~np.isnan(S[:, 0]) & (np.abs(d2 - r2) <= t2)
    if not np.isnan(r3): ok &= np.abs(d3 - r3) <= t3
    return ok

def infer_states(r2, r3, tol, nmax=400):
    """表示の2連率・3連率に合う (走数, 2連対数, 3連対数) の候補（小数2桁なら少数に絞れる）"""
    N = np.arange(1, nmax + 1)
    K2 = np.round(r2 * N / 100); ok = np.abs(100 * K2 / N - r2) <= tol[0]
    if not np.isnan(r3):
        K3 = np.round(r3 * N / 100); ok &= np.abs(100 * K3 / N - r3) <= tol[1]
    else:
        K3 = np.full(len(N), np.nan)
    return np.stack([N[ok], K2[ok], K3[ok]], 1).astype(float)

links = {"byVenue": {}}
resync_rows = []
uid_of = {}; state_of = {}
for v, sv in st.groupby("venue"):
    zero = sv.groupby("meet").r2.apply(lambda x: (x == 0).mean())
    zm = zero[zero > 0.9].index
    if len(zm) == 0: continue
    g0 = int(zm.min())
    uids = []; cur_s = np.zeros((0, 3)); lag_s = np.zeros((0, 3)); anchored = []
    stats = {"genStart": str(sv[sv.meet == g0].start.min().date()), "meets": 0, "stints": 0, "exact": 0, "lag": 0, "resync": 0,
             "new": 0, "anchor": 0, "unmatched": 0, "ambiguousDistinctStates": 0, "zeroAmbiguous": 0}
    for mt in sorted(sv[sv.meet >= g0].meet.unique()):
        cur = sv[sv.meet == mt].set_index("stint"); stats["meets"] += 1
        # 節の途中の補充選手は帰郷した選手のモーターを引き継ぐ。前の艇が走り終えた後に始まる艇は同じ基を使える
        used_end = np.full(len(uids), np.datetime64("NaT"), dtype="datetime64[ns]"); assign = {}
        def is_free(idx, start):
            if len(idx) == 0: return np.zeros(0, bool)
            e = used_end[idx]; return np.isnat(e) | (e < np.datetime64(start))
        cand = {}
        for sid, row in cur.iterrows():
            tol = (0.0051 if row.h2 else 0.051, 0.0051 if row.h3 else 0.051)
            ex = np.where(match_mask(cur_s, row.r2, row.r3, tol))[0]
            lg = np.where(match_mask(lag_s, row.r2, row.r3, tol))[0]; lg = np.setdiff1d(lg, ex)
            cand[sid] = (ex, lg, tol)
        order = sorted(cand, key=lambda k: (cur.loc[k].start, len(cand[k][0]) == 0, len(cand[k][0]) + len(cand[k][1])))
        matched_N = []
        pending = []
        for sid in order:
            row = cur.loc[sid]; ex, lg, tol = cand[sid]
            reuse = len(ex) and not is_free(ex, row.start).all()
            ex = ex[is_free(ex, row.start)] if len(ex) else ex; lg = lg[is_free(lg, row.start)] if len(lg) else lg
            is_zero = row.r2 == 0 and (np.isnan(row.r3) or row.r3 == 0)
            kind = None
            if len(ex):
                # 同じ表示でも状態が違う候補が複数なら、走数が多い順に（まだ走っていない基は後回し）
                states = {tuple(cur_s[j]) for j in ex}
                if len(states) > 1:
                    stats["zeroAmbiguous" if is_zero else "ambiguousDistinctStates"] += 1
                j = int(ex[np.argmin(cur_s[ex, 0])]) if is_zero else int(ex[0]); kind = "exact"
            elif len(lg):
                j = int(lg[0]); kind = "lag"
            elif is_zero:
                kind = "new"
            else:
                # 写しの走の抜け: 走数 ±2・2連対 ±1・3連対 ±1 の補正で表示に一致する基が1つだけなら同期し直す
                best = []
                free = np.where(is_free(np.arange(len(uids)), row.start) & ~np.isnan(cur_s[:, 0]))[0] if len(uids) else np.zeros(0, int)
                for dn in range(-2, 3):
                    for a_ in range(-1, 2):
                        for b_ in range(-1, 2):
                            S2 = cur_s[free] + np.array([dn, a_, b_])
                            okm = match_mask(S2, row.r2, row.r3, tol) & (S2[:, 0] > 0) & (S2[:, 1] >= 0) & (S2[:, 1] <= S2[:, 2]) & (S2[:, 2] <= S2[:, 0])
                            for jj in np.where(okm)[0]:
                                best.append((abs(dn) + abs(a_) + abs(b_), int(free[jj]), tuple(S2[jj])))
                best.sort()
                if best and (len(best) == 1 or best[0][0] < best[1][0] or best[0][1] == best[1][1]):
                    _, j, stt = best[0]; delta = tuple(int(x) for x in (np.array(stt) - cur_s[j])); cur_s[j] = stt; kind = "resync"
                    stats.setdefault("resyncDelta", {}); stats["resyncDelta"][str(delta)] = stats["resyncDelta"].get(str(delta), 0) + 1
                    resync_rows.append({"venue": int(v), "meet": int(mt), "uid": uids[j], "delta": delta})
                else:
                    pending.append(sid); continue
            if kind == "new":
                uids.append(f"{int(v):02d}-g{g0}-{len(uids)}"); anchored.append(False)
                cur_s = np.vstack([cur_s, [0, 0, 0]]); lag_s = np.vstack([lag_s, [np.nan] * 3]); used_end = np.append(used_end, np.datetime64("NaT")); j = len(uids) - 1
            if kind == "exact" and not np.isnat(used_end[j]): kind = "exactSubstitute"
            stats["stints"] += 1; stats[kind] = stats.get(kind, 0) + 1
            used_end[j] = np.datetime64(row.end); assign[sid] = (j, kind); matched_N.append(cur_s[j, 0])
        # つなげなかった艇: 表示から走数を推定して新しい鎖を始める（基の同一性は切れる）
        medN = float(np.median(matched_N)) if matched_N else 0.0
        for sid in pending:
            row = cur.loc[sid]; tol = (0.0051 if row.h2 else 0.051, 0.0051 if row.h3 else 0.051)
            C = infer_states(row.r2, row.r3, tol)
            stats["stints"] += 1
            if len(C):
                stt = C[np.argmin(np.abs(C[:, 0] - medN))]; kind = "anchor"
            else:
                stt = np.array([np.nan] * 3); kind = "unmatched"
            stats[kind] += 1
            uids.append(f"{int(v):02d}-g{g0}-{len(uids)}a"); anchored.append(True)
            cur_s = np.vstack([cur_s, stt]); lag_s = np.vstack([lag_s, [np.nan] * 3]); used_end = np.append(used_end, np.datetime64(row.end)); j = len(uids) - 1
            assign[sid] = (j, kind)
        pre = cur_s.copy(); seen_j = set()
        for sid, (j, kind) in sorted(assign.items(), key=lambda kv: cur.loc[kv[0]].start):
            row = cur.loc[sid]
            uid_of[sid] = uids[j]; state_of[sid] = (kind, cur_s[j, 0])  # この艇が乗る前の世代内の走数（anchor は推定）
            if j not in seen_j: lag_s[j] = pre[j].copy(); seen_j.add(j)
            cur_s[j] = cur_s[j] + np.array([row.m, row.k2, row.k3])
    stats["motorsSeen"] = len(uids); stats["chainsFromStart"] = int(sum(1 for a_ in anchored if not a_))
    denom = max(1, stats["stints"] - stats["new"])
    stats["linkedShare"] = (stats["exact"] + stats.get("exactSubstitute", 0) + stats["lag"] + stats["resync"]) / denom
    links["byVenue"][str(v)] = stats
pd.DataFrame(resync_rows).to_pickle(f"{OUT}/resync.pkl")
d["motor_uid"] = d.stint.map(uid_of)
d["link_kind"] = d.stint.map(lambda k: state_of.get(k, (None, None))[0])
d["gen_runs_before_meet"] = d.stint.map(lambda k: state_of.get(k, (None, np.nan))[1])
links["meetSizeQuantiles"] = st.groupby(["venue", "meet"]).size().quantile([0.05, 0.5, 0.95]).to_dict()
d.to_pickle(f"{OUT}/runs.pkl"); st.to_pickle(f"{OUT}/stints.pkl")
json.dump(links, open(f"{OUT}/links.json", "w"), ensure_ascii=False, indent=1, default=str)
for v, x in links["byVenue"].items():
    print(v, x)
print(links["meetSizeQuantiles"])
