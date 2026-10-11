# mark1: スリットの形ごとに「攻める艇」と1号艇の1マークの結果を、モーター2連率・展示タイムの6艇中の順位で分けて数える
# 母集団・形の判定は slitpred.py と同じ（load.py の forms・枠なりマスク）。実行: rank-facts/run.sh ../slitpred/mark1.py
import sys, os, json
H = '/private/tmp/claude-501/-Users-terukina-boatrace-ai-predictor--claude-worktrees-confident-chatelet-c22064/42ade70b-827e-48f3-b33a-05c6914c677c/scratchpad/slitpred'
sys.path.insert(0, H); os.chdir(H)
from load import *
r, _ = load()
b = np.load(H + '/../knn/work2/boats.npz', allow_pickle=True)
G = lambda k: b[k]
bn = G('boat_number'); assert (bn[~np.isnan(bn).any(1)] == np.arange(1, 7)).all(), 'boats.npz の列が艇番順でない'
sm, sr = G('st_mean30'), G('st_result')
ret = (G('is_flying') | G('is_late')).any(1)
END = pd.Timestamp('2026-09-26')
POP = (r.race_date <= END).values & r.waku.values & ~ret & ~np.isnan(sr).any(1) & ~np.isnan(sm).any(1)
print('POP', POP.sum())
mot, motr = G('motor_2'), G('motor_2_rank')
exh, exhr = G('exh_time'), G('exh_time_rank')
cls = G('cls_ord')
r1, r2 = r.rank1.values.astype(int), r.rank2.values.astype(int)

# 決まり手（本番 Supabase 読み取り: 〜2025-12-02 は kb_archive_races.technique、以降は race_results.winning_technique）
tk = {}
for f, src in [('tkA', 'kb'), ('tkB', 'kb'), ('tkM', 'main')]:
    for t in open(H + f'/raw/{f}.txt').read().split(','):
        tk[(src, t[:6], int(t[6:8]))] = t[8:]
ymd = r.race_date.dt.strftime('%y%m%d').values
srcs = np.where(r.race_date <= pd.Timestamp('2025-12-02'), 'kb', 'main')
tech = np.full(len(r), '_', dtype='<U1')
for i in np.where(POP)[0]:
    s = tk.get((srcs[i], ymd[i], int(r.venue_code.values[i])))
    if s is not None: tech[i] = s[int(r.race_number.values[i]) - 1]
TK = {'N': '逃げ', 'M': 'まくり', 'S': '差し', 'X': 'まくり差し', 'B': '抜き', 'E': '恵まれ', 'O': 'その他', '-': '未記録(null)', '_': '行なし'}
tech_known = np.isin(tech, list('NMSXBEO'))
print('tech', {TK[k]: int(v) for k, v in pd.Series(tech[POP]).value_counts().items()})

idx = np.where(POP)[0]
F = np.zeros((len(r), 8), bool); F[idx] = forms(np.round(sr[idx] * 100).astype(int))
ATT = {'kado': 4, 'd1': 2, 'd2': 3, 'd3': 4, 'dash': 4, 'flat': None, 'wall': None}
yusho = (r['round'].values == 'yusho')
wk = (r.venue_code.values == 20); a1 = (cls == 4).all(1)
SC = {'nat': POP, 'wk': POP & wk, 'wkA1': POP & wk & a1, 'allA1': POP & a1, 'allA1Y': POP & a1 & yusho}
STI = np.full(sr.shape, -999, int); STI[idx] = np.round(sr[idx] * 100).astype(int)

def X(m, base): return [int((m & base).sum()), int(base.sum())]
def metrics(sel, a):
    o = {'n': int(sel.sum()), 'winner': [int((sel & (r1 == k)).sum()) for k in range(1, 7)]}
    o['b1_nige'] = X((r1 == 1) & (tech == 'N'), sel)
    o['b1_win'] = X(r1 == 1, sel)
    o['b1_top2'] = X((r1 == 1) | (r2 == 1), sel)
    o['tech_known_n'] = int((sel & tech_known).sum())
    if a is not None:
        o['att_win'] = X(r1 == a, sel)
        o['att_top2'] = X((r1 == a) | (r2 == a), sel)
        for c, k in [('M', 'makuri'), ('X', 'makurizashi'), ('S', 'sashi')]:
            o[f'att_{k}'] = X((r1 == a) & (tech == c), sel)  # 分母＝そのレース全体
            o[f'att_{k}_of_win'] = X((r1 == a) & (tech == c), sel & (r1 == a))  # 分母＝攻める艇の1着
        o['inner_boat'] = a - 1
        o['inner_top2'] = X((r1 == a - 1) | (r2 == a - 1), sel)
    return o
def band(rk):  # min 順位（同じ値は同じ順位＝小さいほう）。1〜2 上位 / 3〜4 中位 / 5〜6 下位
    return {'top': (rk >= 1) & (rk <= 2), 'mid': (rk >= 3) & (rk <= 4), 'low': (rk >= 5) & (rk <= 6)}
motok = ~np.isnan(mot).any(1); exok = ~np.isnan(exh).any(1)
out = {'period': ['2019-04-01', str(END.date())],
       'notes': {'population': '枠なり・返還なし・本番ST6艇・平均ST6艇そろう（slitpred と同じ 313,938R）',
                 'attacker': ATT, 'rank': 'motor_2_rank・exh_time_rank（features.py の rank(method="min")、レース内6艇。モーターは高いほど1位、展示タイムは速い（小さい）ほど1位。同じ値は同じ順位（小さいほう））',
                 'motor_rank_needs': 'モーター2連率が6艇そろうレースだけ', 'exh_rank_needs': '展示タイムが6艇そろうレースだけ',
                 'technique_source': '本番Supabase 読み取り（MCP execute_sql SELECT、2026-10-04 取得、md5一致）: race_date≦2025-12-02 は kb_archive_races.technique、以降は race_results.winning_technique',
                 'b1_nige': '1着が1号艇かつ決まり手が逃げ', 'inner_top2': '攻める艇−1 号艇の2着以内（イン凹みでは1号艇と同じ）',
                 'overlap': 'forms.<形>.overlap.<ほかの形> = [その形にも当たるR, この形のR]（全国の枠なりだけ）',
                 'att_lead': 'forms.<形>.att_lead = [攻める艇の本番STが内側の艇（攻める艇−1号艇）より0.05秒以上早いR, この形のR]（全国の枠なりだけ。STはround(×100)の整数で比較）'},
       'scopes': {}, 'forms': {}}
out['tech_counts'] = {TK[k]: int(v) for k, v in pd.Series(tech[POP]).value_counts().items()}
for s, m in SC.items():
    out['scopes'][s] = {'n': int(m.sum()), 'motor_ok': int((m & motok).sum()), 'exh_ok': int((m & exok).sum())}
for j, f in enumerate(FORMS):
    a = ATT[f]; fo = {'label': JA[f], 'attacker': a}
    for key in ['all', 'by_motor', 'by_exh', 'b1_by_motor', 'b1_by_exh']: fo[key] = {}
    for s, m in SC.items():
        sel = m & F[:, j]
        fo['all'][s] = metrics(sel, a)
        if a is not None:
            fo['by_motor'][s] = {k: metrics(sel & motok & v, a) for k, v in band(motr[:, a - 1]).items()}
            fo['by_exh'][s] = {k: metrics(sel & exok & v, a) for k, v in band(exhr[:, a - 1]).items()}
        fo['b1_by_motor'][s] = {k: metrics(sel & motok & v, None) for k, v in band(motr[:, 0]).items()}
        fo['b1_by_exh'][s] = {k: metrics(sel & exok & v, None) for k, v in band(exhr[:, 0]).items()}
    sel = SC['nat'] & F[:, j]
    fo['overlap'] = {g: X(F[:, k], sel) for k, g in enumerate(FORMS) if k != j}  # nat のみ。分母＝この形のレース
    if a is not None:  # 攻める艇の本番STが内側の艇（a−1号艇）より 0.05秒以上早い（小さい）。nat のみ
        fo['att_lead'] = X((STI[:, a - 2] - STI[:, a - 1]) >= 5, sel)
    out['forms'][f] = fo
# 参考: 形を問わない全体
out['any_form'] = {s: metrics(m, None) for s, m in SC.items()}
i = np.where((r.race_date == pd.Timestamp('2026-09-27')).values & (r.venue_code.values == 20) & (r.race_number.values == 12))[0][0]
out['example'] = {'race': '2026-09-27 若松12R', 'motor': [round(float(x), 2) for x in mot[i]], 'motor_rank': [int(x) for x in motr[i]],
                  'exh': [round(float(x), 2) for x in exh[i]], 'exh_rank': [int(x) for x in exhr[i]],
                  'actual_forms': [FORMS[k] for k in range(7) if F[i, k]] if POP[i] else 'not in POP',
                  'in_pop': bool(POP[i]), 'result': [int(r1[i]), int(r2[i]), int(r.rank3.values[i])], 'technique': TK[tk.get((srcs[i], ymd[i], 20), '_'*12)[11]]}
print(out['example'])
json.dump(out, open(H + '/mark1.json', 'w'), ensure_ascii=False, indent=1)
print('saved')
