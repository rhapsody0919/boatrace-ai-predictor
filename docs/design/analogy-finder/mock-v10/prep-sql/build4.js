// prep4: cube を 2019-04-01〜2026-09-26 で作り直す。kb のセル（〜2025-12-02、変わらない）＋本体のセル（prep2 の取得分のうち、
// 9/27 以降にレースがあったセルを raw/p4_main_changed.json の数え直しで置き換え、9/26 までに0件のセルは消す）。
// 使い方: node build4.js
import fs from 'node:fs'; import path from 'node:path';
const dir = path.dirname(new URL(import.meta.url).pathname);
const parse = (txt) => txt.trim().split(';').map((s) => { const [v, g, r, n, dmin, dmax, r1, tc] = s.split('|');
  return { key: `${v}|${g}|${r}`, v, g, r, n: +n, dmin, dmax, r1: r1.split(',').map(Number), tc: tc.split(',').map(Number) }; });
const kb = parse(fs.readFileSync(path.join(dir, 'raw/p2_cube_kb.txt'), 'utf8'));
const main0 = parse(fs.readFileSync(path.join(dir, 'raw/p2_cube_main.txt'), 'utf8'));
const ch = JSON.parse(fs.readFileSync(path.join(dir, 'raw/p4_main_changed.json'), 'utf8'));
const changed = new Map(parse(ch.changed).map((c) => [c.key, c]));
const touched = new Set(ch.touched);
for (const k of changed.keys()) if (!touched.has(k)) throw new Error('changed が touched に無い ' + k);
const main = main0.filter((c) => !touched.has(c.key)).concat([...changed.values()]);
const removed = [...touched].filter((k) => !changed.has(k));
const cube = {};
for (const c of [...kb, ...main]) {
  if (c.dmax > '2026-09-26') throw new Error('9/27 以降のセルが残っている ' + c.key);
  for (const vk of [c.v, '0']) for (const gk of c.g === 'NULL' ? ['all'] : [c.g, 'all']) for (const rk of c.r === 'NULL' ? ['all'] : [c.r, 'all']) {
    const key = `${vk}|${gk}|${rk}`, o = cube[key];
    if (!o) cube[key] = [c.n, c.dmin, c.dmax, ...c.r1, ...c.tc];
    else { o[0] += c.n; if (c.dmin < o[1]) o[1] = c.dmin; if (c.dmax > o[2]) o[2] = c.dmax; for (let i = 0; i < 6; i++) o[3 + i] += c.r1[i]; for (let i = 0; i < 7; i++) o[9 + i] += c.tc[i]; }
  }
}
// 検算: prep3（若松・2026-09-26 まで）と一致すること
const p3 = JSON.parse(fs.readFileSync(path.join(dir, 'prep3.json'), 'utf8'));
for (const u of ['20|all|all', '20|G1|all']) {
  const c = cube[u], o = p3[u];
  const ok = c[0] === o.n && c[1] === o.period[0] && c[2] === o.period[1] && [1, 2, 3, 4, 5, 6].every((b, i) => c[3 + i] === o.boats[b].win.x);
  if (!ok) throw new Error(`prep3 と合わない ${u}: ${JSON.stringify(c)} vs n=${o.n}`);
}
// 内部の検算: 各セルの1着の合計・決まり手の合計が n
for (const [k, v] of Object.entries(cube)) {
  if (v.slice(3, 9).reduce((a, b) => a + b, 0) !== v[0] || v.slice(9, 16).reduce((a, b) => a + b, 0) !== v[0]) throw new Error('合計が合わない ' + k);
}
const keys = Object.keys(cube).sort();
const prep2 = JSON.parse(fs.readFileSync(path.join(dir, 'prep2.json'), 'utf8'));
const out = {
  _meta: { data_version: '本番 Supabase（読み取りのみ、MCP execute_sql）。kb・本体の元セルは 2026-10-03 07:50 JST、本体の差し替え分は 08:05 JST 取得',
    period: '2019-04-01〜2026-09-26（例のレース 2026-09-27 と後の日を含めない）',
    sql: ['sql/executed_p2_cube_kb.sql', 'sql/executed_p2_cube_main.sql', 'sql/executed_p4_cube_main.sql'],
    build: 'build4.js（prep2 の cube と同じ合算。本体の 9/27〜10/02 にレースがあった ' + touched.size + ' セルを 9/26 までで数え直して置き換え、うち ' + removed.length + ' セル（' + removed.join(', ') + '）は 9/26 までに0件のため削除）',
    check: 'prep3.json の 20|all|all（n=17,172）・20|G1|all（n=823）の n・期間・1着艇番と一致。全キーで1着艇番と決まり手の合計が n と一致' },
  cube_format: { ...prep2.cube_format, period: '2019-04-01〜2026-09-26', n_keys: keys.length },
  cube: Object.fromEntries(keys.map((k) => [k, cube[k]])),
};
fs.writeFileSync(path.join(dir, 'prep4.json'), JSON.stringify(out));
console.log('keys', keys.length, 'touched', touched.size, 'removed', removed, ['0|all|all', '20|all|all', '20|G1|all', '20|G1|yusho'].map((k) => k + '=' + JSON.stringify(cube[k])).join('\n'));
