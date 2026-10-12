// 読み取りのみ: predictions(model_id=unified) のイン崩れ指数（保存値）を書き出す
import { fetchAll } from '/Users/terukina/boatrace-ai-predictor/.claude/worktrees/elegant-dewdney-a867e5/scripts/lib/supabaseClient.js';
import fs from 'node:fs';
const rows = await fetchAll('predictions',
  'prediction_id,race_id,predicted_at,comp:feature_contributions->volatilityComposite,pct:feature_contributions->volatilityPercentile,fb:feature_contributions->volatilityPercentileIsFallback,nige:feature_contributions->turnPrediction->distribution->nige',
  q => q.eq('model_id','unified').gte('race_id','2026-07-01').order('prediction_id'));
const out = ['prediction_id,race_id,predicted_at,comp,pct,fb,nige'];
for (const r of rows) out.push([r.prediction_id,r.race_id,r.predicted_at,r.comp??'',r.pct??'',r.fb??'',r.nige??''].join(','));
fs.writeFileSync(process.argv[2], out.join('\n')+'\n');
console.log(rows.length);
