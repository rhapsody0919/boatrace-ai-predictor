# BOA-271 v16 T1-2: 今節の平均着順点（前日まで）の走数の絞り込み（事前登録 preregistration-t1.md「共通」「T1-2」、コミット 238e0bb5a）
# 定義: spec FR-A A-4（Q6）、mock-v16/series-score.md（as-of だけ「前日まで」に変える）、tab1_facts.py（一番高い/低いときの数え方・同じ値）
# 実行: ANALOGY_SCRATCH=~/boatrace-data-archive/boa271-fr2-scratch-2026-10-04 \
#       $ANALOGY_SCRATCH/model-prep/venv/bin/python scripts/analysis/analogy-finder-t1/t1_2_series_runs.py
import os, sys, json, hashlib
import numpy as np, pandas as pd

SCR = os.environ.get('ANALOGY_SCRATCH')
if not SCR:
    sys.exit('ANALOGY_SCRATCH が未設定（スクラッチのディレクトリを渡す）')
SCR = os.path.expanduser(SCR)
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(REPO, 'docs/design/analogy-finder/analysis/t1/t1-2-series-runs.json')

P_ROWS = os.path.join(SCR, 'tab1/series_score_rows.pkl')
P_RACES = os.path.join(SCR, 'knn/work2/races.pkl')
P_BOATS = os.path.join(SCR, 'knn/work2/boats.npz')
P_ROUNDS = os.path.join(SCR, 't1/rounds.csv')
P_MANI = os.path.join(SCR, 'model-prep/data/fetch_manifest.json')

PERIODS = {'P1': ('2019-04-01', '2022-09-30'), 'P2': ('2022-10-01', '2026-09-26')}
LAYERS = ['m0', 'm1', 'm2', 'm3', 'm4p']        # m=0（参考）・1・2・3・4以上
OUTS = ['win', 'top2', 'top3']                   # 1着・2着以内・3着以内
SDAYS = ['1', '2', '3', '4', '5', '6', '7p']     # 節の日目（races.pkl series_day。7・8日目はまとめる）
KS = [0, 2, 3, 4]
NB, SEED = 200, 0
EX_RID = 202609272012                            # 例のレース 2026-09-27 若松12R
SAMPLE_FROM, NSAMPLE = pd.Timestamp('2025-06-01'), 200


def sha256(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for ch in iter(lambda: f.read(1 << 20), b''): h.update(ch)
    return h.hexdigest()


def wilson(k, n, z=1.96):
    if n == 0: return (None, None, None)
    p = k / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d
    h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (p, c - h, c + h)


r4 = lambda x: None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), 4)

# ---- 1. 前日までの値（Q6）を行から作り直す
rows = pd.read_pickle(P_ROWS)
inputs = {'series_score_rows.pkl': {'path': 'tab1/series_score_rows.pkl', 'rows': int(len(rows)),
                                    'max_date': str(rows.race_date.max().date()), 'sha256': sha256(P_ROWS)}}
day = (rows.groupby(['racer_id', 'series_key', 'race_date'], sort=True)[['pts', 'cnt']].sum().reset_index())
g = day.groupby(['racer_id', 'series_key'], sort=False)
day['pd_pts'] = g['pts'].cumsum() - day['pts']   # レースの日より前の日の合計（同じ日の走は含めない）
day['pd_n'] = g['cnt'].cumsum() - day['cnt']
rows = rows.merge(day[['racer_id', 'series_key', 'race_date', 'pd_pts', 'pd_n']],
                  on=['racer_id', 'series_key', 'race_date'], how='left')
rows['v_pd'] = np.where(rows.pd_n > 0, rows.pd_pts / rows.pd_n.where(rows.pd_n > 0), np.nan)
# 検査: 同じ日の2走目以降は「前日まで」と「直前まで」が違う。1日の初走は同じ
first_of_day = rows.groupby(['racer_id', 'series_key', 'race_date']).race_number.transform('min') == rows.race_number
chk_first = bool(np.allclose(rows.loc[first_of_day, 'v_pd'].fillna(-1), rows.loc[first_of_day, 'value'].fillna(-1)))
assert chk_first, '1日の初走で前日までと直前までが一致しない'

# ---- 2. レース（knn/work2 の並び）に載せる
r = pd.read_pickle(P_RACES); B = np.load(P_BOATS)
inputs['races.pkl'] = {'path': 'knn/work2/races.pkl', 'rows': int(len(r)), 'max_date': str(r.race_date.max().date()), 'sha256': sha256(P_RACES)}
inputs['boats.npz'] = {'path': 'knn/work2/boats.npz', 'rows': int(B['cls_ord'].shape[0]), 'sha256': sha256(P_BOATS)}
N = len(r)
pos_of = pd.Series(np.arange(N), index=r.race_id.values)
sub = rows[rows.race_id.isin(pos_of.index) & rows.boat_number.between(1, 6)]
ii = pos_of[sub.race_id.values].values; bj = sub.boat_number.values.astype(int) - 1
V = np.full((N, 6), np.nan); V[ii, bj] = sub.v_pd.values
NP = np.zeros((N, 6)); NP[ii, bj] = sub.pd_n.values   # 前日までの走数（行が無い艇は0）
NP[np.isnan(V)] = 0                                   # 値の無い艇は0（事前登録）
m = NP.min(1).astype(int)
layer = np.minimum(m, 4)                              # 0..4（4＝4以上）

# 準優勝戦・優勝戦（T1-1 v2 の round_new）
rc = pd.read_csv(P_ROUNDS, usecols=['race_id', 'round_new'])
inputs['rounds.csv'] = {'path': 't1/rounds.csv', 'rows': int(len(rc)), 'max_date': str(rc.race_id.str[:10].max()), 'sha256': sha256(P_ROUNDS)}
rc['rid'] = rc.race_id.str.replace('-', '', regex=False).astype('int64')
rnd = pd.Series(rc.round_new.values, index=rc.rid.values).reindex(r.race_id.values).values
n_no_round = int(pd.isna(rnd[r.is_pool.values]).sum())
pool = r.is_pool.values
semi_final = np.isin(rnd, ['junyu', 'yusho'])
dates = r.race_date.values
ranks = np.stack([r.rank1, r.rank2, r.rank3], 1)
HIT = np.stack([np.stack([ranks[:, 0] == b, (ranks[:, :2] == b).any(1), (ranks[:, :3] == b).any(1)], 1)
                for b in range(1, 7)], 1)  # (N, 6艇, 3着順)

# 一番高い/低いとき（tab1_facts.py と同じ。同じ値は両方に入る。値の無い艇は数えない）
with np.errstate(all='ignore'):
    best = np.nanmax(V, 1); worst = np.nanmin(V, 1)
ok = ~np.isnan(V)
TOP = ok & np.isclose(V, best[:, None]); BOT = ok & np.isclose(V, worst[:, None])
sday = np.minimum(r.series_day.values.astype(int), 7) - 1

# ---- 3. S(m)：日単位の集計 → 点推定とブートストラップ
# X[day, sday, layer, boat, tb, (n, win, top2, top3)]
def S_from(agg):
    """agg[..., layer, boat, tb, 4] → S[..., layer, out]（pt）。艇番ごとの差も返す"""
    n = agg[..., 0]; h = agg[..., 1:]
    with np.errstate(all='ignore'):
        rate = h / n[..., None]
    diff = rate[..., 0, :] - rate[..., 1, :]          # [..., layer, boat, out]
    return diff.mean(-2) * 100, diff * 100              # 1艇でも件数0なら NaN


results = {}
for pk, (a, b_) in PERIODS.items():
    sel = pool & ~semi_final & (dates >= np.datetime64(a)) & (dates <= np.datetime64(b_))
    idx = np.where(sel)[0]
    ud, dinv = np.unique(dates[idx], return_inverse=True)
    X = np.zeros((len(ud), 7, 5, 6, 2, 4))
    for tb, F in ((0, TOP), (1, BOT)):
        for bb in range(6):
            f = F[idx, bb]
            j = idx[f]
            base = (dinv[f], sday[j], layer[j], np.full(len(j), bb), np.full(len(j), tb))
            np.add.at(X, base + (0,), 1)
            for o in range(3):
                np.add.at(X, base + (o + 1,), HIT[j, bb, o].astype(float))
    tot = X.sum(0)                     # (7, 5, 6, 2, 4)
    agg = tot.sum(0)                   # (5, 6, 2, 4)
    S, D = S_from(agg)                 # S (5, 3)
    Sd, _ = S_from(tot)                # (7, 5, 3)
    rng = np.random.default_rng(SEED)
    W = np.stack([np.bincount(rng.integers(0, len(ud), len(ud)), minlength=len(ud)) for _ in range(NB)]).astype(float)
    Xb = np.tensordot(W, X.reshape(len(ud), -1), axes=(1, 0)).reshape((NB,) + X.shape[1:])
    Sb, _ = S_from(Xb.sum(1))          # (NB, 5, 3)
    Sdb, _ = S_from(Xb)                # (NB, 7, 5, 3)
    q = lambda arr: [r4(np.nanpercentile(arr, 2.5)), r4(np.nanpercentile(arr, 97.5))]
    lay_n = np.array([int(((layer[idx]) == L).sum()) for L in range(5)])
    res = {'races': int(len(idx)), 'days': int(len(ud)),
           'layer_share': {LAYERS[L]: {'n': int(lay_n[L]), 'share': r4(lay_n[L] / len(idx))} for L in range(5)},
           'S': {}, 'diff_vs_m4p': {}, 'k_star': {}, 'by_boat': {}, 'by_series_day': {}}
    for o, on in enumerate(OUTS):
        res['S'][on] = {LAYERS[L]: {'S_pt': r4(S[L, o]), 'boot95': q(Sb[:, L, o])} for L in range(5)}
        res['diff_vs_m4p'][on] = {LAYERS[L]: {'diff_pt': r4(S[L, o] - S[4, o]), 'boot95': q(Sb[:, L, o] - Sb[:, 4, o])} for L in range(4)}
        kstar = next(k for k in (1, 2, 3, 4) if S[k, o] >= S[4, o] - 2)
        res['k_star'][on] = int(kstar)
        res['by_boat'][on] = {}
        for L in range(5):
            res['by_boat'][on][LAYERS[L]] = {}
            for bb in range(6):
                t_ = agg[L, bb, 0]; bt_ = agg[L, bb, 1]
                wt = wilson(t_[o + 1], t_[0]); wb = wilson(bt_[o + 1], bt_[0])
                res['by_boat'][on][LAYERS[L]][str(bb + 1)] = {
                    'top': {'hit': int(t_[o + 1]), 'n': int(t_[0]), 'rate': r4(wt[0]), 'wilson95': [r4(wt[1]), r4(wt[2])]},
                    'bottom': {'hit': int(bt_[o + 1]), 'n': int(bt_[0]), 'rate': r4(wb[0]), 'wilson95': [r4(wb[1]), r4(wb[2])]},
                    'diff_pt': r4(D[L, bb, o])}
        res['by_series_day'][on] = {}
        for sd in range(7):
            res['by_series_day'][on][SDAYS[sd]] = {}
            for L in range(5):
                nr = int(((sday[idx] == sd) & (layer[idx] == L)).sum())
                if nr == 0: continue
                res['by_series_day'][on][SDAYS[sd]][LAYERS[L]] = {'races': nr, 'S_pt': r4(Sd[sd, L, o]), 'boot95': q(Sdb[:, sd, L, o])}
    results[pk] = res
    print(pk, 'races', len(idx), 'share', res['layer_share'], 'S win', {k: v['S_pt'] for k, v in res['S']['win'].items()}, 'k*', res['k_star'])

kstar_final = {on: max(results['P1']['k_star'][on], results['P2']['k_star'][on]) for on in OUTS}

# ---- 4. 画面への影響（今節の平均着順点のカードだけ）
cls = B['cls_ord'].astype(int)
comp = np.zeros(N, dtype=int)
for c in range(1, 5): comp = comp * 10 + (cls == c).sum(1)   # 級別の組み合わせ（艇番を問わない構成）
venue = r.venue_code.values


def card(mask, bb, o):
    t = mask & TOP[:, bb]; bt = mask & BOT[:, bb]
    nt, nb = int(t.sum()), int(bt.sum())
    if nt == 0 or nb == 0: return 'no_data', None
    ht, hb = int(HIT[t, bb, o].sum()), int(HIT[bt, bb, o].sum())
    wt, wb = wilson(ht, nt), wilson(hb, nb)
    d = (wt[0] - wb[0]) * 100
    if wt[1] <= wb[2] and wb[1] <= wt[2]: j = 'unclear'
    elif abs(d) >= 5: j = 'large'
    else: j = 'small'
    return j, {'top': [ht, nt], 'bottom': [hb, nb], 'diff_pt': r4(d)}


def eval_race(ri, boats=range(6)):
    d0 = dates[ri]; base = pool & (dates < d0)
    out = []
    for bb in boats:
        nc0 = base & (comp == comp[ri]) & (cls[:, bb] == cls[ri, bb])
        vc0 = nc0 & (venue == venue[ri])
        for k in KS:
            vc = vc0 & (m >= k); nc = nc0 & (m >= k)
            nvc = int(vc.sum()); dflt = 'VC' if nvc >= 300 else 'NC'
            rec = {'race_id': int(r.race_id.values[ri]), 'boat': bb + 1, 'k': k, 'vc_n': nvc, 'nc_n': int(nc.sum()), 'default': dflt}
            for o, on in enumerate(OUTS):
                jv, dv = card(vc, bb, o); jd, dd = (jv, dv) if dflt == 'VC' else card(nc, bb, o)
                rec[on] = {'VC': jv, 'default': jd, 'VC_detail': dv, 'default_detail': dd}
            out.append(rec)
    return out


def summarize(recs):
    df = pd.DataFrame(recs); s = {}
    for k in KS:
        dk = df[df.k == k]; s[str(k)] = {}
        for scope, dd in (('boat1', dk[dk.boat == 1]), ('all_boats', dk)):
            e = {'cards': int(len(dd)), 'vc_n_median': r4(float(dd.vc_n.median())), 'vc_lt300_share': r4(float((dd.vc_n < 300).mean())),
                 'nc_n_median': r4(float(dd.nc_n.median())), 'judgment': {}}
            for on in OUTS:
                e['judgment'][on] = {}
                for rng_ in ('VC', 'default'):
                    vc_ = dd[on].map(lambda x: x[rng_]).value_counts()
                    e['judgment'][on][rng_] = {j: {'n': int(vc_.get(j, 0)), 'share': r4(vc_.get(j, 0) / len(dd))} for j in ('large', 'small', 'unclear', 'no_data')}
            s[str(k)][scope] = e
    return s


ex_i = int(pos_of[EX_RID])
ex_recs = eval_race(ex_i)
ex_m = {'prior_runs_by_boat': {str(b + 1): int(NP[ex_i, b]) for b in range(6)}, 'm': int(m[ex_i]),
        'value_by_boat': {str(b + 1): r4(V[ex_i, b]) for b in range(6)}}
cand = np.where(pool & (dates >= np.datetime64(SAMPLE_FROM)))[0]
samp = np.sort(np.random.default_rng(SEED).choice(cand, NSAMPLE, replace=False))
samp_recs = []
for ri in samp: samp_recs += eval_race(ri)
screen = {'example_race': {'race_id': EX_RID, 'prior_runs': ex_m, 'summary': summarize(ex_recs), 'cards': ex_recs},
          'sample200': {'from': str(SAMPLE_FROM.date()), 'candidates': int(len(cand)), 'race_ids': [int(x) for x in r.race_id.values[samp]],
                        'rounds_in_sample': pd.Series(rnd[samp]).value_counts().to_dict(),
                        'summary': summarize(samp_recs)}}
for k in KS:
    print('k', k, 'ex boat1', screen['example_race']['summary'][str(k)]['boat1']['vc_n_median'],
          'sample', screen['sample200']['summary'][str(k)]['all_boats']['vc_n_median'], screen['sample200']['summary'][str(k)]['all_boats']['vc_lt300_share'])

mani = json.load(open(P_MANI))
out = {
    'preregistration': {'file': 'docs/design/analogy-finder/analysis/t1/preregistration-t1.md', 'section': '共通・T1-2（レビュー指摘2・3・9）', 'commit': '238e0bb5a'},
    'definition': {
        'value': '今節の平均着順点（前日まで）: series_score_rows.pkl の走から、同じ選手・同じ節（series_key）でレースの日より前の日の走の pts 合計 ÷ cnt 合計（同じ日の前の走は含めない。spec Q6）。prior が0なら値なし',
        'm': 'そのレースの6艇の前日までの走数（pd_n）の最小値。値の無い艇は0',
        'S': '層の中で、艇番ごとに「6艇で一番高いときの率 − 一番低いときの率」（同じ値は両方に入る。tab1_facts.py と同じ）を1〜6号艇で単純平均（pt）',
        'population': '全国（NA）、races.pkl の is_pool（2019-04-01〜2026-09-26 の完全レース）から、t1/rounds.csv の round_new が junyu・yusho のレースを除く',
        'periods': PERIODS,
        'k_star_rule': 'k* ＝ S(m=k) ≥ S(m≥4) − 2pt となる最小の k（k∈{1,2,3,4}）。P1・P2 で違えば大きいほう。1着で判定、2着以内・3着以内は参考',
        'bootstrap': f'日（race_date）単位の復元抽出 {NB} 回、seed {SEED}（期間ごとに default_rng({SEED}) を作り直す）。95% は 2.5/97.5 パーセンタイル',
        'screen_card_judgment': 'spec A-7: 一番高い/低いときの Wilson95 が重なる→unclear、重ならず |差|≥5pt→large、<5pt→small。どちらかが0件→no_data',
    },
    'inputs': inputs,
    'upstream_manifest': {'path': 'model-prep/data/fetch_manifest.json', 'sha256': sha256(P_MANI), 'content': mani},
    'checks': {'first_run_of_day_equals_mock_value': chk_first, 'pool_races_without_round_new': n_no_round,
               'pool_races': int(pool.sum()), 'pool_semi_final_excluded': int((pool & semi_final).sum())},
    'results': results,
    'judgment': {'k_star_by_period': {pk: results[pk]['k_star'] for pk in PERIODS}, 'k_star_final': kstar_final,
                 'main': {'outcome': 'win', 'k_star': kstar_final['win'],
                          'reading': ('序盤の値でも差は小さくならない → 絞らない' if kstar_final['win'] == 1 else
                                      f"{kstar_final['win']} 走未満の値が混ざると差が小さく出る")}},
    'screen_impact': screen,
    'notes': [
        '準優勝戦・優勝戦の除外は t1/rounds.csv の round_new（T1-1 最終版ルール v2）。race_id は YYYY-MM-DD-VV-RR を数値に変換して突き合わせた',
        'm=0 の層（どれかの艇に前日までの値が無い。節の初日など）は判定に使わず参考として出す',
        '日目は races.pkl の series_day。7日目・8日目（計 3,658 レース程度）は「7p」にまとめた',
        '日目別の S(m) は、1艇でも一番高い/低いときの件数が0の組は NaN（null）',
        '画面への影響は、今の画面の範囲どおり準優勝戦・優勝戦を除かずに数えた（VC・NC はラウンドを問わない）。各レースより前の日の母集団（is_pool かつ race_date < そのレースの日）で数える（spec「数えるレース」の実測と同じ as-of）',
        '画面への影響の k による絞り込みは、VC・NC の両方に「6艇とも前日までの走が k 以上（m ≥ k）」をかける。k=0 は今の数え方（値の無い艇は数えない）。既定（VC か NC）は絞った後の VC の件数で決める（300件未満なら NC）',
        '画面への影響は選んだ艇を1〜6号艇のすべてで数えた（boat1＝既定の1号艇、all_boats＝6艇ぶんのカード）。VC の件数は選んだ艇の級別で変わるので、件数の中央値・300件未満の割合も同じ単位（レース×選んだ艇）',
        '無作為の200レースは races.pkl の is_pool かつ race_date ≥ 2025-06-01 から numpy default_rng(0).choice（非復元）。ラウンドは問わない（準優勝戦・優勝戦も入りうる）',
        '例のレース（2026-09-27 若松12R 優勝戦）は母集団の外なので、前日までの値・走数は series_score_rows.pkl から同じ計算で出した',
        '級別の組み合わせは boats.npz の cls_ord（1=B2 … 4=A1）の構成（各級別の艇数）',
        'in-sample: モデルの評価ではなく、2019-04-01〜2026-09-26 のデータの記述。期間分割（P1・P2）で安定を見る',
    ],
}
with open(OUT, 'w') as f:
    json.dump(out, f, ensure_ascii=False, indent=1, default=lambda x: x.item() if hasattr(x, 'item') else str(x))
print('wrote', OUT)
