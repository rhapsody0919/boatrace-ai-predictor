// prep6: 風速・波高・天候・グレード・ラウンドの帯ごとの艇番別 1着・2着以内・3着以内。raw/p6_kb.txt・p6_main.txt を合算・検算して prep6.json・prep6.md を作る。
// 使い方: node build6.js
import fs from 'node:fs'; import path from 'node:path';
const dir = path.dirname(new URL(import.meta.url).pathname);
const Z = 1.959964, r3 = (x) => Math.round(x * 1000) / 1000;
const wilson = (x, n) => { if (!n) return { x, n, p: null, lo: null, hi: null }; const p = x / n, d = 1 + Z * Z / n, c = (p + Z * Z / (2 * n)) / d, h = Z * Math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / d; return { x, n, p: r3(p), lo: r3(c - h), hi: r3(c + h) }; };
const parse = (f) => Object.fromEntries(fs.readFileSync(path.join(dir, 'raw', f), 'utf8').trim().split(';').map((s) => { const [u, n, nk, nm, dmin, dmax, bx] = s.split('|'); return [u, { n: +n, n_kb: +nk, n_main: +nm, dmin, dmax, bx: bx.split(',').map(Number) }]; }));
const K = parse('p6_kb.txt'), M = parse('p6_main.txt');
const fail = (m) => { throw new Error(m); };
const units = {};
for (const u of new Set([...Object.keys(K), ...Object.keys(M)])) {
  const a = K[u], b = M[u];
  const n = (a?.n || 0) + (b?.n || 0);
  const bx = Array.from({ length: 18 }, (_, i) => (a?.bx[i] || 0) + (b?.bx[i] || 0));
  const s1 = [0, 1, 2, 3, 4, 5].reduce((p, k) => p + bx[k * 3], 0), s2 = [0, 1, 2, 3, 4, 5].reduce((p, k) => p + bx[k * 3 + 1], 0), s3 = [0, 1, 2, 3, 4, 5].reduce((p, k) => p + bx[k * 3 + 2], 0);
  if (s1 !== n || s2 !== 2 * n || s3 < 3 * n) fail('合計が合わない ' + u);
  units[u] = { n, n_kb: a?.n_kb || 0, n_main: b?.n_main || 0, period: [a ? a.dmin : b.dmin, b ? b.dmax : a.dmax], top3_dead_heat_extra: s3 - 3 * n,
    boats: Object.fromEntries([1, 2, 3, 4, 5, 6].map((k) => [k, { win: wilson(bx[(k - 1) * 3], n), top2: wilson(bx[(k - 1) * 3 + 1], n), top3: wilson(bx[(k - 1) * 3 + 2], n) }])) };
}
const TOTAL = 408723;
const dimSum = (pre) => Object.entries(units).filter(([u]) => u.startsWith(pre)).reduce((p, [, v]) => p + v.n, 0);
for (const pre of ['w:', 'h:', 't:', 'g:', 'r:', 'va:']) if (dimSum(pre) !== TOTAL) fail(`${pre} の合計 ${dimSum(pre)} が ${TOTAL} でない`);
if (dimSum('v20w:') !== 17172) fail('若松の合計が prep3 と違う');
if (dimSum('v6:') !== units['w:6+'].n) fail('会場別6m以上の合計が w:6+ と違う');
const p4 = JSON.parse(fs.readFileSync(path.join(dir, 'prep4.json'), 'utf8')).cube;
const chk = (u, key) => { const c = p4[key], v = units[u]; if (!c || c[0] !== v.n || [1, 2, 3, 4, 5, 6].some((k, i) => c[3 + i] !== v.boats[k].win.x)) fail(`prep4 と違う ${u} vs ${key}`); };
for (let v = 1; v <= 24; v++) chk('va:' + v, `${v}|all|all`);
for (const g of ['ippan', 'G3', 'G2', 'G1', 'SG']) chk('g:' + g, `0|${g}|all`);
for (const r of ['yosen', 'junyu', 'yusho', 'other']) chk('r:' + r, `0|all|${r}`);
{ const a = p4['0|G1|yusho'], b = p4['0|SG|yusho'], v = units['x:G1+yusho']; if (a[0] + b[0] !== v.n) fail('G1+yusho が prep4 と違う'); }
const p3 = JSON.parse(fs.readFileSync(path.join(dir, 'prep3.json'), 'utf8'));
for (let k = 1; k <= 6; k++) { const s = ['0-1', '2-3', '4-5', '6+'].reduce((p, w) => p + (units['v20w:' + w]?.boats[k].top2.x || 0), 0); if (s !== p3['20|all|all'].boats[k].top2.x) fail('若松の2着以内が prep3 と違う'); }
// 会場別: 6m以上の1号艇1着率
const venueWind6 = [];
for (let v = 1; v <= 24; v++) {
  const all = units['va:' + v], w6 = units['v6:' + v];
  venueWind6.push({ venue_code: v, n_all: all.n, b1_win_all: all.boats[1].win, n_wind6: w6?.n || 0, b1_win_wind6: w6 ? w6.boats[1].win : null,
    diff_pt: w6 ? Math.round((w6.boats[1].win.x / w6.n - all.boats[1].win.x / all.n) * 1000) / 10 : null });
}
const order = { w: ['0-1', '2-3', '4-5', '6+', '不明'], h: ['0-2', '3-5', '6+', '不明'], t: ['晴', '曇り', '雨', '雪', 'その他・不明'], g: ['ippan', 'G3', 'G2', 'G1', 'SG', 'NULL'], r: ['yosen', 'junyu', 'yusho', 'other', 'NULL'], v20w: ['0-1', '2-3', '4-5', '6+', '不明'] };
const pick = (pre) => Object.fromEntries(order[pre].map((b) => [b, units[`${pre}:${b}`] || { n: 0, note: '0件' }]));
const out = {
  _meta: { data_version: '本番 Supabase（読み取りのみ、MCP execute_sql）2026-10-03 08:30 JST 取得',
    population: '120 の analogy_pool_outcomes 相当（kb〜2025-12-02・本体 2025-12-03〜）、2019-04-01〜2026-09-26。n=408,723',
    columns: '長期: kb_archive_races.weather・wind_speed（m、整数）・wave_height（cm、整数）。本体: race_conditions.weather・wind_speed（numeric だが値はすべて整数）・wave_height。グレード・ラウンドは 120 と同じ',
    bands: '風速 0〜1m／2〜3m／4〜5m／6m以上／不明、波高 0〜2cm／3〜5cm／6cm以上／不明、天候 晴／曇り／雨／雪／その他・不明（霧・台風・NULL）',
    missing: '母集団（完全レース）に入るレースでは、風速・波高・天候とも欠損 0件（kb・本体とも）。本体の 2025-12〜2026-03 の「データの穴」は race_conditions が K/B で補完済みで、2025-12 は 4,524R 中 4,496R、2026-01 は 5,340R 中 5,166R に気象がある（races 全体、中止を含む）。気象が無いレース（台風 42R・NULL 248R 等）は中止・不成立で母集団に入っていなかった。そのため「不明」の帯は 0件で、補完・除外の処理はしていない。kb の天候「霧」7R は「その他・不明」',
    dead_heat: 'kb の3着同着のため、3着以内の件数の合計が 3n を少し超える（各帯の top3_dead_heat_extra）',
    check: 'build6.js で検算: 各帯の1着の合計が n、2着以内の合計が 2n。風速・波高・天候・グレード・ラウンド・会場の各次元で n の合計が 408,723。会場24・グレード5・ラウンド4 の n と1着艇番が prep4 の cube と一致。G1以上かつ優勝戦が prep4 の 0|G1|yusho＋0|SG|yusho と一致。若松の風速帯の合計が prep3（17,172R）と一致',
    sql: ['sql/pool_base6.sql', 'sql/p6_tail.sql（gen_p6.js で生成）', 'sql/executed_p6_kb.sql', 'sql/executed_p6_main.sql'] },
  wind: pick('w'), wave: pick('h'), weather: pick('t'), grade: pick('g'), round: pick('r'), g1plus_yusho: units['x:G1+yusho'],
  wakamatsu_wind: pick('v20w'), venue_wind6: venueWind6,
};
fs.writeFileSync(path.join(dir, 'prep6.json'), JSON.stringify(out, null, 1));
// md
const f3 = (x) => (x == null ? '-' : x.toFixed(3));
const ci = (w) => (w && w.p != null ? `${f3(w.p)} [${f3(w.lo)}–${f3(w.hi)}] ${w.x}` : '-');
const LINES = []; const L = (...xs) => LINES.push(...xs);
const VER = '本番 2026-10-03 08:30 JST 取得';
L('# レース全体の条件と艇番の有利・不利（prep6）', '', `- データ版: ${out._meta.data_version}`, `- 母集団: ${out._meta.population}`, `- 使った列: ${out._meta.columns}`, `- 帯: ${out._meta.bands}`, `- 欠損の扱い: ${out._meta.missing}`, `- 3着同着: ${out._meta.dead_heat}`, `- 検算: ${out._meta.check}`, '- 各セルは「割合 [Wilson 95%CI] 件数」。分母は帯の n', '');
const table = (title, obj, key) => {
  for (const [t, lab] of [['win', '1着率'], ['top2', '2着以内率'], ['top3', '3着以内率']]) {
    L(`### ${title}: ${lab}`, '', '| 帯 | n | kb | 本体 | 期間 | 1号艇 | 2号艇 | 3号艇 | 4号艇 | 5号艇 | 6号艇 |', '|---|---|---|---|---|---|---|---|---|---|---|');
    for (const [b, v] of Object.entries(obj)) {
      if (!v.boats) { L(`| ${b} | 0 | | | | | | | | | |`); continue; }
      L(`| ${b} | ${v.n} | ${v.n_kb} | ${v.n_main} | ${v.period.join('〜')} | ${[1, 2, 3, 4, 5, 6].map((k) => ci(v.boats[k][t])).join(' | ')} |`);
    }
    L('', `出典: 指標=艇番別の${lab}／母集団=120 の定義・2019-04-01〜2026-09-26／${VER}／prep6.json \`${key}.<帯>.boats.<艇>.${t}\``, '');
  }
};
L('## 1. 風速'); table('風速', out.wind, 'wind');
L('## 2. 波高'); table('波高', out.wave, 'wave');
L('## 3. 天候'); table('天候', out.weather, 'weather');
L('## 4. グレード（NULL は本体 2025-12-03〜2026-02-02 の 808R）'); table('グレード', out.grade, 'grade');
L('## 5. ラウンド'); table('ラウンド', out.round, 'round');
L('## 6. G1以上かつ優勝戦（参考）'); table('G1以上かつ優勝戦', { 'G1・SG の優勝戦': out.g1plus_yusho }, 'g1plus_yusho');
L('## 7. 若松だけの風速'); table('若松の風速', out.wakamatsu_wind, 'wakamatsu_wind');
L('## 8. 会場別: 風速6m以上で1号艇の1着率がどれだけ下がるか', '', '| 会場 | 全体 n | 全体の1号艇1着率 | 6m以上 n | 6m以上の1号艇1着率 | 差（ポイント） |', '|---|---|---|---|---|---|');
for (const r of [...venueWind6].sort((a, b) => a.diff_pt - b.diff_pt)) L(`| ${r.venue_code} | ${r.n_all} | ${ci(r.b1_win_all)} | ${r.n_wind6} | ${ci(r.b1_win_wind6)} | ${r.diff_pt} |`);
L('', `出典: 指標=1号艇の1着率／比較=同じ会場の全レース／母集団=120 の定義・2019-04-01〜2026-09-26／${VER}／prep6.json \`venue_wind6\`（差の小さい順＝下がり方の大きい順）`, '');
fs.writeFileSync(path.join(dir, "prep6.md"), LINES.join("\n"));
const w = out.wind; console.log('wind b1 win', Object.entries(w).map(([b, v]) => `${b}:${v.n}:${v.boats ? f3(v.boats[1].win.p) : '-'}`).join(' '));
console.log('wave', Object.entries(out.wave).map(([b, v]) => `${b}:${v.n}:${v.boats ? f3(v.boats[1].win.p) : '-'}`).join(' '));
console.log('weather', Object.entries(out.weather).map(([b, v]) => `${b}:${v.n}:${v.boats ? f3(v.boats[1].win.p) : '-'}`).join(' '));
console.log('grade', Object.entries(out.grade).map(([b, v]) => `${b}:${v.n}:${v.boats ? f3(v.boats[1].win.p) : '-'}`).join(' '));
console.log('round', Object.entries(out.round).map(([b, v]) => `${b}:${v.n}:${v.boats ? f3(v.boats[1].win.p) : '-'}`).join(' '));
console.log('g1y', out.g1plus_yusho.n, f3(out.g1plus_yusho.boats[1].win.p));
console.log('waka', Object.entries(out.wakamatsu_wind).map(([b, v]) => `${b}:${v.n}:${v.boats ? f3(v.boats[1].win.p) : '-'}`).join(' '));
console.log('venue6', [...venueWind6].sort((a, b) => a.diff_pt - b.diff_pt).map((r) => `${r.venue_code}:${r.n_wind6}:${f3(r.b1_win_wind6.p)}/${f3(r.b1_win_all.p)}(${r.diff_pt})`).join(' '));
for (const k of [2, 3, 4, 5, 6]) console.log('k', k, Object.entries(w).filter(([, v]) => v.boats).map(([b, v]) => `${b}:${f3(v.boats[k].win.p)}`).join(' '));
