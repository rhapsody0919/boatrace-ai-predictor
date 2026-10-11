# BOA-271 v16 T1-4: 手がかりの条件のしきい値の期間分割（事前登録 preregistration-t1.md「T1-4」、コミット 238e0bb5a）
# 定義は docs/design/analogy-finder/slit-hint/hint2.py（8条件・POP）と spec C-2（このコースで5走未満の艇は全体の平均STで埋める）。
# 実行: ANALOGY_SCRATCH=~/boatrace-data-archive/boa271-fr2-scratch-2026-10-04 \
#       $ANALOGY_SCRATCH/model-prep/venv/bin/python scripts/analysis/analogy-finder-t1/t1_4_hint_threshold.py
import os, sys, json, hashlib
import numpy as np, pandas as pd

SCR = os.environ.get('ANALOGY_SCRATCH')
if not SCR:
    sys.exit('ANALOGY_SCRATCH が未設定（スクラッチのディレクトリを渡す）')
SCR = os.path.expanduser(SCR)
SP = os.path.join(SCR, 'slitpred')
sys.path.insert(0, SP)
from load import load, forms, wilson, FORMS  # slit-hint/load.py と同一（diff で確認）

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(REPO, 'docs/design/analogy-finder/analysis/t1/t1-4-hint-threshold.json')
HINT_JSON = os.path.join(REPO, 'docs/design/analogy-finder/slit-hint/slitpred2_hint.json')

PERIODS = {'P1': ('2019-04-01', '2022-09-30'), 'P2': ('2022-10-01', '2025-12-02'), 'P3': ('2025-12-03', '2026-09-26')}
SCOPES = {**PERIODS, 'P1P2': ('2019-04-01', '2025-12-02'), 'ALL': ('2019-04-01', '2026-09-26')}
CANDS = [0, 10, 20, 30, 40]  # 1/1000秒（.00〜.04）
NB, SEED = 200, 0

def sha256(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for ch in iter(lambda: f.read(1 << 20), b''): h.update(ch)
    return h.hexdigest()

# ---- データ（hint2.py と同じ組み立て）
r, B = load()
sm = B['st_mean30']; sr = B['st_result']
ret = (B['is_flying'] | B['is_late']).any(1)
END = pd.Timestamp('2026-09-26')
inper = (r.race_date <= END).values
stok = ~np.isnan(sr).any(1); mok = ~np.isnan(sm).any(1)
POP = inper & r.waku.values & ~ret & stok & mok
assert int(POP.sum()) == 313938, POP.sum()
NAMES = FORMS + ['none']
venue = r.venue_code.values; cls = B['cls_ord']
bt = pd.read_pickle(os.path.join(SP, 'work2_boats.pkl'))
bt_rows, bt_max = len(bt), None
pos = pd.Series(np.arange(len(r)), index=r.race_id.values)
bt = bt[bt.race_id.isin(pos.index) & bt.boat_number.between(1, 6)]
ri = pos[bt.race_id.values].values; bj = bt.boat_number.values.astype(int) - 1
def arr(col, fill=np.nan):
    a = np.full((len(r), 6), fill); a[ri, bj] = bt[col].values.astype(float); return a
Cm, Cn = arr('C_m'), arr('C_n', 0)
AVC = (Cn >= 5) & ~np.isnan(Cm)
V = {'A': sm,                          # 全体（直近30走、st_mean30）
     'Cfill': np.where(AVC, Cm, sm),   # このコースで（5走未満は全体で埋める。spec C-2）＝主
     'Cexcl': Cm}                      # slitpred2_hint.json の C（5走未満の艇がいるレースを除く）。照合だけに使う
SEL = {'A': POP, 'Cfill': POP, 'Cexcl': POP & AVC.all(1)}

M = lambda x: np.round(x * 1000).astype(int)  # 1/1000 秒（hint2.py と同じ）
# しきい値つき6条件: fn(c, t)。cur は今の値（1/1000秒）
TH = [
 ('kado4_02', 'kado', 20, lambda c, t: c[:, :3].min(1) - c[:, 3] >= t),
 ('in_slow02', 'd1', 20, lambda c, t: c[:, 0] - c[:, 1] >= t),
 ('d2_slow01', 'd2', 10, lambda c, t: c[:, 1] - np.maximum(c[:, 0], c[:, 2]) >= t),
 ('d3_slow01', 'd3', 10, lambda c, t: c[:, 2] - np.maximum(c[:, 1], c[:, 3]) >= t),
 ('dash03', 'dash', 30, lambda c, t: c[:, :3].sum(1) - c[:, 3:].sum(1) >= t),
 ('flat03', 'flat', 30, lambda c, t: c.max(1) - c.min(1) <= t),
]
NOTH = [
 ('kado4', 'kado', lambda c: c[:, 3] < c[:, :3].min(1)),
 ('in_fastest', 'd1', lambda c: c[:, 0] < c[:, 1:].min(1)),
]
ORDER = ['kado4', 'kado4_02', 'in_slow02', 'in_fastest', 'd2_slow01', 'd3_slow01', 'dash03', 'flat03']

FA = forms(np.round(np.nan_to_num(sr) * 100).astype(int))  # POP 外は使わない（POP は6艇そろう）
dates = r.race_date.values

def masks(k, sel):
    """sel 内のレースの (form 配列, {key: 条件の真偽}) 。key は (cid, t) / (cid, None)"""
    ii = np.where(sel)[0]; c = M(V[k][ii]); out = {}
    for cid, f, cur, fn in TH:
        for t in CANDS: out[(cid, t)] = (f, fn(c, t))
    for cid, f, fn in NOTH: out[(cid, None)] = (f, fn(c))
    return ii, out

def metrics(kh, nh, km, nm, W=None):
    """点推定と、W（ブートストラップの日の重み）があれば各指標の 2.5/97.5% 点"""
    def f(kh, nh, km, nm):
        ph = kh / nh; pm = km / nm; h = nh / (nh + nm)
        return ph, pm, ph / pm, h, (ph - pm) * h
    ph, pm, lift, h, U = f(kh, nh, km, nm)
    res = {'n': int(nh + nm), 'hit': [int(kh), int(nh)], 'miss': [int(km), int(nm)],
           'p_hit': list(map(float, wilson(kh, nh))), 'p_miss': list(map(float, wilson(km, nm))),
           'lift': float(lift), 'h': float(h), 'U': float(U)}
    if W is not None:
        b = np.array(f(*W))  # 5×NB
        lo, hi = np.nanpercentile(b, [2.5, 97.5], axis=1)
        for j, nm_ in enumerate(['p_hit', 'p_miss', 'lift', 'h', 'U']):
            res[nm_ + '_boot95'] = [float(lo[j]), float(hi[j])]
    return res

def run(k):
    """版 k の全条件×候補×期間の指標"""
    ii, mk = masks(k, SEL[k])
    d = dates[ii]; out = {}
    for sc, (a, b) in SCOPES.items():
        inn = (d >= np.datetime64(a)) & (d <= np.datetime64(b))
        dd = d[inn]; ud, di = np.unique(dd, return_inverse=True); nd = len(ud)
        rng = np.random.default_rng(SEED)  # 期間ごとに seed 0 から（条件どうしは同じ重みで対になる）
        Wd = np.stack([np.bincount(rng.integers(0, nd, nd), minlength=nd) for _ in range(NB)]).astype(float)  # NB×nd
        out[sc] = {'days': int(nd), 'races': int(inn.sum())}
        for key, (f, cm) in mk.items():
            cm = cm[inn]; a_ = FA[ii][inn][:, NAMES.index(f)]
            cols = np.stack([np.bincount(di, (cm & a_).astype(float), nd), np.bincount(di, cm.astype(float), nd),
                             np.bincount(di, (~cm & a_).astype(float), nd), np.bincount(di, (~cm).astype(float), nd)], 1)
            tot = cols.sum(0); bw = Wd @ cols  # NB×4
            out[sc][key] = metrics(*tot, W=tuple(bw.T))
    return out

def judge(res):
    """事前登録の判定を機械的に当てる"""
    J = {}
    for cid, f, cur, fn in TH:
        cell = {p: res[p][(cid, cur)] for p in PERIODS}
        lifts = [cell[p]['lift'] for p in PERIODS]
        gt1 = all(cell[p]['lift_boot95'][0] > 1 for p in PERIODS)
        rng_ = max(lifts) - min(lifts)
        keep = gt1 and rng_ <= 0.3
        j = {'current': cur / 1000, 'lift_by_period': dict(zip(PERIODS, lifts)), 'lift_range': rng_,
             'all_lift_ci_above_1': gt1, 'keep_current': keep}
        if not keep:
            us = {t: res['P1P2'][(cid, t)]['U'] for t in CANDS}
            tb = max(us, key=lambda t: -np.inf if np.isnan(us[t]) else us[t])  # 当てはまる艇が0（U が NaN）の候補は選ばない
            p3 = res['P3'][(cid, tb)]; p12 = res['P1P2'][(cid, tb)]
            ok = p3['lift_boot95'][0] > 1 and abs(p3['lift'] - p12['lift']) <= 0.3
            j.update({'U_P1P2_by_candidate': {f'{t/1000:.2f}': us[t] for t in CANDS}, 'selected': tb / 1000,
                      'P3_check': {'lift_P3': p3['lift'], 'lift_P3_boot95': p3['lift_boot95'], 'lift_P1P2': p12['lift'],
                                   'diff': p3['lift'] - p12['lift'], 'lift_ci_above_1': p3['lift_boot95'][0] > 1,
                                   'diff_within_0.3': abs(p3['lift'] - p12['lift']) <= 0.3, 'pass': ok},
                      'outcome': ('change_to_selected' if tb != cur else 'selected_equals_current') if ok else 'propose_removal'})
        else:
            j['outcome'] = 'keep_current'
        J[cid] = j
    for cid, f, fn in NOTH:
        lifts = [res[p][(cid, None)]['lift'] for p in PERIODS]
        rng_ = max(lifts) - min(lifts)
        J[cid] = {'current': None, 'lift_by_period': dict(zip(PERIODS, lifts)), 'lift_range': rng_,
                  'all_lift_ci_above_1': all(res[p][(cid, None)]['lift_boot95'][0] > 1 for p in PERIODS),
                  'stable': rng_ <= 0.3, 'outcome': 'stable' if rng_ <= 0.3 else 'unstable'}
    return J

def pack(res):
    out = {}
    for cid in ORDER:
        th = next((x for x in TH if x[0] == cid), None)
        keys = [(cid, t) for t in CANDS] if th else [(cid, None)]
        out[cid] = {('none' if t is None else f'{t/1000:.2f}'): {sc: res[sc][(cid, t)] for sc in SCOPES} for _, t in keys}
    return out

R = {k: run(k) for k in ['Cfill', 'A']}
J = {k: judge(R[k]) for k in R}

# ---- 照合: 今の値・全期間で slitpred2_hint.json を再現できるか（A＝全体、Cexcl＝hint の C）
hint = json.load(open(HINT_JSON))
def full_counts(k):
    ii = np.where(SEL[k])[0]; c = M(V[k][ii]); A_ = FA[ii]; out = {}
    for cid, f, cur, fn in TH: cm = fn(c, cur); a = A_[:, NAMES.index(f)]; out[cid] = (cm, a)
    for cid, f, fn in NOTH: cm = fn(c); a = A_[:, NAMES.index(f)]; out[cid] = (cm, a)
    return int(len(ii)), {cid: {'hit': [int((cm & a).sum()), int(cm.sum())], 'miss': [int((~cm & a).sum()), int((~cm).sum())]}
                          for cid, (cm, a) in out.items()}
recon = {}
for k, hk in [('A', 'A'), ('Cexcl', 'C')]:
    n, got = full_counts(k)
    rows = {}
    for c in hint['conds']:
        exp = {'hit': c[hk]['hit'], 'miss': c[hk]['miss']}
        rows[c['id']] = {'expected': exp, 'got': got[c['id']], 'match': exp == got[c['id']]}
    recon[hk] = {'pop_expected': hint['pop'][hk], 'pop_got': n, 'all_match': all(v['match'] for v in rows.values()) and n == hint['pop'][hk], 'conds': rows}

# ---- 例のレース（2026-09-27 若松12R）: 条件の判定がしきい値で変わるか
i = int(np.where((r.race_date == pd.Timestamp('2026-09-27')).values & (venue == 20) & (r.race_number.values == 12))[0][0])
ex = {'race': '2026-09-27 若松12R', 'race_id': str(r.race_id.values[i]),
      'C_n': [int(x) for x in Cn[i]], 'C_filled_boats': [bool(not x) for x in AVC[i]]}
for k in ['Cfill', 'A']:
    c = M(V[k][[i]])
    ex[k] = {'st_1000': [int(x) for x in c[0]],
             'conds': {cid: {f'{t/1000:.2f}': bool(fn(c, t)[0]) for t in CANDS} for cid, f, cur, fn in TH}}
    ex[k]['conds'].update({cid: {'none': bool(fn(c)[0])} for cid, f, fn in NOTH})
ex['hint_json_example'] = {'A_conds': hint['example']['A_conds'], 'C_conds': hint['example']['C_conds'],
                           'C_complete_ge5': hint['example']['C_complete_ge5']}
# 若松・6艇ともA1（hint2 の wakamatsu_A1x6 と同じ範囲）の全期間の件数（札の条件の参考。期間分割はしない）
WA = POP & (venue == 20) & (cls == 4).all(1)
wa = {}
for k in ['Cfill', 'A']:
    ii = np.where(WA)[0]; c = M(V[k][ii]); A_ = FA[ii]; wa[k] = {'n': int(len(ii))}
    for cid, f, cur, fn in TH:
        wa[k][cid] = {}
        for t in CANDS:
            cm = fn(c, t); a = A_[:, NAMES.index(f)]
            kh, nh, km, nm = int((cm & a).sum()), int(cm.sum()), int((~cm & a).sum()), int((~cm).sum())
            wh, wm = wilson(kh, nh), wilson(km, nm)
            wa[k][cid][f'{t/1000:.2f}'] = {'hit': [kh, nh], 'miss': [km, nm], 'p_hit': list(map(float, wh)), 'p_miss': list(map(float, wm)),
                                         'tag_rule': bool(nh >= 30 and wh[0] > wm[2])}
ex['wakamatsu_A1x6_full_period'] = wa
# 今の値での判定が slitpred2_hint.json の example（A_conds・C_conds）と一致するか（例は C が6艇とも5走以上なので Cfill＝C）
cur_t = {cid: cur for cid, f, cur, fn in TH}
for k, hk in [('A', 'A_conds'), ('Cfill', 'C_conds')]:
    now = {cid: v[f'{cur_t[cid]/1000:.2f}'] if cid in cur_t else v['none'] for cid, v in ex[k]['conds'].items()}
    ex[k]['conds_at_current'] = now; ex[k]['matches_hint_json'] = now == hint['example'][hk]
ex['note'] = ('札は spec C-2 のとおり範囲（既定 VC）で数えた率で決まる。ここでは条件の当否（しきい値ごと）と、'
              '若松・6艇ともA1・全期間の件数で「当てはまったレース30件以上・当てはまるときの率の Wilson 下限＞当てはまらないときの上限」を参考に出す')

# ---- 入力の記録
r_pop = r[POP]
inputs = {
 'races.pkl': {'path': 'knn/work2/races.pkl', 'rows': int(len(r)), 'max_date': str(r.race_date.max().date()), 'sha256': sha256(os.path.join(SCR, 'knn/work2/races.pkl'))},
 'boats.npz': {'path': 'knn/work2/boats.npz', 'rows': int(len(sm)), 'sha256': sha256(os.path.join(SCR, 'knn/work2/boats.npz'))},
 'work2_boats.pkl': {'path': 'slitpred/work2_boats.pkl', 'rows': int(bt_rows), 'max_date': str(r.race_date[r.race_id.isin(bt.race_id.unique())].max().date()),
                     'sha256': sha256(os.path.join(SP, 'work2_boats.pkl'))},
}
for f in ['kbA', 'kbB', 'main']:
    p = os.path.join(SP, 'raw', f + '.txt'); inputs[f'raw/{f}.txt'] = {'path': f'slitpred/raw/{f}.txt', 'sha256': sha256(p)}
mf = json.load(open(os.path.join(SCR, 'model-prep/data/fetch_manifest.json')))

res = {
 'preregistration': {'file': 'docs/design/analogy-finder/analysis/t1/preregistration-t1.md', 'section': 'T1-4', 'commit': '238e0bb5a'},
 'definition': {
  'population': 'hint2.py の POP（2019-04-01〜2026-09-26、6艇とも枠なり・返還（F・出遅れ）を除く・本番ST 6艇そろう・st_mean30 6艇そろう）',
  'versions': {'Cfill': '主。このコースで（そのコースで枠なりだった直近30走の平均ST。そのコースで5走未満の艇は全体の平均ST（st_mean30）で埋める。spec C-2）',
               'A': '参考。全体（直近30走の平均ST、st_mean30）'},
  'st_units': '平均STは 1/1000 秒に丸めて比べる（hint2.py と同じ）',
  'form': '条件ごとの form（hint2.py）。round(本番ST×100) の7形（load.forms）',
  'metrics': 'p_hit＝当てはまるときの形の率、p_miss＝当てはまらないときの率、lift＝p_hit/p_miss、h＝当てはまる割合、U＝(p_hit−p_miss)×h。p_hit・p_miss は Wilson 95%（[p, lo, hi]）。*_boot95 は日単位のブートストラップ（200回、各期間で np.random.default_rng(0) から。条件・候補どうしは同じ重み）の 2.5/97.5% 点',
  'periods': PERIODS, 'scopes_extra': {'P1P2': '選び直しに使う', 'ALL': '参考（全期間）'},
  'candidates': [t / 1000 for t in CANDS],
  'rule': '今の値を残す: 3期間すべてで lift のブートストラップ下限＞1、かつ 3期間の lift の最大−最小 ≤ 0.3。残らなければ P1P2 で U 最大の候補を選び、P3 で lift 下限＞1 と |lift_P3 − lift_P1P2| ≤ 0.3 を確かめる（P3 はこの1回だけ）。通らなければ外す案。しきい値なしの kado4・in_fastest は安定（最大−最小 ≤ 0.3）だけを見る',
  'in_sample_note': 'モデルの評価はしない。P3 はしきい値の確認に1回だけ使った',
 },
 'inputs': inputs,
 'upstream_manifest': {'version': mf.get('version'), 'tables': mf['tables']},
 'reproduction_vs_slitpred2_hint': recon,
 'judgment': J,
 'results': {k: pack(R[k]) for k in R},
 'example': ex,
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
def clean(o):  # NaN（当てはまる艇が0の候補など）は null にする（厳密な JSON にするため）
    if isinstance(o, dict): return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)): return [clean(v) for v in o]
    if hasattr(o, 'item'): o = o.item()
    if isinstance(o, float) and not np.isfinite(o): return None
    return o
json.dump(clean(res), open(OUT, 'w'), ensure_ascii=False, indent=1, allow_nan=False)
print('reproduction', {k: v['all_match'] for k, v in recon.items()})
for k in J:
    print('==', k)
    for cid in ORDER:
        j = J[k][cid]
        print(cid, {p: round(x, 3) for p, x in j['lift_by_period'].items()}, 'range', round(j['lift_range'], 3), j['outcome'],
              j.get('selected'), j.get('P3_check'))
