// prep7: 進入の型・スリット7形・その交差・展示の進入。raw/p7_*.json を合算・検算して prep7.json・prep7.md を作る。使い方: node build7.js
import fs from 'node:fs'; import path from 'node:path';
const dir = path.dirname(new URL(import.meta.url).pathname);
const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, 'raw', f), 'utf8'));
const Z = 1.959964, r3 = (x) => Math.round(x * 1000) / 1000;
const wilson = (x, n) => { if (!n) return { x, n, p: null, lo: null, hi: null }; const p = x / n, d = 1 + Z * Z / n, c = (p + Z * Z / (2 * n)) / d, h = Z * Math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / d; return { x, n, p: r3(p), lo: r3(c - h), hi: r3(c + h) }; };
const fail = (m) => { throw new Error(m); };
const T7 = ['逃げ', '差し', 'まくり', 'まくり差し', '抜き', '恵まれ', 'その他'];
const cells = {};
for (const f of ['p7_kb.json', 'p7_main.json']) {
  for (const row of rd(f).cells.split(';')) {
    const [scope, dim, val, n, r1, tc] = row.split('|');
    const k = `${scope}|${dim}|${val}`, o = cells[k] || { n: 0, r1: Array(6).fill(0), tc: Array(7).fill(0) };
    o.n += +n; r1.split(',').forEach((v, i) => { o.r1[i] += +v; }); tc.split(',').forEach((v, i) => { o.tc[i] += +v; });
    cells[k] = o;
  }
}
for (const [k, o] of Object.entries(cells)) { const s1 = o.r1.reduce((a, b) => a + b, 0), s2 = o.tc.reduce((a, b) => a + b, 0); if (s1 !== o.n || s2 !== o.n) fail('合計が n と合わない ' + k); }
const excl = {};
for (const f of ['p7_kb.json', 'p7_main.json']) for (const row of rd(f).excl.split(';')) {
  const [scope, ...v] = row.split('|'); const e = excl[scope] || { n_pool: 0, ret: 0, course_unknown: 0, n_ok: 0, st_missing: 0 };
  ['n_pool', 'ret', 'course_unknown', 'n_ok', 'st_missing'].forEach((key, i) => { e[key] += +v[i]; }); excl[scope] = e;
}
const g = (s, d, v) => cells[`${s}|${d}|${v}`] || { n: 0, r1: Array(6).fill(0), tc: Array(7).fill(0) };
const FORMS = [['flat', '横一線'], ['wall', '内3艇そろう'], ['d2', '2コース凹み'], ['d3', 'カド受け凹み'], ['kado', 'カド一撃'], ['d1', 'イン凹み'], ['dash', 'ダッシュ勢先行']];
const SC = { all: '全国', v20: '若松', v20G1: '若松×G1', G1y: 'G1以上（G1・SG）の優勝戦' };
const p4 = JSON.parse(fs.readFileSync(path.join(dir, 'prep4.json'), 'utf8')).cube;
const dist = (o) => ({ n: o.n, winner_boat: o.r1, b1_win: wilson(o.r1[0], o.n), technique: Object.fromEntries(T7.map((t, i) => [t, o.tc[i]])) });
const out = { _meta: {}, scopes: {} };
let small = {};
for (const [s, label] of Object.entries(SC)) {
  const all = g(s, 'all', ''), e = excl[s];
  if (all.n !== e.n_ok) fail('n_ok と all が違う ' + s);
  if (g(s, 'a', 'waku').n + g(s, 'a', 'other').n !== all.n || g(s, 'c', 'yes').n + g(s, 'c', 'no').n !== all.n) fail('a/c の合計 ' + s);
  if (g(s, 's', '').n !== all.n - e.st_missing) fail('s ' + s);
  const bs = Object.keys(cells).filter((k) => k.startsWith(`${s}|b|`)).map((k) => [k.split('|')[2], cells[k]]);
  if (bs.reduce((p, [, o]) => p + o.n, 0) !== g(s, 'a', 'other').n) fail('b の合計 ' + s);
  for (const [f] of FORMS) {
    if (g(s, 'af', 'waku:' + f).n + g(s, 'af', 'other:' + f).n !== g(s, 'f', f).n) fail('af ' + s + f);
    if (g(s, 'cf', 'yes:' + f).n + g(s, 'cf', 'no:' + f).n !== g(s, 'f', f).n) fail('cf ' + s + f);
  }
  const sN = g(s, 's', '').n;
  const cross = {};
  let nSmall = 0, nCells = 0;
  for (const [dim, vals] of [['af', ['waku', 'other']], ['cf', ['yes', 'no']]]) {
    cross[dim] = {};
    for (const v of vals) {
      const base = g(s, dim === 'af' ? 'as' : 'cs', v).n;
      cross[dim][v] = { n_slit_ok: base, forms: {} };
      for (const [f, fl] of FORMS) {
        const o = g(s, dim, `${v}:${f}`);
        nCells++; if (o.n < 30) nSmall++;
        cross[dim][v].forms[f] = { label: fl, n: o.n, share_in_type: wilson(o.n, base), b1_win: wilson(o.r1[0], o.n) };
      }
    }
  }
  small[s] = { cells: nCells, under30: nSmall };
  const multi = bs.filter(([k]) => k.length >= 2).sort((a, b) => b[1].n - a[1].n);
  out.scopes[s] = {
    label, exclusions: e,
    overall: dist(all),
    a_waku: { waku: { ...dist(g(s, 'a', 'waku')), share: wilson(g(s, 'a', 'waku').n, all.n) }, other: { ...dist(g(s, 'a', 'other')), share: wilson(g(s, 'a', 'other').n, all.n) } },
    b_maeduke: { note: '枠なり以外のレースで、艇番より内のコースに入った艇の組（例 "6"＝6号艇だけ、"56"＝5号艇と6号艇）。分母は枠なり以外のレース',
      single: bs.filter(([k]) => k.length === 1).sort((a, b) => b[1].n - a[1].n).map(([k, o]) => ({ boats: k, ...dist(o), share: wilson(o.n, g(s, 'a', 'other').n) })),
      multi_top10: multi.slice(0, 10).map(([k, o]) => ({ boats: k, ...dist(o), share: wilson(o.n, g(s, 'a', 'other').n) })),
      multi_other: { combos: multi.length - Math.min(10, multi.length), n: multi.slice(10).reduce((p, [, o]) => p + o.n, 0) },
      all_combos: bs.sort((a, b) => b[1].n - a[1].n).map(([k, o]) => ({ boats: k, n: o.n })) },
    c_b1_course1: { yes: { ...dist(g(s, 'c', 'yes')), share: wilson(g(s, 'c', 'yes').n, all.n) }, no: { ...dist(g(s, 'c', 'no')), share: wilson(g(s, 'c', 'no').n, all.n) } },
    slit: { n_slit_ok: sN, forms: Object.fromEntries(FORMS.map(([f, fl]) => { const o = g(s, 'f', f); return [f, { label: fl, ...dist(o), share: wilson(o.n, sN) }]; })) },
    cross, small_cells: small[s],
  };
}
// prep4 / prep6 との照合: 全国の除外前 n
if (excl.all.n_pool !== p4['0|all|all'][0]) fail('全国の母集団が prep4 と違う');
if (excl.v20.n_pool !== p4['20|all|all'][0]) fail('若松の母集団が prep4 と違う');
if (excl.v20G1.n_pool !== p4['20|G1|all'][0]) fail('若松×G1 が prep4 と違う');
if (excl.G1y.n_pool !== p4['0|G1|yusho'][0] + p4['0|SG|yusho'][0]) fail('G1y が prep4 と違う');
const ex = rd('p7_exh.json');
out.exhibition_vs_actual = { ...ex, _meta: undefined,
  boat_match_rate: wilson(ex.boat_match, ex.boats), race_all_match_rate: wilson(ex.race_all_match, ex.n_ok),
  waku_forecast: { exh_waku: ex.exh_waku_actual_waku + ex.exh_waku_actual_not, precision: wilson(ex.exh_waku_actual_waku, ex.exh_waku_actual_waku + ex.exh_waku_actual_not),
    actual_waku: ex.exh_waku_actual_waku + ex.exh_not_actual_waku, recall: wilson(ex.exh_waku_actual_waku, ex.exh_waku_actual_waku + ex.exh_not_actual_waku) } };
out._meta = {
  data_version: '本番 Supabase（読み取りのみ、MCP execute_sql）2026-10-03 08:45〜08:55 JST 取得',
  population: '120 の analogy_pool_outcomes 相当、2019-04-01〜2026-09-26（408,723R）',
  course_and_st: '長期: kb_archive_boats.course・start_timing。本体: race_results.actual_course_1..6（i号艇のコース）と race_start_timings.start_timing。ST は round(st×100) の整数をコース順に並べて比べる',
  exclusion: '返還艇（F・出遅れ。本体は着欄 F/L/欠・refund_boats も＝120 と同じ）がいるレースと、進入が1艇でも不明のレースを除く（欠場は母集団で既に除外）。スリットは ST が1艇でも NULL のレースも除く。除いた件数は scopes.<範囲>.exclusions（進入不明・ST 不明は今回どの範囲でも0件）',
  slit_rule: 'BOA-635 spec（feature/boa-635-past-rate の docs/design/past-rate-check/spec.md「スリットの判定」）の1段目: 横一線 max−min≤6／内3艇そろう max(c1..c3)−min≤2／2コース凹み c2−min(c1,c3)≥5／カド受け凹み c3−min(c2,c4)≥5／カド一撃 min(c1,c2,c3)−c4≥3／イン凹み c1−c2≥5／ダッシュ勢先行 (c1+c2+c3)−(c4+c5+c6)≥15（1/100秒の整数）。形は重なりうる（1レースが複数の形に入る）',
  slow_dash: '出せなかった。スロー・ダッシュ（起こし位置）の列は DB に無い（exhibition_data・race_original_exhibition_values・kb_archive_* を確認。exhibition_data にあるのは展示の進入コースと展示 ST だけ）。ST の位置関係からカドを推定する案は、ダッシュの艇が ST で速く出るとは限らず（助走が長くても ST は判断で決まる）、推定の当たり外れを確かめる正解データも無いので、数字を出していない',
  maeduke: '前付け＝艇番より内のコースに入った艇。枠なりの崩れで外に押し出された艇は含まない。組のキーは該当する艇番を昇順に並べたもの',
  dead_heat: 'kb の3着同着は1着の集計に影響しない',
  check: 'build7.js で検算: 各セルの1着艇番・決まり手の合計が n、枠なり＋それ以外＝全体、1号艇1コース yes＋no＝全体、前付けの組の合計＝枠なり以外、形ごとに 枠なり×形＋それ以外×形＝形、yes×形＋no×形＝形。除外前の件数が prep4 の cube（全国 408,723・若松 17,172・若松×G1 823・G1以上の優勝戦 333）と一致',
  sql: ['sql/p7_tail.sql', 'sql/executed_p7_kb.sql', 'sql/executed_p7_main.sql', 'sql/p7_exh.sql'],
};
fs.writeFileSync(path.join(dir, 'prep7.json'), JSON.stringify(out, null, 1));
// md
const f3 = (x) => (x == null ? '-' : x.toFixed(3));
const ci = (w) => (w && w.p != null ? `${f3(w.p)} [${f3(w.lo)}–${f3(w.hi)}] ${w.x}/${w.n}` : '-');
const LINES = []; const L = (...xs) => LINES.push(...xs);
const VER = '本番 2026-10-03 08:45〜08:55 JST 取得';
L('# 進入・スリット（prep7）', '');
for (const [k, v] of Object.entries(out._meta)) if (typeof v === 'string') L(`- **${k}**: ${v}`);
L('', '各セルは「割合 [Wilson 95%CI] 件数/分母」。決まり手の順は 逃げ・差し・まくり・まくり差し・抜き・恵まれ・その他', '');
for (const [s, S] of Object.entries(out.scopes)) {
  const e = S.exclusions;
  L(`## ${S.label}`, '', `母集団 ${e.n_pool}R → 返還艇ありを除く ${e.ret}R・進入不明 ${e.course_unknown}R → 対象 ${e.n_ok}R（スリットは ST 不明 ${e.st_missing}R を除いて ${S.slit.n_slit_ok}R）。全体の1号艇1着率 ${ci(S.overall.b1_win)}`, '');
  L('### 1a・1c・1e 進入の型', '', '| 型 | 出現率 | 1号艇1着率 | 1着艇番 1〜6 | 決まり手 |', '|---|---|---|---|---|');
  for (const [lab, o] of [['全艇枠なり', S.a_waku.waku], ['枠なり以外', S.a_waku.other], ['1号艇が1コース', S.c_b1_course1.yes], ['1号艇が1コース以外', S.c_b1_course1.no]]) L(`| ${lab} | ${ci(o.share)} | ${ci(o.b1_win)} | ${o.winner_boat.join(', ')} | ${Object.values(o.technique).join(', ')} |`);
  L('', `出典: prep7.json \`scopes.${s}.a_waku\`・\`c_b1_course1\`／${VER}`, '');
  L('### 1b 前付けをした艇（枠なり以外のレースが分母）', '', '| 艇の組 | 出現率 | 1号艇1着率 | 1着艇番 1〜6 | 決まり手 |', '|---|---|---|---|---|');
  for (const o of S.b_maeduke.single) L(`| ${o.boats}号艇だけ | ${ci(o.share)} | ${ci(o.b1_win)} | ${o.winner_boat.join(', ')} | ${Object.values(o.technique).join(', ')} |`);
  for (const o of S.b_maeduke.multi_top10) L(`| ${o.boats.split('').join('・')}号艇 | ${ci(o.share)} | ${ci(o.b1_win)} | ${o.winner_boat.join(', ')} | ${Object.values(o.technique).join(', ')} |`);
  L(`| 2艇以上のその他 ${S.b_maeduke.multi_other.combos}通り | ${S.b_maeduke.multi_other.n}R | | | |`, '', `出典: prep7.json \`scopes.${s}.b_maeduke\`（全組は all_combos）／${VER}`, '');
  L('### 1d スロー・ダッシュ', '', '出せなかった（_meta.slow_dash）', '');
  L('### 2 スリット7形（1段目、形は重なりうる）', '', '| 形 | 出現率 | 1号艇1着率 | 1着艇番 1〜6 | 決まり手 |', '|---|---|---|---|---|');
  for (const [, o] of Object.entries(S.slit.forms)) L(`| ${o.label} | ${ci(o.share)} | ${ci(o.b1_win)} | ${o.winner_boat.join(', ')} | ${Object.values(o.technique).join(', ')} |`);
  L('', `出典: prep7.json \`scopes.${s}.slit\`／${VER}`, '');
  L(`### 3 進入×スリット（件数30未満のセル ${S.small_cells.under30}/${S.small_cells.cells}）`, '', '| 進入の型 | 形 | 件数（型の中での割合） | 1号艇1着率 |', '|---|---|---|---|');
  const lab = { waku: '全艇枠なり', other: '枠なり以外', yes: '1号艇が1コース', no: '1号艇が1コース以外' };
  for (const dim of ['af', 'cf']) for (const [v, o] of Object.entries(S.cross[dim])) for (const [, c] of Object.entries(o.forms)) L(`| ${lab[v]} | ${c.label} | ${c.n}${c.n < 30 ? '（30未満）' : ''}（${f3(c.share_in_type.p)}） | ${ci(c.b1_win)} |`);
  L('', `出典: prep7.json \`scopes.${s}.cross\`／${VER}`, '');
}
const E = out.exhibition_vs_actual;
L('## 4 展示の進入と本番の進入（本体）', '', `展示の進入（exhibition_data.exhibition_course）が6艇そろうのは、結果がある ${E.n_races_with_result}R のうち ${E.n_races_exh_course_6}R だけ（2026-04-10〜。月別 ${JSON.stringify(E.by_month)}）。本番の進入もそろう ${E.n_ok}R で数えた。`, '',
  `- 艇ごとの一致率: ${ci(E.boat_match_rate)}`, `- 6艇とも一致: ${ci(E.race_all_match_rate)}`,
  `- 展示が全艇枠なり → 本番も全艇枠なり: ${ci(E.waku_forecast.precision)}（展示が枠なり ${E.waku_forecast.exh_waku}R のうち）`,
  `- 本番が全艇枠なりのうち、展示も枠なりだった割合: ${ci(E.waku_forecast.recall)}`,
  `- 1号艇: 展示1コース→本番1コース ${E.b1_course1_exh_actual.yy}、展示1コース→本番1コース以外 ${E.b1_course1_exh_actual.yn}、展示1コース以外→本番1コース ${E.b1_course1_exh_actual.ny}、どちらも1コース以外 ${E.b1_course1_exh_actual.nn}`, '',
  `出典: prep7.json \`exhibition_vs_actual\`（sql/p7_exh.sql）／${VER}。母集団は 120 ではなく、この2列がそろう本体レース`);
fs.writeFileSync(path.join(dir, 'prep7.md'), LINES.join('\n'));
for (const [s, S] of Object.entries(out.scopes)) console.log(s, 'n', S.exclusions.n_ok, 'excl ret', S.exclusions.ret, 'waku', f3(S.a_waku.waku.share.p), 'b1in1', f3(S.c_b1_course1.yes.share.p), 'b1win waku/other', f3(S.a_waku.waku.b1_win.p), f3(S.a_waku.other.b1_win.p), 'forms', Object.values(S.slit.forms).map((o) => `${o.label}${f3(o.share.p)}/${f3(o.b1_win.p)}`).join(' '), 'small', JSON.stringify(S.small_cells), 'b top', S.b_maeduke.single.slice(0, 3).map((o) => o.boats + ':' + f3(o.share.p)).join(','), S.b_maeduke.multi_top10.slice(0, 3).map((o) => o.boats + ':' + f3(o.share.p)).join(','));
console.log('exh', f3(E.boat_match_rate.p), f3(E.race_all_match_rate.p), f3(E.waku_forecast.precision.p), f3(E.waku_forecast.recall.p));
