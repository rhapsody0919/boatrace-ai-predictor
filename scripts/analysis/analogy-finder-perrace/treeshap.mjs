// LightGBM dump_model JSON → 推論＋TreeSHAP（tree.cpp の移植）。検証用の試作
import { readFileSync } from 'node:fs';
const ZERO = 1e-35;
function compile(tree) {
  // ノードを配列に平坦化。葉は ~idx
  const N = { feat: [], thr: [], cats: [], cat: [], defLeft: [], miss: [], left: [], right: [], cnt: [] };
  const L = { value: [], cnt: [] };
  let maxDepth = 0;
  const walk = (n, d) => {
    if ('leaf_value' in n) { L.value.push(n.leaf_value); L.cnt.push(n.leaf_count); maxDepth = Math.max(maxDepth, d); return ~(L.value.length - 1); }
    const i = N.feat.length;
    N.feat.push(n.split_feature); N.cnt.push(n.internal_count);
    const isCat = n.decision_type === '==';
    N.cat.push(isCat); N.thr.push(isCat ? 0 : Number(n.threshold));
    N.cats.push(isCat ? new Set(String(n.threshold).split('||').map(Number)) : null);
    N.defLeft.push(n.default_left); N.miss.push(n.missing_type);
    N.left.push(0); N.right.push(0);
    N.left[i] = walk(n.left_child, d + 1); N.right[i] = walk(n.right_child, d + 1);
    return i;
  };
  if ('leaf_value' in tree) { L.value.push(tree.leaf_value); L.cnt.push(tree.leaf_count ?? 1); }
  else walk(tree, 0);
  const total = N.cnt.length ? N.cnt[0] : 1;
  let ev = 0; for (let i = 0; i < L.value.length; i++) ev += (L.cnt[i] / total) * L.value[i];
  return { N, L, maxDepth, ev, single: N.feat.length === 0 };
}
function decision(t, x, node) {
  const N = t.N; let f = x[N.feat[node]];
  if (N.cat[node]) {
    if (f === null || Number.isNaN(f)) return N.right[node];
    const iv = Math.trunc(f); if (iv < 0) return N.right[node];
    return N.cats[node].has(iv) ? N.left[node] : N.right[node];
  }
  const nan = f === null || Number.isNaN(f);
  if (nan && N.miss[node] !== 'NaN') f = 0;
  if ((N.miss[node] === 'Zero' && Math.abs(f) <= ZERO) || (N.miss[node] === 'NaN' && nan))
    return N.defLeft[node] ? N.left[node] : N.right[node];
  return f <= N.thr[node] ? N.left[node] : N.right[node];
}
const count = (t, n) => n >= 0 ? t.N.cnt[n] : t.L.cnt[~n];
export function predictRaw(trees, x) {
  let s = 0;
  for (const t of trees) { if (t.single) { s += t.L.value[0]; continue; } let n = 0; while (n >= 0) n = decision(t, x, n); s += t.L.value[~n]; }
  return s;
}
// path: 平坦な配列（feature, zero, one, pweight）
function extend(P, base, d, z, o, fi) {
  const k = (base + d) * 4; P[k] = fi; P[k + 1] = z; P[k + 2] = o; P[k + 3] = d === 0 ? 1 : 0;
  for (let i = d - 1; i >= 0; i--) {
    const a = (base + i) * 4;
    P[a + 4 + 3] += o * P[a + 3] * (i + 1) / (d + 1);
    P[a + 3] = z * P[a + 3] * (d - i) / (d + 1);
  }
}
function unwind(P, base, d, pi) {
  const o = P[(base + pi) * 4 + 2], z = P[(base + pi) * 4 + 1];
  let next = P[(base + d) * 4 + 3];
  for (let i = d - 1; i >= 0; i--) {
    const a = (base + i) * 4 + 3;
    if (o !== 0) { const tmp = P[a]; P[a] = next * (d + 1) / ((i + 1) * o); next = tmp - P[a] * z * (d - i) / (d + 1); }
    else P[a] = (P[a] * (d + 1)) / (z * (d - i));
  }
  for (let i = pi; i < d; i++) { const a = (base + i) * 4, b = a + 4; P[a] = P[b]; P[a + 1] = P[b + 1]; P[a + 2] = P[b + 2]; }
}
function unwoundSum(P, base, d, pi) {
  const o = P[(base + pi) * 4 + 2], z = P[(base + pi) * 4 + 1];
  let next = P[(base + d) * 4 + 3], total = 0;
  for (let i = d - 1; i >= 0; i--) {
    if (o !== 0) { const tmp = next * (d + 1) / ((i + 1) * o); total += tmp; next = P[(base + i) * 4 + 3] - tmp * z * ((d - i) / (d + 1)); }
    else total += (P[(base + i) * 4 + 3] / z) / ((d - i) / (d + 1));
  }
  return total;
}
function shap(t, x, phi, node, d, P, pbase, pz, po, pf) {
  const base = pbase + d; // 親の path を自分の領域へコピー
  if (d > 0) P.copyWithin(base * 4, pbase * 4, (pbase + d) * 4);
  extend(P, base, d, pz, po, pf);
  if (node < 0) {
    const v = t.L.value[~node];
    for (let i = 1; i <= d; i++) { const w = unwoundSum(P, base, d, i); const a = (base + i) * 4; phi[P[a]] += w * (P[a + 2] - P[a + 1]) * v; }
    return;
  }
  const hot = decision(t, x, node), cold = hot === t.N.left[node] ? t.N.right[node] : t.N.left[node];
  const w = count(t, node), hz = count(t, hot) / w, cz = count(t, cold) / w, sf = t.N.feat[node];
  let iz = 1, io = 1, pi = 0;
  for (; pi <= d; pi++) if (P[(base + pi) * 4] === sf) break;
  if (pi !== d + 1) { iz = P[(base + pi) * 4 + 1]; io = P[(base + pi) * 4 + 2]; unwind(P, base, d, pi); d -= 1; }
  shap(t, x, phi, hot, d + 1, P, base, hz * iz, io, sf);
  shap(t, x, phi, cold, d + 1, P, base, cz * iz, 0, sf);
}
export function contrib(trees, x, nf) {
  const phi = new Float64Array(nf + 1);
  for (const t of trees) {
    phi[nf] += t.ev; if (t.single) continue;
    const m = t.maxDepth + 2; const P = new Float64Array(m * (m + 1) / 2 * 4 + 64);
    shap(t, x, phi, 0, 0, P, 0, 1, 1, -1);
  }
  return phi;
}
export function load(path) { const d = JSON.parse(readFileSync(path, 'utf8')); return { trees: d.tree_info.map(ti => compile(ti.tree_structure)), nf: d.max_feature_idx + 1 }; }
if (process.argv[1].endsWith('treeshap.mjs')) {
  const dir = (process.env.TREESHAP_FIXTURE_DIR || new URL('.', import.meta.url).pathname).replace(/\/?$/, '/'); // model_dump.json と ref.json の置き場（ablate.py・timing.py が作る）
  let t0 = performance.now(); const { trees, nf } = load(dir + 'model_dump.json'); const tLoad = performance.now() - t0;
  const ref = JSON.parse(readFileSync(dir + 'ref.json', 'utf8'));
  let maxC = 0, maxR = 0, maxSum = 0;
  const run = (n) => { const out = []; for (let i = 0; i < n; i++) out.push(contrib(trees, ref.X[i], nf)); return out; };
  run(6); // warm-up
  const time = (n, rep) => { const ts = []; for (let r = 0; r < rep; r++) { const a = performance.now(); run(n); ts.push(performance.now() - a); } ts.sort((a, b) => a - b); return ts[Math.floor(ts.length / 2)]; };
  const t1 = time(6, 30), t168 = time(1008, 3);
  const all = run(1008);
  for (let i = 0; i < 1008; i++) {
    const r = predictRaw(trees, ref.X[i]); maxR = Math.max(maxR, Math.abs(r - ref.raw[i]));
    let s = 0; for (let j = 0; j <= nf; j++) { maxC = Math.max(maxC, Math.abs(all[i][j] - ref.contrib[i][j])); s += all[i][j]; }
    maxSum = Math.max(maxSum, Math.abs(s - ref.raw[i]));
  }
  console.log(JSON.stringify({ node: process.version, trees: trees.length, load_ms: +tLoad.toFixed(1), race1_contrib_ms_median: +t1.toFixed(2), races168_contrib_ms_median: +t168.toFixed(0), max_abs_diff_raw_vs_python: maxR, max_abs_diff_contrib_vs_python: maxC, max_abs_sum_contrib_minus_raw: maxSum, load: (await import('node:os')).loadavg() }, null, 1));
}
