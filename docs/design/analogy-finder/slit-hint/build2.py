# slitpred2: 条件ごとの平均ST（as-of、前日までの走だけ）を艇単位で作り、races.pkl の並び（race×6艇）に揃えて保存する
import sys, os, time, numpy as np, pandas as pd
H = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, H + '/../model-prep/code-at-train')
import features as F
t0 = time.time()
def log(*a): print(f'[{time.time()-t0:6.0f}s]', *a, flush=True)

kb = F.load_kb(); log('kb', len(kb))
mn = F.load_main(); log('main', len(mn))
cols = ['race_id', 'race_date', 'venue_code', 'race_number', 'boat_number', 'racer_id', 'st_result',
        'is_flying', 'is_late', 'grade', 'wind_speed', 'wind_x', 'wind_y', 'wave_height']
df = pd.concat([kb[cols], mn[cols]], ignore_index=True); del kb, mn
df = F.attach_grade_from_series(df, pd.read_csv(F.D / 'race_series.csv')); log('grade attached')

# 枠なりマスク（slitpred と同じ raw/ の kbA・kbB・main）
mask = {}
for f in ['kbA', 'kbB', 'main']:
    src = 'kb' if f != 'main' else 'main'
    for t in open(H + f'/raw/{f}.txt').read().split(','):
        mask[(src, t[:6], int(t[6:8]))] = int(t[8:], 16)
rk = df[['race_id', 'race_date', 'venue_code', 'race_number']].drop_duplicates('race_id')
src = np.where(rk.race_date <= F.KB_END, 'kb', 'main'); ymd = rk.race_date.dt.strftime('%y%m%d').values
wk = np.full(len(rk), -1, np.int8)  # -1 不明 / 0 枠なりでない / 1 枠なり
for i, (s, d, v, n) in enumerate(zip(src, ymd, rk.venue_code.values, rk.race_number.values)):
    m = mask.get((s, d, int(v)))
    if m is not None: wk[i] = (m >> (int(n) - 1)) & 1
rk['waku'] = wk
df = df.merge(rk[['race_id', 'waku']], on='race_id', how='left'); log('waku', pd.Series(wk).value_counts().to_dict())

df['st_ok'] = df['st_result'].where(~df['is_flying'].astype(bool) & ~df['is_late'].astype(bool)).astype('float64')
df['course'] = np.where(df['waku'] == 1, df['boat_number'], 0).astype('int16')  # 0＝コース不明（枠なりでない・不明）
GCL = {'SG': 3, 'G1': 3, 'G2': 2, 'G3': 2, 'ippan': 1}
df['gcl'] = df['grade'].map(GCL).fillna(0).astype('int8')  # 0＝グレード不明
df['racer_id'] = pd.to_numeric(df['racer_id'], errors='coerce')
df = df[df['racer_id'].notna()].copy(); df['racer_id'] = df['racer_id'].astype('int64')

def asof(df, extra, mp):
    """racer×extra の中で、その走より前の30走（F・出遅れは平均から除き、窓には数える）の平均と本数。
    当日の走は入れない（features._first_of_day と同じ: その日のグループ内最初の走の値を配る）"""
    keys = ['racer_id'] + extra
    d = df.sort_values(keys + ['race_date', 'race_number', 'race_id'])
    g = [d[k] for k in keys]
    prev = d.groupby(g, sort=False)['st_ok'].shift(1)
    roll = prev.groupby(g, sort=False).rolling(30, min_periods=1)
    m = roll.mean().reset_index(level=list(range(len(keys))), drop=True)
    c = roll.count().reset_index(level=list(range(len(keys))), drop=True)
    kd = g + [d['race_date']]
    first = d.groupby(kd, sort=False).cumcount() == 0
    m = m.where(first).groupby(kd, sort=False).transform('max')
    c = c.where(first).groupby(kd, sort=False).transform('max')
    c = c.fillna(0)
    m = m.where(c >= mp)
    return m.reindex(df.index), c.reindex(df.index)

df['A_m'], df['A_n'] = asof(df, [], 3); log('A')
df['B_m'], df['B_n'] = asof(df, ['venue_code'], 1); log('B')
df['C_m'], df['C_n'] = asof(df, ['course'], 1); log('C')
df['D_m'], df['D_n'] = asof(df, ['gcl'], 1); log('D')
for k in ['C', 'D']:
    bad = (df['course'] == 0) if k == 'C' else (df['gcl'] == 0)
    df.loc[bad, k + '_m'] = np.nan; df.loc[bad, k + '_n'] = 0

# 風の区分（0〜2 / 3〜4 / 5以上）と方位4区分（風向の方位そのもの。会場ごとの追い風・向かい風は不明）
ws = df['wind_speed'].astype('float64')
df['wbin'] = np.select([ws <= 2, ws <= 4, ws > 4], [1, 2, 3], 0).astype('int8')
ang = (np.degrees(np.arctan2(df['wind_x'], df['wind_y'])) + 360) % 360
sec = (((ang + 45) % 360) // 90 + 1).astype('float64')  # 1北 2東 3南 4西
df['wsec'] = np.where(ws >= 3, np.nan_to_num(sec, nan=0), 0).astype('int8')  # 3m未満は方位を問わない＝0

def cum_group(df, keys, mp):
    """全選手: keys×コースの、その日より前の全期間の本番 ST（F・出遅れ除く、コースが分かる枠なりレースだけ）の平均と本数"""
    v = df[(df['course'] > 0) & df['st_ok'].notna()]
    for k in keys: v = v[v[k] > 0] if k in ('wbin',) else v
    a = v.groupby(keys + ['course', 'race_date'])['st_ok'].agg(['sum', 'count']).reset_index().sort_values(keys + ['course', 'race_date'])
    gg = a.groupby(keys + ['course'], sort=False)
    a['cs'] = gg['sum'].cumsum() - a['sum']; a['cn'] = gg['count'].cumsum() - a['count']
    # 対象日に走が無い組み合わせもあるので、asof マージ
    out_m = pd.Series(np.nan, index=df.index); out_n = pd.Series(0.0, index=df.index)
    t = df[df['course'] > 0][keys + ['course', 'race_date']].copy(); t['_i'] = t.index
    t = t.sort_values('race_date'); a2 = a.sort_values('race_date')
    a2['cs2'] = a2['cs'] + a2['sum']; a2['cn2'] = a2['cn'] + a2['count']  # その日までの累計（その日を含む）
    a2 = a2.rename(columns={'race_date': 'd'})
    a2['d1'] = a2['d'] + pd.Timedelta(days=1)  # 翌日以降のレースに使える
    mg = pd.merge_asof(t, a2[keys + ['course', 'd1', 'cs2', 'cn2']].sort_values('d1'), left_on='race_date', right_on='d1',
                       by=keys + ['course'], direction='backward', allow_exact_matches=True)
    n = mg['cn2'].fillna(0).values; m = np.where(n >= mp, mg['cs2'].values / np.maximum(n, 1), np.nan)
    out_m.loc[mg['_i'].values] = m; out_n.loc[mg['_i'].values] = n
    return out_m, out_n

df['E_m'], df['E_n'] = cum_group(df, ['venue_code'], 1); log('E')
df['F_m'], df['F_n'] = cum_group(df, ['venue_code', 'wbin'], 1); log('F')
df.loc[df['wbin'] == 0, ['F_m']] = np.nan
df['F2_m'], df['F2_n'] = cum_group(df, ['venue_code', 'wbin', 'wsec'], 1); log('F2')
df.loc[df['wbin'] == 0, ['F2_m']] = np.nan

keep = ['race_id', 'boat_number', 'racer_id', 'course', 'gcl', 'wbin', 'wsec', 'wind_speed', 'wave_height', 'st_ok', 'waku'] + \
       [f'{k}_{s}' for k in ['A', 'B', 'C', 'D', 'E', 'F', 'F2'] for s in 'mn']
df[keep].to_pickle(H + '/work2_boats.pkl'); log('saved', len(df))
