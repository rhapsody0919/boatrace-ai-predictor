# 2着以内・3着以内への効き目（周回・まわり足・直線・展示タイム）と、2〜6コースの「まくり」「まくり差し」での1着
# boats.pkl（build.py の出力）を使う。結果は stdout と data/analysis/original-exhibition/top2-top3-makuri.json
#
# モデル: レースで条件づけた「6艇から m 艇が選ばれる」条件付きロジスティック回帰（m=1 は前回の6艇 softmax と同じ）
#   P(上位 m 艇の組 S) = exp(Σ_{i∈S} s_i) / Σ_{|T|=m} exp(Σ_{j∈T} s_j)、s_i = x_i·w。6艇なので組は 6/15/20 通りで全列挙できる
#   Plackett-Luce（上位 m 着の順番まで使う）ではなくこちらを主にした理由: 問いが「2着以内・3着以内に入るか」で順番を問わないこと、
#   PL は1着と2・3着に同じ係数を仮定するので、2・3着だけに効く項目があっても1着の分と混ざって見えにくいこと。
#   参考として「着順ごとの段階モデル」（1着が決まった後の残り5艇で2着、残り4艇で3着の softmax）も出す
# 推定: ニュートン法（解析的なヘッセ行列）。区間: 日単位ブートストラップ 300 回（前回と同じ）。時系列: 学習 〜10/03・検証 10/04〜、レース単位ブートストラップ 2,000 回
import pandas as pd, numpy as np, os, json, hashlib, itertools
from scipy.stats import norm
from common import WORK, OUT_DIR, JA, wil, fmt, grp

P = print
SPLIT = '2026-10-03'   # 時系列の分割日（前回と同じ）
B = int(os.environ.get('OX_BOOT', '300'))
rng = np.random.default_rng(4)

b = pd.read_pickle(os.path.join(WORK, 'boats.pkl'))
for c in range(2, 7): b[f'c{c}'] = (b.entry_course == c).astype(float)
for c in ['lap', 'mawari', 'straight', 'exhibition_time', 'win_rate', 'motor_2rate']:
  sg = -1 if c in ('lap', 'mawari', 'straight', 'exhibition_time') else 1
  b[c+'_f'] = (sg*b[c+'_z']).clip(-3, 3)   # analyze.py と同じ: 速いほど+、±3で切る
b['c1'] = (b.entry_course == 1).astype(float)
CO = [f'c{c}' for c in range(2, 7)]
ITEMS = ['lap', 'mawari', 'straight']
OUTS = {1: '1着', 2: '2着以内', 3: '3着以内'}
out = {}

# ---------- モデル ----------
SUBS = {m: np.array([[1.0 if j in T else 0.0 for j in range(6)] for T in itertools.combinations(range(6), m)]) for m in (1, 2, 3)}

def arrays(df, feats):
  df = df.sort_values(['race_id', 'boat_number'])
  X = df[feats].to_numpy(float).reshape(-1, 6, len(feats)); R = df.finish_rank.to_numpy(int).reshape(-1, 6)
  return X, R, df.race_date.to_numpy()[::6]

def subset_ll(w, X, R, m):
  """レースごとの -対数尤度（上位 m 艇の組）。時系列の検証で使う"""
  M = SUBS[m]; s = X@w                      # (n,6)
  t = s@M.T                                 # (n,nsub)
  t = t - t.max(1, keepdims=True); lse = np.log(np.exp(t).sum(1)); pT = np.exp(t - lse[:, None])
  y = (R <= m).astype(float)
  ll = -((y*s).sum(1) - (s@M.T).max(1) - lse)  # 組の得点は Σ_{i∈S} s_i
  q = pT@M                                  # 各艇が上位 m に入る確率
  g = -((y - q)[:, :, None]*X).sum((0, 1))
  return ll, g

def newton(grad_hess, w):
  """ニュートン法（凸なので数回で収束）。grad_hess(w) -> (勾配, ヘッセ行列)、どちらも -対数尤度のもの"""
  for _ in range(50):
    g, H = grad_hess(w); step = np.linalg.solve(H, g); w = w - step
    if np.abs(step).max() < 1e-8: return w
  raise RuntimeError('ニュートン法が50回で収束しない')

def set_gh(w, X, R, m):
  """上位 m 艇の組モデルの -対数尤度の勾配とヘッセ行列"""
  M = SUBS[m]; Z = np.einsum('tj,rjk->rtk', M, X)   # 組ごとの特徴量の和 (n,nsub,k)
  t = Z@w; t = t - t.max(1, keepdims=True); pT = np.exp(t); pT /= pT.sum(1, keepdims=True)
  mu = np.einsum('rt,rtk->rk', pT, Z); y = (R <= m).astype(float)
  g = -(np.einsum('rj,rjk->k', y, X) - mu.sum(0))
  H = np.einsum('rt,rtk,rtl->kl', pT, Z, Z) - mu.T@mu
  return g, H

def stage_gh(w, X, R, k):
  """段階モデル（k着を、k-1着までに入らなかった艇から選ぶ softmax）の勾配とヘッセ行列"""
  s = X@w; s = np.where(R >= k, s, -np.inf); s = s - s.max(1, keepdims=True)
  p = np.where(R >= k, np.exp(s), 0.0); p /= p.sum(1, keepdims=True)
  mu = np.einsum('rj,rjk->rk', p, X); y = (R == k).astype(float)
  g = -(np.einsum('rj,rjk->k', y, X) - mu.sum(0))
  H = np.einsum('rj,rjk,rjl->kl', p, X, X) - mu.T@mu
  return g, H

def fit(X, R, kind, m, w_init=None):
  gh = (lambda w: set_gh(w, X, R, m)) if kind == 'set' else (lambda w: stage_gh(w, X, R, m))
  return newton(gh, np.zeros(X.shape[2]) if w_init is None else w_init)

def boot(df, feats, kind, m, idx):
  """係数（idx 番目）の点推定と日単位ブートストラップ 95% 区間"""
  X, R, d = arrays(df, feats); w0 = fit(X, R, kind, m)
  days = np.unique(d); by = {dd: (X[d == dd], R[d == dd]) for dd in days}; bs = []
  for _ in range(B):
    pick = rng.choice(days, len(days)); Xb = np.concatenate([by[p][0] for p in pick]); Rb = np.concatenate([by[p][1] for p in pick])
    bs.append(fit(Xb, Rb, kind, m, w0))  # 点推定から始める（解は同じ、速い）
  bs = np.array(bs)
  return {'coef': float(w0[idx]), 'ci95': [float(np.percentile(bs[:, idx], 2.5)), float(np.percentile(bs[:, idx], 97.5))], 'races': int(len(R))}

def s(r): return f"{r['coef']:+.3f} [{r['ci95'][0]:+.3f}, {r['ci95'][1]:+.3f}]"

def prep(it, full):
  """項目 it の6艇がそろうレース。full=True なら勝率・モーター2連率も6艇そろうレースに絞る"""
  x = b[b[it+'_z'].notna()].copy()
  x['exhibition_time_f'] = x.exhibition_time_f.fillna(0)
  if full:
    ok = x.groupby('race_id').win_rate_z.transform(lambda q: q.notna().all()) & x.groupby('race_id').motor_2rate_z.transform(lambda q: q.notna().all())
    x = x[ok]
  return x

P('## 0 母数'); P('採用R', b.race_id.nunique(), '期間', b.race_date.min(), b.race_date.max())
out['dataset'] = {'races': int(b.race_id.nunique()), 'boats': int(len(b)), 'date_min': str(b.race_date.min()), 'date_max': str(b.race_date.max())}
raw = os.path.join(WORK, 'raw.json')
if os.path.exists(raw):
  out['dataset'] |= {'raw_sha256': hashlib.sha256(open(raw, 'rb').read()).hexdigest(), 'raw_fetched_at': json.load(open(raw)).get('fetched_at')}

# ---------- A 率の表 ----------
P('\n## A1 展示タイム区分 × 項目区分 の2着以内率・3着以内率（2〜6コース。行=展示タイム、列=項目）')
G = ['上位1-2', '中位3-4', '下位5-6']; out['table_exh_x_item'] = {}
for it in ITEMS:
  x = b[b[it+'_rank'].notna() & b.exhibition_time_rank.notna() & (b.entry_course >= 2)].copy()
  x['eg'] = grp(x.exhibition_time_rank); x['og'] = grp(x[it+'_rank'])
  for col in ['top2', 'top3']:
    T = {og: {eg: fmt(int(x[(x.eg == eg) & (x.og == og)][col].sum()), int(((x.eg == eg) & (x.og == og)).sum())) for eg in G} for og in G}
    P(f'\n### {JA[it]} {col}'); P(pd.DataFrame(T).to_string())
    out['table_exh_x_item'][f'{it}|{col}'] = {og: {eg: [int(x[(x.eg == eg) & (x.og == og)][col].sum()), int(((x.eg == eg) & (x.og == og)).sum())] for eg in G} for og in G}

P('\n## A2 「6艇で一番」の印（1位 vs それ以外）の2着以内率・3着以内率')
out['first_mark'] = {}
for it in ITEMS + ['exhibition_time']:
  x = b[b[it+'_rank'].notna()]; one = x[it+'_rank'] == 1
  for lab, m in [('1コース', x.entry_course == 1), ('2〜6コース', x.entry_course >= 2)]:
    y = x[m]; o = one[m]; row = {}
    for col in ['win', 'top2', 'top3']:
      row[col] = {'first': [int(y[o][col].sum()), int(o.sum())], 'others': [int(y[~o][col].sum()), int((~o).sum())]}
    P(f'{JA[it]} [{lab}] ' + ' | '.join(f"{OUTS[i+1]} 1位 {fmt(*row[c]['first'])} 他 {wil(*row[c]['others'])[0]:.3f}" for i, c in enumerate(['win', 'top2', 'top3'])))
    out['first_mark'][f'{it}|{lab}'] = row
  if it != 'exhibition_time':
    x2 = x[x.exhibition_time_rank.notna() & (x.entry_course >= 2)]; e = grp(x2.exhibition_time_rank); o = x2[it+'_rank'] == 1
    for col in ['top2', 'top3']:
      P(f'   展示タイム区分ごと(2〜6) {col}: ' + ' | '.join(f"{g_}: 1位 {fmt(int(x2[(e == g_) & o][col].sum()), int(((e == g_) & o).sum()))} 他 {wil(int(x2[(e == g_) & ~o][col].sum()), int(((e == g_) & ~o).sum()))[0]:.3f}" for g_ in G))
      out['first_mark'][f'{it}|2〜6コース|展示区分内|{col}'] = {g_: {'first': [int(x2[(e == g_) & o][col].sum()), int(((e == g_) & o).sum())], 'others': [int(x2[(e == g_) & ~o][col].sum()), int(((e == g_) & ~o).sum())]} for g_ in G}

# ---------- B 条件付きロジット ----------
P(f'\n## B 条件付きロジット（上位 m 艇の組、1SD あたり、日単位ブートストラップ {B} 回）')
out['logit'] = {}
for m in (1, 2, 3):
  for it in ITEMS:
    x = prep(it, False); xf = prep(it, True)
    for name, feats, dd in [('単独', CO+[it+'_f'], x), ('+展示タイム', CO+['exhibition_time_f', it+'_f'], x),
                            ('+展示タイム+勝率+モーター', CO+['exhibition_time_f', 'win_rate_f', 'motor_2rate_f', it+'_f'], xf)]:
      r = boot(dd, feats, 'set', m, len(feats)-1); out['logit'][f'{OUTS[m]}|{it}|{name}'] = r
      P(f'{OUTS[m]} {JA[it]} [{name}] R={r["races"]} {s(r)}')
    # 1コースと2〜6コースで傾きを分ける
    for name, base, dd in [('+展示タイム', ['exhibition_time_f'], x), ('+展示タイム+勝率+モーター', ['exhibition_time_f', 'win_rate_f', 'motor_2rate_f'], xf)]:
      dd = dd.copy(); dd['i1'] = dd[it+'_f']*dd.c1; dd['io'] = dd[it+'_f']*(1-dd.c1); feats = CO+base+['i1', 'io']
      r1 = boot(dd, feats, 'set', m, len(feats)-2); ro = boot(dd, feats, 'set', m, len(feats)-1)
      out['logit'][f'{OUTS[m]}|{it}|{name}|1コース'] = r1; out['logit'][f'{OUTS[m]}|{it}|{name}|2〜6コース'] = ro
      P(f'   └ [{name}] 1コース {s(r1)} / 2〜6コース {s(ro)}')
  # 展示タイム自身
  x = b.copy(); xf = prep('exhibition_time', True)
  for name, feats, dd in [('単独', CO+['exhibition_time_f'], x), ('+勝率+モーター', CO+['win_rate_f', 'motor_2rate_f', 'exhibition_time_f'], xf)]:
    r = boot(dd, feats, 'set', m, len(feats)-1); out['logit'][f'{OUTS[m]}|exhibition_time|{name}'] = r
    P(f'{OUTS[m]} 展示タイム [{name}] R={r["races"]} {s(r)}')
  dd = xf.copy(); dd['i1'] = dd.exhibition_time_f*dd.c1; dd['io'] = dd.exhibition_time_f*(1-dd.c1); feats = CO+['win_rate_f', 'motor_2rate_f', 'i1', 'io']
  r1 = boot(dd, feats, 'set', m, len(feats)-2); ro = boot(dd, feats, 'set', m, len(feats)-1)
  out['logit'][f'{OUTS[m]}|exhibition_time|+勝率+モーター|1コース'] = r1; out['logit'][f'{OUTS[m]}|exhibition_time|+勝率+モーター|2〜6コース'] = ro
  P(f'   └ [+勝率+モーター] 1コース {s(r1)} / 2〜6コース {s(ro)}')

P('\n## B2 参考: 着順ごとの段階モデル（k着を、k-1着までに入らなかった艇から選ぶ）。土台=コース+展示タイム+勝率+モーター')
out['stage'] = {}
for k in (2, 3):
  for it in ITEMS + ['exhibition_time']:
    xf = prep(it, True)
    feats = CO+['win_rate_f', 'motor_2rate_f', 'exhibition_time_f'] if it == 'exhibition_time' else CO+['exhibition_time_f', 'win_rate_f', 'motor_2rate_f', it+'_f']
    r = boot(xf, feats, 'stage', k, len(feats)-1); out['stage'][f'{k}着|{it}'] = r
    P(f'{k}着（残り{7-k}艇から） {JA[it]} R={r["races"]} {s(r)}')

# ---------- C 時系列 ----------
P(f'\n## C 時系列（学習 〜{SPLIT} / 検証 翌日〜）。上位 m 艇の組の対数損失の差（込み−抜き、1レースあたり、負=改善）')
out['timesplit'] = {}
for m in (1, 2, 3):
  for it in ITEMS + ['exhibition_time']:
    bases = [('コース', CO, False), ('コース+勝率+モーター', CO+['win_rate_f', 'motor_2rate_f'], True)] if it == 'exhibition_time' else \
            [('コース+展示タイム', CO+['exhibition_time_f'], False), ('コース+展示タイム+勝率+モーター', CO+['exhibition_time_f', 'win_rate_f', 'motor_2rate_f'], True)]
    for bn, f0, full in bases:
      x = prep(it, full); f1 = f0+[it+'_f']
      tr = x[x.race_date <= SPLIT]; te = x[x.race_date > SPLIT]
      X0, R0, _ = arrays(tr, f0); X1, R1, _ = arrays(tr, f1); w0 = fit(X0, R0, 'set', m); w1 = fit(X1, R1, 'set', m)
      T0, S0, _ = arrays(te, f0); T1, S1, _ = arrays(te, f1)
      l0 = subset_ll(w0, T0, S0, m)[0]; d = subset_ll(w1, T1, S1, m)[0] - l0
      bs = [d[rng.integers(0, len(d), len(d))].mean() for _ in range(2000)]
      r = {'train_races': int(len(R0)), 'test_races': int(len(S0)), 'diff': float(d.mean()), 'ci95': [float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))], 'base_ll': float(l0.mean())}
      out['timesplit'][f'{OUTS[m]}|{it}|{bn}'] = r
      P(f'{OUTS[m]} {JA[it]} [{bn}] 学習{r["train_races"]}R 検証{r["test_races"]}R 差={r["diff"]:+.4f} [{r["ci95"][0]:+.4f}, {r["ci95"][1]:+.4f}] 抜きLL={r["base_ll"]:.4f}')

# ---------- D まくり・まくり差し ----------
P('\n## D 2〜6コースの艇が「まくり」「まくり差し」で1着になる割合（決まり手 = race_results.winning_technique）')
o = b[b.entry_course >= 2].copy()
o['mk'] = ((o.win == 1) & (o.winning_technique == 'まくり')).astype(int)
o['ms'] = ((o.win == 1) & (o.winning_technique == 'まくり差し')).astype(int)
o['mm'] = o.mk | o.ms
TJ = {'mk': 'まくり', 'ms': 'まくり差し', 'mm': 'まくり+まくり差し'}
P('2〜6コースの艇', len(o), 'まくり1着', int(o.mk.sum()), 'まくり差し1着', int(o.ms.sum()))
out['makuri'] = {'boats_2to6': int(len(o)), 'wins_makuri': int(o.mk.sum()), 'wins_makurizashi': int(o.ms.sum()),
                 'by_course_wins': {int(c): {'makuri': int(g.mk.sum()), 'makurizashi': int(g.ms.sum()), 'boats': int(len(g))} for c, g in o.groupby('entry_course')}}
out['makuri']['rates'] = {}
for it in ['straight', 'mawari', 'lap', 'exhibition_time']:
  y = o[o[it+'_rank'].notna()].copy(); y['g'] = grp(y[it+'_rank']); y['one'] = y[it+'_rank'] == 1
  for lab, m_ in [('2〜6コース', y.entry_course >= 2)] + [(f'{c}コース', y.entry_course == c) for c in range(2, 7)]:
    z = y[m_]; rec = {}
    for t in ['mk', 'ms', 'mm']:
      rec[t] = {g_: [int(z[z.g == g_][t].sum()), int((z.g == g_).sum())] for g_ in G} | {'1位': [int(z[z.one][t].sum()), int(z.one.sum())], '他': [int(z[~z.one][t].sum()), int((~z.one).sum())]}
    out['makuri']['rates'][f'{it}|{lab}'] = rec
    P(f'{JA[it]} [{lab}] ' + ' || '.join(f"{TJ[t]}: " + ' '.join(f"{k} {wil(*v)[0]:.3f}({v[1]})" for k, v in rec[t].items()) for t in ['mk', 'ms']))

P('\n### D2 展示タイム区分 × 項目区分（2〜6コース、まくり+まくり差しで1着の率）')
out['makuri']['table_exh_x_item'] = {}
for it in ['straight', 'mawari']:
  x = o[o[it+'_rank'].notna() & o.exhibition_time_rank.notna()].copy(); x['eg'] = grp(x.exhibition_time_rank); x['og'] = grp(x[it+'_rank'])
  T = {og: {eg: fmt(int(x[(x.eg == eg) & (x.og == og)].mm.sum()), int(((x.eg == eg) & (x.og == og)).sum())) for eg in G} for og in G}
  P(f'{JA[it]}'); P(pd.DataFrame(T).to_string())
  out['makuri']['table_exh_x_item'][it] = {og: {eg: [int(x[(x.eg == eg) & (x.og == og)].mm.sum()), int(((x.eg == eg) & (x.og == og)).sum())] for eg in G} for og in G}

# 艇単位のロジスティック回帰（2〜6コース。コース 3〜6 のダミー+展示タイム+項目(+勝率+モーター)）。区間は日単位ブートストラップ
# レース内で競う形（条件付きロジット）にしないのは、決まり手がまくりにならないレースが約7割あり、「誰がまくりで勝つか」をレースで条件づけると
# 「まくりで決まったレース」に絞ることになり結果で選ぶ形になるため
def logit_fit(X, y, w_init=None):
  def gh(w):
    p = 1/(1+np.exp(-(X@w))); return -X.T@(y-p), (X*(p*(1-p))[:, None]).T@X
  return newton(gh, np.zeros(X.shape[1]) if w_init is None else w_init)
def boot_logit(df, feats, ycol):
  X = np.column_stack([np.ones(len(df)), df[feats].to_numpy(float)]); y = df[ycol].to_numpy(float); d = df.race_date.to_numpy()
  w0 = logit_fit(X, y); days = np.unique(d); idx = {dd: np.where(d == dd)[0] for dd in days}; bs = []
  for _ in range(B):
    ii = np.concatenate([idx[p] for p in rng.choice(days, len(days))]); bs.append(logit_fit(X[ii], y[ii], w0))
  bs = np.array(bs); k = X.shape[1]-1
  return {'coef': float(w0[k]), 'ci95': [float(np.percentile(bs[:, k], 2.5)), float(np.percentile(bs[:, k], 97.5))], 'boats': int(len(df)), 'events': int(y.sum())}
P(f'\n### D3 艇単位ロジスティック回帰（2〜6コース、1SD あたり、日単位ブートストラップ {B} 回）')
out['makuri']['logit'] = {}
C3 = [f'c{c}' for c in range(3, 7)]
for it in ['straight', 'mawari', 'lap']:
  x = o[o[it+'_z'].notna()].copy(); x['exhibition_time_f'] = x.exhibition_time_f.fillna(0)
  xf = x[x.win_rate_f.notna() & x.motor_2rate_f.notna()]
  for t in ['mk', 'ms', 'mm']:
    # まくり差しは2コースでは起きない（0件）ので 3〜6コースに絞り、3コースを基準にする
    # まくりは6コースで9件しかなく、日の再抽出で0件になると係数が発散するので 2〜5コースに絞る
    if t == 'ms': cc, xx, xxf = C3[1:], x[x.entry_course >= 3], xf[xf.entry_course >= 3]
    elif t == 'mk': cc, xx, xxf = C3[:-1], x[x.entry_course <= 5], xf[xf.entry_course <= 5]
    else: cc, xx, xxf = C3, x, xf
    for name, feats, dd in [('単独', cc+[it+'_f'], xx), ('+展示タイム', cc+['exhibition_time_f', it+'_f'], xx),
                            ('+展示タイム+勝率+モーター', cc+['exhibition_time_f', 'win_rate_f', 'motor_2rate_f', it+'_f'], xxf)]:
      r = boot_logit(dd, feats, t); out['makuri']['logit'][f'{t}|{it}|{name}'] = r
      P(f'{TJ[t]} {JA[it]} [{name}] 艇{r["boats"]} 件{r["events"]} {s(r)}')

P('\n### D4 必要件数（上位1-2 と 下位5-6 の率の差を両側5%・検出力80%で言うのに各区分に要る艇数）')
def nneed(p1, p2):
  return float('inf') if p1 == p2 else (norm.ppf(.975)+norm.ppf(.8))**2*(p1*(1-p1)+p2*(1-p2))/(p1-p2)**2
out['makuri']['n_needed'] = {}
for it in ['straight', 'mawari']:
  for t in ['mk', 'ms', 'mm']:
    rec = out['makuri']['rates'][f'{it}|2〜6コース'][t]; p1 = wil(*rec['上位1-2'])[0]; p2 = wil(*rec['下位5-6'])[0]
    n = nneed(p1, p2); out['makuri']['n_needed'][f'{it}|{t}'] = {'p_top': p1, 'p_bottom': p2, 'n_per_group': n, 'n_now_top': rec['上位1-2'][1]}
    P(f'{JA[it]} {TJ[t]}: 上位 {p1:.3f} 下位 {p2:.3f} → 各区分 {n:.0f}（今 {rec["上位1-2"][1]}）')

json.dump(out, open(os.path.join(OUT_DIR, 'top2-top3-makuri.json'), 'w'), ensure_ascii=False, indent=1)
P('\n保存:', os.path.join(OUT_DIR, 'top2-top3-makuri.json'))
