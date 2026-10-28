// 本番 racer_period_stats を読み取りだけで全行取得し、work/ に置く（中間データ、gitignore）
// 実行: node --env-file=.env.local scripts/analysis/racer-period-stats/fetch-period-stats.mjs
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
const OUT = 'data/analysis/racer-period-stats/work/rows.json';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const out = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('racer_period_stats').select('*')
    .order('racer_id').order('period_year').order('period_no').range(from, from + 999);
  if (error) throw new Error(`racer_period_stats の読み取りに失敗: ${error.message}`);
  out.push(...data);
  if (data.length < 1000) break;
}
fs.mkdirSync('data/analysis/racer-period-stats/work', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), rows: out }));
console.log(out.length);
