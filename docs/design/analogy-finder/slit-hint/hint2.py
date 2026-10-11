# slitpred2_hint: ファンが読みやすい8条件を、平均ST A（全体30走）と C（そのコース、5走以上）で数える
from load import *
import json
r, B = load()
sm = B['st_mean30']; sr = B['st_result']
ret = (B['is_flying'] | B['is_late']).any(1)
END = pd.Timestamp('2026-09-26')
inper = (r.race_date <= END).values
stok = ~np.isnan(sr).any(1); mok = ~np.isnan(sm).any(1)
POP = inper & r.waku.values & ~ret & stok & mok
assert int(POP.sum()) == 313938, POP.sum()
NAMES = FORMS + ['none']; venue = r.venue_code.values; cls = B['cls_ord']
bt = pd.read_pickle(H + '/work2_boats.pkl')
pos = pd.Series(np.arange(len(r)), index=r.race_id.values)
bt = bt[bt.race_id.isin(pos.index) & bt.boat_number.between(1, 6)]
ri = pos[bt.race_id.values].values; bj = bt.boat_number.values.astype(int) - 1
def arr(col, fill=np.nan):
    a = np.full((len(r), 6), fill); a[ri, bj] = bt[col].values.astype(float); return a
V = {'A': sm, 'C': arr('C_m'), 'B': arr('B_m'), 'E': arr('E_m')}
N = {'A': B['st_n'].astype(float), 'C': arr('C_n', 0), 'B': arr('B_n', 0), 'E': arr('E_n', 0)}
AVC = (N['C'] >= 5) & ~np.isnan(V['C'])
SEL = {'A': POP, 'C': POP & AVC.all(1)}
CONDS = [
 ('kado4', 'kado', '4コース（カド）の平均STが、1〜3コースのどれよりも早い', lambda c: c[:, 3] < c[:, :3].min(1)),
 ('kado4_02', 'kado', '4コース（カド）の平均STが、1〜3コースのどれよりも.02以上早い', lambda c: c[:, :3].min(1) - c[:, 3] >= 20),
 ('in_slow02', 'd1', '1コースの平均STが、2コースより.02以上遅い', lambda c: c[:, 0] - c[:, 1] >= 20),
 ('in_fastest', 'd1', '1コースの平均STが、6艇で一番早い', lambda c: c[:, 0] < c[:, 1:].min(1)),
 ('d2_slow01', 'd2', '2コースの平均STが、1・3コースのどちらよりも.01以上遅い', lambda c: c[:, 1] - np.maximum(c[:, 0], c[:, 2]) >= 10),
 ('d3_slow01', 'd3', '3コースの平均STが、2・4コースのどちらよりも.01以上遅い', lambda c: c[:, 2] - np.maximum(c[:, 1], c[:, 3]) >= 10),
 ('dash03', 'dash', '4〜6コースの平均STの和が、1〜3コースの和より.03以上早い', lambda c: c[:, :3].sum(1) - c[:, 3:].sum(1) >= 30),
 ('flat03', 'flat', '6艇の平均STの差（最も遅い−最も早い）が.03以内', lambda c: c.max(1) - c.min(1) <= 30),
]
M = lambda x: np.round(x * 1000).astype(int)  # 1/1000 秒（slitpred.py と同じ）
def count(sel):
    out = {}
    for k in 'AC':
        ii = np.where(sel & SEL[k])[0]; A = forms(np.round(sr[ii] * 100).astype(int)); c = M(V[k][ii])
        out[k] = {'n': int(len(ii))}
        for cid, f, lab, fn in CONDS:
            cm = fn(c); a = A[:, NAMES.index(f)]
            out[k][cid] = {'hit': [int((cm & a).sum()), int(cm.sum())], 'miss': [int((~cm & a).sum()), int((~cm).sum())]}
    return out
nat = count(POP); wa = count(POP & (venue == 20) & (cls == 4).all(1))
def pack(cn):
    return [{'id': cid, 'form': f, 'label': lab, 'A': cn['A'][cid], 'C': cn['C'][cid]} for cid, f, lab, fn in CONDS]
i = int(np.where((r.race_date == pd.Timestamp('2026-09-27')).values & (venue == 20) & (r.race_number.values == 12))[0][0])
ex = {'race': '2026-09-27 若松12R', 'race_id': str(r.race_id.values[i]), 'waku': bool(r.waku.values[i]),
      'actual_st': [None if np.isnan(x) else round(float(x), 2) for x in sr[i]],
      'actual_forms': [f for f, b in zip(NAMES, forms(np.round(sr[[i]] * 100).astype(int))[0]) if b]}
for k in 'ACBE':
    ex[k] = [None if np.isnan(x) else round(float(x), 4) for x in V[k][i]]
    ex[k + '_n'] = [int(x) for x in N[k][i]]
for k in 'AC':
    c = M(V[k][[i]]); ex[k + '_conds'] = {cid: bool(fn(c)[0]) for cid, f, lab, fn in CONDS}
ex['C_complete_ge5'] = bool(AVC[i].all())
ex['note'] = 'B・E は表示用の値だけ（条件の判定には使っていない）。E は若松のそのコースの全選手の本番ST（前日まで、F・出遅れ除く）の平均で、E_n はその走数'
res = {'period': ['2019-04-01', str(END.date())], 'pop': {'A': nat['A']['n'], 'C': nat['C']['n']},
       'note': '形は重なりうる（prep7 と同じ）。平均STは 1/1000 秒に丸めて比べる。A は母集団の定義上3走以上、C はそのコースで5走未満の艇が1艇でもいるレースを除く',
       'conds': pack(nat), 'example': ex,
       'wakamatsu_A1x6': {'pop': {'A': wa['A']['n'], 'C': wa['C']['n']}, 'conds': pack(wa)}}
json.dump(res, open(H + '/slitpred2_hint.json', 'w'), ensure_ascii=False, indent=1)
def pr(x): return f'{x[0]/x[1]:.3f} ({x[0]}/{x[1]})' if x[1] else '-'
for nm, cn in [('全国', nat), ('若松A1x6', wa)]:
    print(nm, cn['A']['n'], cn['C']['n'])
    for cid, f, lab, fn in CONDS:
        print(cid, f, *[f"{k}: {pr(cn[k][cid]['hit'])} | {pr(cn[k][cid]['miss'])}" for k in 'AC'], sep='\t')
print(json.dumps(ex, ensure_ascii=False))
