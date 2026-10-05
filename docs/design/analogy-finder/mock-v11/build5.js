// prep5: 例のレースの4条件の全16部分集合＋「1111」に任意の条件を1つ足した3つ。raw/p5_kb.json・p5_main.json を合算し検算して prep5.json を作る。
// 使い方: node build5.js
import fs from 'node:fs'; import path from 'node:path';
const dir = path.dirname(new URL(import.meta.url).pathname);
const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const KB = rd('raw/p5_kb.json'), MN = rd('raw/p5_main.json');
const nums = (s) => s.split(',').map(Number);
const parseCells = (s) => Object.fromEntries(s.split(';').map((row) => {
  const [key, n, nkb, nmain, dmin, dmax, r1, tech, kt, hi, cn, ci] = row.split('|');
  return [key, { n: +n, n_kb: +nkb, n_main: +nmain, dmin, dmax, r1: nums(r1), tech: nums(tech), kt: nums(kt), hit_ind: nums(hi), cmp_n: nums(cn), cmp_ind: nums(ci) }];
}));
const parseTri = (s) => Object.fromEntries(s.split(';').map((x) => { const [k, t] = x.split('='); return [k, Object.fromEntries(t.split(',').map((y) => { const [c, v] = y.split(':'); return [c, +v]; }))]; }));
const add = (a, b) => a.map((v, i) => v + b[i]);
const ck = parseCells(KB.cells), cm = parseCells(MN.cells), tk = parseTri(KB.trifecta), tm = parseTri(MN.trifecta);
const KEYS = [...Array(16).keys()].map((m) => m.toString(2).padStart(4, '0')).concat(['1111+round', '1111+grade', '1111+motor']);
const IND = ['b1d', 'b1s', 'st1_tie', 'ib', 'md'];
const T7 = ['逃げ', '差し', 'まくり', 'まくり差し', '抜き', '恵まれ', 'その他'];
const fail = (m) => { throw new Error(m); };
const subsets = {};
for (const key of KEYS) {
  const a = ck[key], b = cm[key];
  if (!a && !b) fail('両方に無い ' + key);
  const z = (x) => x || { n: 0, n_kb: 0, n_main: 0, r1: Array(6).fill(0), tech: Array(7).fill(0), kt: Array(18).fill(0), hit_ind: Array(30).fill(0), cmp_n: Array(6).fill(0), cmp_ind: Array(30).fill(0) };
  const A = z(a), B = z(b);
  const n = A.n + B.n;
  const r1 = add(A.r1, B.r1), tech = add(A.tech, B.tech), kt = add(A.kt, B.kt), hi = add(A.hit_ind, B.hit_ind), cn = add(A.cmp_n, B.cmp_n), ci = add(A.cmp_ind, B.cmp_ind);
  const tri = { ...(tk[key] || {}) };
  for (const [c, v] of Object.entries(tm[key] || {})) tri[c] = (tri[c] || 0) + v;
  // 検算
  const sum = (x) => x.reduce((p, q) => p + q, 0);
  if (sum(r1) !== n || sum(tech) !== n || sum(Object.values(tri)) !== n) fail(`合計が n と合わない ${key}`);
  for (let k = 0; k < 6; k++) if (kt[k * 3] !== r1[k]) fail(`kt の1着と r1 が合わない ${key} k=${k + 1}`);
  const s2 = sum([0, 1, 2, 3, 4, 5].map((k) => kt[k * 3 + 1])), s3 = sum([0, 1, 2, 3, 4, 5].map((k) => kt[k * 3 + 2]));
  if (s2 !== 2 * n || s3 < 3 * n) fail(`2着以内・3着以内の合計が合わない ${key}`);
  const extraTop3 = s3 - 3 * n; // kb の3着同着（finish_rank=3 が2艇）。母集団の定義（120）は3着同着を除いていない
  for (let k = 0; k < 6; k++) { const ex = k === 0 ? n - r1[0] : n - r1[0] - r1[k]; if (cn[k] !== ex) fail(`比べる相手の件数 ${key} k=${k + 1}`); }
  for (const [c, v] of Object.entries(tri)) if (!/^[1-6]{3}$/.test(c) || new Set(c).size !== 3) fail('出目の形 ' + c);
  for (let k = 0; k < 6; k++) { const v = sum(Object.entries(tri).filter(([c]) => c[0] === String(k + 1)).map(([, x]) => x)); if (v !== r1[k]) fail(`出目の1着と r1 ${key}`); }
  subsets[key] = {
    conditions: key.startsWith('1111+') ? `4条件すべて＋${{ round: 'ラウンド=yusho', grade: 'グレード=G1', motor: '1号艇のモーター帯=2（5〜6位）' }[key.slice(5)]}`
      : ['勝率差の帯=1', '1号艇=A1', '会場=若松(20)', '勝率1位=4号艇'].filter((_, i) => key[i] === '1').join('・') || '条件なし（全体）',
    n, n_kb: A.n_kb + B.n_kb, n_main: A.n_main + B.n_main,
    period: [a ? a.dmin : b.dmin, b ? b.dmax : a.dmax],
    boats_in_top3_beyond_3n: extraTop3,
    winner_boat: r1, technique: Object.fromEntries(T7.map((t, i) => [t, tech[i]])),
    trifecta: Object.fromEntries(Object.entries(tri).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))),
    n_hit: Object.fromEntries([1, 2, 3, 4, 5, 6].map((k) => [k, { t1: kt[(k - 1) * 3], t2: kt[(k - 1) * 3 + 1], t3: kt[(k - 1) * 3 + 2] }])),
    win_indicators: Object.fromEntries([1, 2, 3, 4, 5, 6].map((k) => [k, {
      hit_n: r1[k - 1], hit: Object.fromEntries(IND.map((x, i) => [x, hi[(k - 1) * 5 + i]])),
      compare: k === 1 ? '1号艇が1着でない' : `1着が1号艇でも${k}号艇でもない`, compare_n: cn[k - 1],
      compare_counts: Object.fromEntries(IND.map((x, i) => [x, ci[(k - 1) * 5 + i]])),
      ...(k === 1 ? { note: 'k=1 の b1d・b1s は対象外（0 を出している）' } : {}),
    }])),
  };
}
// 前回（prep2）の深さ1〜4・任意の条件の件数と照合
const p2 = rd('prep2.json');
const exp = { '1000': p2.depth.layers[0].n, '1100': p2.depth.layers[1].n, '1110': p2.depth.layers[2].n, '1111': p2.depth.layers[3].n,
  '1111+round': p2.depth.add_optional.plus_round.by_depth[3], '1111+grade': p2.depth.add_optional.plus_grade.by_depth[3], '1111+motor': p2.depth.add_optional.plus_motor.by_depth[3], '0000': p2.depth.pool.n };
for (const [k, v] of Object.entries(exp)) if (subsets[k].n !== v) fail(`prep2 と件数が合わない ${k}: ${subsets[k].n} vs ${v}`);
// 1110（＝prep2 の自動の深さ3の層）の分布も照合
const L = p2.layer, s3 = subsets['1110'];
for (let b = 1; b <= 6; b++) if (s3.winner_boat[b - 1] !== L.winner_boat[b].x) fail('1110 の1着艇番が prep2 と違う');
for (const t of L.trifecta_top10) if (s3.trifecta[t.combo.replaceAll('-', '')] !== t.x) fail('1110 の出目が prep2 と違う');
// prep4 の cube（同じ期間）と照合
const p4 = rd('prep4.json').cube;
for (const [k, ck2] of [['0000', '0|all|all'], ['0010', '20|all|all']]) { const c = p4[ck2]; if (c[0] !== subsets[k].n || c.slice(3, 9).some((v, i) => v !== subsets[k].winner_boat[i])) fail(`prep4 と違う ${k}`); }
// 一覧
const list = [...KB.list_1111.split(';'), ...MN.list_1111.split(';')].map((s) => {
  const [race_date, venue_code, race_number, grade, stage, top3, technique_raw, finish, st, st_rank, course, payout, source] = s.split('|');
  return { race_date, venue_code: +venue_code, race_number: +race_number, grade, stage, top3, technique_raw, finish_by_boat: finish.split(','),
    st_by_boat: st.split(',').map((x) => (x === '-' ? null : +x)), st_rank_by_boat: st_rank.split(',').map((x) => (x === '-' ? null : +x)),
    course_by_boat: course.split(',').map((x) => (x === '-' ? null : +x)), payout_3tan_yen: payout === '-' ? null : +payout, source };
});
if (list.length !== subsets['1111'].n) fail('一覧の件数が 1111 の n と合わない');
const lw = [1, 2, 3, 4, 5, 6].map((b) => list.filter((r) => r.top3.startsWith(b + '-')).length);
if (lw.some((v, i) => v !== subsets['1111'].winner_boat[i])) fail('一覧の1着と集計が合わない');
const out = {
  _meta: { data_version: '本番 Supabase（読み取りのみ、MCP execute_sql）2026-10-03 08:15〜08:20 JST 取得',
    population: '120 の analogy_pool_outcomes 相当（kb〜2025-12-02・本体 2025-12-03〜）、race_date ≤ 2026-09-26（例のレース 2026-09-27-20-12 の前日まで）',
    key: '"gap|cls|venue|top" の各位置 1=使う/0=外す（勝率差の帯=1・1号艇=A1・会場=20・勝率1位=4号艇）。"1111+round|grade|motor" は4条件すべてに任意の条件を1つ足したもの',
    sql: ['sql/pool_base5.sql', 'sql/p5_tail.sql（gen_p5.js で生成）', 'sql/rendered_p5_kb.sql', 'sql/rendered_p5_main.sql'],
    definitions: 'winner_boat=[1号艇..6号艇の1着件数]。technique は DB の値（その他=6分類以外・NULL）。trifecta のキーは 1-2-3着の艇番（"123"=1-2-3）。n_hit の t1/t2/t3=1着・2着以内・3着以内。win_indicators の hit=艇 k が1着のレースでの件数、compare_counts=比べる相手のレースでの件数。指標の定義は prep.json と同じ（b1d=1号艇が3着以内でない、b1s=1号艇のST順位4位以下、st1_tie=艇kのST順位1位（同タイム含む）、ib=艇kより内の艇番に返還艇か失格、md=艇kの進入<k）。ST 順位は min 順位、返還艇・不明は NULL で false として数える',
    check: 'build5.js で検算: 各キーで1着艇番・決まり手・出目の合計が n、n_hit の1着が1着艇番と一致、2着以内の合計が 2n、3着以内の合計が 3n 以上（超過は kb の3着同着で、boats_in_top3_beyond_3n に件数）、比べる相手の件数が n−1号艇1着（−k号艇1着）と一致。1000/1100/1110/1111 と任意の3条件・0000 が prep2 の件数（80,092／7,651／331／74、7／21／24、408,723）と一致。1110 の1着艇番・出目上位10が prep2 の層と一致。0000・0010 が prep4 の cube と一致。一覧74件の1着が集計と一致' },
  subsets, list_1111: list,
};
fs.writeFileSync(path.join(dir, 'prep5.json'), JSON.stringify(out));
for (const k of KEYS) { const s = subsets[k]; console.log(k, s.n, s.n_kb, s.n_main, s.period.join('..'), 'r1', s.winner_boat.join(','), 'tri', Object.keys(s.trifecta).length); }
console.log('list', list.length);
