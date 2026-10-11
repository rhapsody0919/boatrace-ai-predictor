"""本番の features.py（origin/master、PR #1121）で艇単位の特徴量を作り直し、レース単位の表 R2.pkl を作る。
ラベル（決まり手・1着艇・1着の進入コース）は MD-6 prep.py と同じ取り方。出力は scratchpad のみ。"""
import json, os, sys, time
from pathlib import Path
import numpy as np, pandas as pd

DATA = Path('/Users/terukina/boatrace-ai-predictor/.claude/worktrees/recursing-poincare-93292f/data/ml/analogy')
os.environ['ANALOGY_DATA_DIR'] = str(DATA)
sys.path.insert(0, str(Path(__file__).resolve().parent))
import features_prod as F  # noqa: E402

TECHS = ['逃げ', '差し', 'まくり', 'まくり差し', '抜き', '恵まれ']
PER = {'pool_cal': ('2019-04-01', '2025-05-31'), 'cal': ('2025-06-01', '2025-12-02'), 'test': ('2026-04-01', '2026-09-30')}

t = time.time()
df = F.build(DATA)
print('build', df.shape, round(time.time() - t), flush=True)
df = F.complete_races(df)
keep = ['race_id', 'race_date', 'venue_code', 'race_number', 'boat_number', 'grade_code', 'round_code', 'y_win',
        'cls_ord', 'nat_win', 'nat_win_rank', 'motor_2_rank', 'st_mean30_rank']
df = df[keep]
rd = df['race_date']
per = pd.Series('other', index=df.index)
for k, (a, b) in PER.items():
    per[(rd >= pd.Timestamp(a)) & (rd <= pd.Timestamp(b))] = k
df = df[per != 'other'].assign(period=per[per != 'other']).sort_values(['race_date', 'race_id', 'boat_number']).reset_index(drop=True)
assert (df.groupby('race_id').size() == 6).all()
r = df[df.boat_number == 1][['race_id', 'race_date', 'venue_code', 'race_number', 'grade_code', 'round_code', 'period']].reset_index(drop=True)
n = len(r)
for c in ['cls_ord', 'nat_win', 'nat_win_rank', 'motor_2_rank', 'st_mean30_rank']:
    m = df[c].to_numpy(np.float64).reshape(n, 6)
    for i in range(6):
        r[f'{c}_{i + 1}'] = m[:, i]
yw = df['y_win'].to_numpy().reshape(n, 6)
assert (yw.sum(1) == 1).all()
r['win_boat'] = (yw.argmax(1) + 1).astype('int8')

kr = pd.read_csv(DATA / 'kb_races.csv', usecols=['race_id', 'technique']); kr['race_id'] = F.rid_to_int(kr['race_id'])
mr = pd.read_csv(DATA / 'results.csv', usecols=['race_id', 'winning_technique']).rename(columns={'winning_technique': 'technique'})
mr['race_id'] = F.rid_to_int(mr['race_id'])
tech = pd.concat([kr, mr]).drop_duplicates('race_id', keep='last')
r = r.merge(tech, on='race_id', how='left')
r['y_tech'] = r['technique'].map({t: i for i, t in enumerate(TECHS)}).fillna(-1).astype('int8')

kb = pd.read_csv(DATA / 'kb_boats.csv', usecols=['race_id', 'boat_number', 'course', 'finish_rank'], dtype={'race_id': 'category'})
kb = kb[kb.finish_rank == 1]; kb['race_id'] = F.rid_to_int(kb['race_id'].astype(str))
kb = kb.drop_duplicates('race_id')[['race_id', 'boat_number', 'course']].rename(columns={'boat_number': 'kb_win_boat', 'course': 'course_kb'})
ac = pd.read_csv(DATA / 'actual_courses.csv'); ac['race_id'] = F.rid_to_int(ac['race_id'])
r = r.merge(kb, on='race_id', how='left').merge(ac, on='race_id', how='left')
mc = np.full(len(r), np.nan)
for b in range(1, 7):
    mc = np.where(r.win_boat == b, r[f'actual_course_{b}'], mc)
is_kb = r.race_date <= F.KB_END
c = pd.to_numeric(pd.Series(np.where(is_kb, r.course_kb, mc)), errors='coerce')
r['y_course'] = (c.where(c.between(1, 6)).fillna(0).astype('int8') - 1)
mism = int(((r.kb_win_boat != r.win_boat) & is_kb & r.kb_win_boat.notna()).sum())
r = r.drop(columns=['kb_win_boat', 'course_kb'] + [f'actual_course_{b}' for b in range(1, 7)])
assert len(r) == n
r.to_pickle(Path(__file__).resolve().parent / 'R2.pkl')
summ = dict(n=n, by_period=r.period.value_counts().to_dict(),
            tech_missing=r.assign(m=r.y_tech < 0).groupby('period').m.sum().astype(int).to_dict(),
            course_missing=r.assign(m=r.y_course < 0).groupby('period').m.sum().astype(int).to_dict(),
            kb_winner_mismatch=mism, grade_na=r.groupby('period').grade_code.apply(lambda s: round(float(s.isna().mean()), 4)).to_dict(),
            round_na=r.groupby('period').round_code.apply(lambda s: round(float(s.isna().mean()), 4)).to_dict(),
            features_rev=open(Path(__file__).resolve().parent / 'features_prod.rev').read().strip(), sec=round(time.time() - t))
json.dump(summ, open(Path(__file__).resolve().parent / 'prep2.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps(summ, ensure_ascii=False))
