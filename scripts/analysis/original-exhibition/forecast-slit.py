# スリット7形別の検証に要る件数（攻める艇のまわり足・周回の順位区分ごとに約400艇）がそろう日の見込み。検証そのものは行わない
# boats.pkl（build.py の出力。期間は fetch.mjs の OX_FROM〜OX_TO）を使う。結果は stdout と data/analysis/original-exhibition/slit-forecast.json
# 形の定義・攻める艇は analyze2.py と同じ（本番 ST、枠なりのレース）
import pandas as pd, numpy as np, os, json, math
from common import WORK, OUT_DIR, grp

NEED = int(os.environ.get('OX_NEED', '400'))   # 前回（original-exhibition-effect.md）の「約400艇/区分」
b = pd.read_pickle(os.path.join(WORK, 'boats.pkl'))
FORMS = ['flat', 'wall', 'd2', 'd3', 'kado', 'd1', 'dash']
FJ = {'flat': '横一線', 'wall': '内3艇そろう', 'd2': '2コース凹み', 'd3': 'カド受け凹み', 'kado': 'カド一撃', 'd1': 'イン凹み', 'dash': 'ダッシュ勢先行'}
ATT = {'d2': 3, 'd3': 4, 'kado': 4, 'd1': 2, 'dash': 4}   # それ以外は1号艇
w_ = b[b.wakunari.astype(bool)].sort_values(['race_id', 'boat_number'])
c = np.round(w_.start_timing.to_numpy().reshape(-1, 6)*100).astype(int); rid = w_.race_id.to_numpy()[::6]
f = np.stack([c.max(1)-c.min(1) <= 6, c[:, :3].max(1)-c[:, :3].min(1) <= 2, c[:, 1]-np.minimum(c[:, 0], c[:, 2]) >= 5,
              c[:, 2]-np.minimum(c[:, 1], c[:, 3]) >= 5, c[:, :3].min(1)-c[:, 3] >= 3, c[:, 0]-c[:, 1] >= 5, c[:, :3].sum(1)-c[:, 3:].sum(1) >= 15], 1)
FM = pd.DataFrame(f, index=rid, columns=FORMS)
days = sorted(b.race_date.unique()); last = pd.Timestamp(days[-1])
# 1日あたりの増え方の分母: まわり足が採用レースの半分以上で6艇そろう日（保存を始めた 9/22 は6Rだけなので除く）
share = b.groupby('race_date').apply(lambda x: x[x.mawari_rank.notna()].race_id.nunique()/x.race_id.nunique(), include_groups=False)
ndays = int((share >= 0.5).sum())
per_day = b.groupby('race_date').race_id.nunique()
print(f'期間 {days[0]}〜{days[-1]}（{len(days)}日、うち保存がそろう日 {ndays}）採用R {b.race_id.nunique()} 枠なりR {len(FM)} 1日あたり採用R 平均 {per_day.mean():.0f}（最小 {per_day.min()} 最大 {per_day.max()}）')
print(f'必要: 攻める艇の順位区分（上位1-2・下位5-6）それぞれ {NEED} 艇。1日あたりの増え方は今の期間の平均で一定と置く')
bi = w_.set_index(['race_id', 'boat_number']); out = {'period': [str(days[0]), str(days[-1])], 'days': len(days), 'days_saved': ndays, 'races': int(b.race_id.nunique()), 'wakunari_races': int(len(FM)), 'need_per_group': NEED, 'forms': {}}
for fm in FORMS:
  ids = FM.index[FM[fm]]; a = bi.loc[[(i, ATT.get(fm, 1)) for i in ids]]
  rec = {'races': int(len(ids)), 'attack_boat': ATT.get(fm, 1)}
  for it in ['mawari', 'lap']:
    y = a[a[it+'_rank'].notna()]; g = grp(y[it+'_rank'])
    top, bot = int((g == '上位1-2').sum()), int((g == '下位5-6').sum()); lo = min(top, bot)
    rate = lo/ndays; rest = max(0, NEED-lo); dn = math.ceil(rest/rate) if rate > 0 else None
    rec[it] = {'top12': top, 'bottom56': bot, 'per_day_smaller': round(rate, 2), 'days_more': dn,
               'date': str((last+pd.Timedelta(days=dn)).date()) if dn is not None else None}
  out['forms'][fm] = rec
  print(f"{FJ[fm]}（{ATT.get(fm,1)}号艇） {len(ids)}R: " + ' | '.join(f"{ {'mawari':'まわり足','lap':'周回'}[it]} 上位 {rec[it]['top12']} 下位 {rec[it]['bottom56']} 少ない方 {rec[it]['per_day_smaller']}/日 → あと {rec[it]['days_more']} 日 = {rec[it]['date']}" for it in ['mawari', 'lap']))
json.dump(out, open(os.path.join(OUT_DIR, 'slit-forecast.json'), 'w'), ensure_ascii=False, indent=1)
