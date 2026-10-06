// prep3: 若松の艇番別 1着・2着以内・3着以内（2019-04-01〜2026-09-26）。使い方: node build3.js
import fs from 'node:fs'; import path from 'node:path';
const dir = path.dirname(new URL(import.meta.url).pathname);
const raw = JSON.parse(fs.readFileSync(path.join(dir, 'raw/p3.json'), 'utf8'));
const Z = 1.959964, r3 = (x) => Math.round(x * 1000) / 1000;
const wilson = (x, n) => { const p = x / n, d = 1 + Z * Z / n, c = (p + Z * Z / (2 * n)) / d, h = Z * Math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / d; return { x, n, p: r3(p), lo: r3(c - h), hi: r3(c + h) }; };
const out = { _meta: { data_version: '本番 Supabase（読み取りのみ、MCP execute_sql）2026-10-03 07:58 JST 取得', population: '120 の analogy_pool_outcomes 相当（prep.json と同じ定義）、venue_code=20、race_date 2019-04-01〜2026-09-26（例のレースの日を含めない）', grade: 'analogy_grade_of と同じ（G1 は races.race_grade／kb_archive_venue_days.race_grade、無ければ race_series）', ci: 'Wilson 95%', sql: ['sql/p3_tail.sql', 'sql/executed_p3_kb.sql', 'sql/executed_p3_main.sql'] } };
for (const [i, unit] of ['20|all|all', '20|G1|all'].entries()) {
  const a = raw.kb[i], b = raw.main[i];
  if (a[0] !== unit || b[0] !== unit) throw new Error('unit mismatch');
  const n = a[1] + b[1];
  const boats = {};
  for (let k = 0; k < 6; k++) { const v = a[6 + k].map((x, j) => x + b[6 + k][j]); boats[k + 1] = { win: wilson(v[0], n), top2: wilson(v[1], n), top3: wilson(v[2], n) }; }
  const wins = Object.values(boats).reduce((s, x) => s + x.win.x, 0);
  if (wins !== n) throw new Error('1着の合計が n と合わない');
  out[unit] = { n, n_kb: a[1], n_main: b[1], period: [a[1] ? a[4] : b[4], b[1] ? b[5] : a[5]], boats };
}
fs.writeFileSync(path.join(dir, 'prep3.json'), JSON.stringify(out, null, 1));
for (const u of ['20|all|all', '20|G1|all']) { const o = out[u]; console.log(u, o.n, o.n_kb, o.n_main, o.period.join('..')); for (const [k, v] of Object.entries(o.boats)) console.log(' ', k, ['win', 'top2', 'top3'].map((t) => `${v[t].p.toFixed(3)}[${v[t].lo.toFixed(3)}-${v[t].hi.toFixed(3)}](${v[t].x})`).join(' ')); }
