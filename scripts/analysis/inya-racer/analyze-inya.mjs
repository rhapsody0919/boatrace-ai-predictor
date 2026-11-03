#!/usr/bin/env node
/**
 * イン屋（前付け）・アウト屋の指標の比較・分布・安定性・会場の補正・レースへの影響（2026-11-03、オーナー依頼）。
 *   node scripts/analysis/inya-racer/analyze-inya.mjs [--work data/analysis/inya-racer/work] [--out data/analysis/inya-racer]
 * 材料は fetch-starts.mjs・fetch-period-entries.mjs の work/。出力は inya-metrics.json・inya-candidates.json
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const WORK = arg("--work", "data/analysis/inya-racer/work");
const OUT = arg("--out", "data/analysis/inya-racer");
const { meta, starts } = JSON.parse(fs.readFileSync(path.join(WORK, "starts.json")));
const { races } = JSON.parse(fs.readFileSync(path.join(WORK, "races.json")));
const { names } = JSON.parse(fs.readFileSync(path.join(WORK, "names.json")));
const period = JSON.parse(fs.readFileSync(path.join(WORK, "period-entries.json"))).rows;

// 窓: 直近12か月（データの最終日まで）、その前の12か月（安定性と時系列の分割の学習側）
const W = { from: 20251103, to: 20261102 };
const P = { from: 20241103, to: 20251102 };
const ACTIVE_FROM = 20260503; // 直近6か月に出走があれば現役
const MIN_N = 30; // 4〜6号艇の走（A）・1〜3号艇の走（アウトの鏡）の下限
const half = (d) => { const y = Math.floor(d / 10000), m = Math.floor(d / 100) % 100; return m >= 11 ? `${y}-11` : m <= 4 ? `${y - 1}-11` : `${y}-05`; };

const wilson = (k, n, z = 1.96) => {
  if (!n) return [null, null];
  const p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [c - h, c + h];
};
const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); const i = (a.length - 1) * p, lo = Math.floor(i); return a[lo] + (a[Math.min(lo + 1, a.length - 1)] - a[lo]) * (i - lo); };
const pearson = (xs, ys) => { const n = xs.length, mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n; let a = 0, b = 0, c = 0; for (let i = 0; i < n; i++) { a += (xs[i] - mx) * (ys[i] - my); b += (xs[i] - mx) ** 2; c += (ys[i] - my) ** 2; } return a / Math.sqrt(b * c); };
const rank = (xs) => { const idx = xs.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = Array(xs.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; } return r; };
const spearman = (xs, ys) => pearson(rank(xs), rank(ys));
const r3 = (v) => (v == null ? null : Math.round(v * 1000) / 1000);

// 選手×窓の集計
const blank = () => ({ n: 0, n46: 0, a: 0, c12: 0, inner: 0, n25: 0, inner25: 0, n13: 0, o13: 0, c6: 0, outer: 0, n15: 0, own12: 0, expA: 0, expO: 0, last: 0 });
function tally(from, to, key = () => "w") {
  const m = new Map();
  for (const [id, d, v, bn, co] of starts) {
    if (d < from || d > to) continue;
    const k = `${id}|${key(d)}`;
    let t = m.get(k); if (!t) m.set(k, (t = blank()));
    t.n++; t.last = Math.max(t.last, d);
    if (bn <= 2) t.own12++;
    if (co <= 2) t.c12++;
    if (co === 6) t.c6++;
    if (bn >= 4) { t.n46++; if (co <= 3) t.a++; }
    if (bn >= 2) { t.n25++; if (co < bn) t.inner25++; }
    if (co < bn) t.inner++;
    if (bn <= 5) { t.n15++; if (co > bn) t.outer++; }
    if (bn <= 3) { t.n13++; if (co >= 4) t.o13++; }
  }
  return m;
}
// 会場ごとの期待値（窓 W の全出走）: 4〜6号艇が3コース以内に入る率、1〜3号艇が4コース以遠に出る率
const venueRate = (from, to) => {
  const v = new Map();
  for (const [, d, ve, bn, co] of starts) {
    if (d < from || d > to) continue;
    let t = v.get(ve); if (!t) v.set(ve, (t = { n46: 0, a: 0, n13: 0, o13: 0, n: 0, nari: 0 }));
    t.n++; if (co === bn) t.nari++;
    if (bn >= 4) { t.n46++; if (co <= 3) t.a++; }
    if (bn <= 3) { t.n13++; if (co >= 4) t.o13++; }
  }
  return v;
};
const vW = venueRate(W.from, W.to);
const mW = tally(W.from, W.to);
for (const [id, d, ve, bn] of starts) { // 会場の期待値を各選手に積む
  if (d < W.from || d > W.to) continue;
  const t = mW.get(`${id}|w`), vr = vW.get(ve);
  if (bn >= 4) t.expA += vr.a / vr.n46;
  if (bn <= 3) t.expO += vr.o13 / vr.n13;
}
const rowsW = [...mW].map(([k, t]) => {
  const id = Number(k.split("|")[0]);
  const [aLo, aHi] = wilson(t.a, t.n46), [oLo, oHi] = wilson(t.o13, t.n13);
  return { id, ...names[id], starts: t.n, n46: t.n46, A: t.a / t.n46, A_lo: aLo, A_hi: aHi, A_venueExp: t.expA / t.n46,
    B: t.c12 / t.n, B_ownBoat12: t.own12 / t.n, C: t.inner / t.n, C25: t.inner25 / t.n25,
    n13: t.n13, O: t.o13 / t.n13, O_lo: oLo, O_hi: oHi, O_venueExp: t.expO / t.n13, c6: t.c6 / t.n, outer: t.outer / t.n15, a_k: t.a, o_k: t.o13, last: t.last };
});
const active = rowsW.filter((r) => r.last >= ACTIVE_FROM);
const elig = active.filter((r) => r.n46 >= MIN_N);
const eligO = active.filter((r) => r.n13 >= MIN_N);

const qs = [0.5, 0.75, 0.9, 0.95, 0.98, 0.99, 0.995];
const dist = (rows, f) => Object.fromEntries([["n", rows.length], ["mean", r3(rows.reduce((s, r) => s + f(r), 0) / rows.length)], ["min", r3(Math.min(...rows.map(f)))], ...qs.map((p) => [`p${p * 100}`, r3(q(rows.map(f), p))]), ["max", r3(Math.max(...rows.map(f)))]]);
const distribution = {
  A_maeduke: dist(elig, (r) => r.A), B_c12: dist(elig, (r) => r.B), B_minus_ownBoat12: dist(elig, (r) => r.B - r.B_ownBoat12),
  C_inner_all: dist(elig, (r) => r.C), C_inner_boat2to6: dist(elig, (r) => r.C25),
  A_minus_venueExp: dist(elig, (r) => r.A - r.A_venueExp),
  O_out_from_boat1to3: dist(eligO, (r) => r.O), c6_share: dist(eligO, (r) => r.c6),
};
// 指標どうしの相関（elig）
const cor = (f, g) => r3(spearman(elig.map(f), elig.map(g)));
const metricCorr = { A_B: cor((r) => r.A, (r) => r.B), A_C: cor((r) => r.A, (r) => r.C), A_C25: cor((r) => r.A, (r) => r.C25), B_C: cor((r) => r.B, (r) => r.C), B_ownBoat12: cor((r) => r.B, (r) => r.B_ownBoat12), A_Avenue: cor((r) => r.A, (r) => r.A - r.A_venueExp) };
// 上位の頭数（A）: 境目の候補ごと
const nameOf = (r) => ({ racer_id: r.id, name: r.name ?? null, grade: r.grade ?? null, branch: r.branch ?? null });
const candRow = (r, side) => side === "in"
  ? { ...nameOf(r), metric: "A", value: r3(r.A), wilson95: [r3(r.A_lo), r3(r.A_hi)], k: r.a_k, n: r.n46, venueExp: r3(r.A_venueExp), starts: r.starts, B_c12: r3(r.B), C_inner: r3(r.C) }
  : { ...nameOf(r), metric: "O", value: r3(r.O), wilson95: [r3(r.O_lo), r3(r.O_hi)], k: r.o_k, n: r.n13, venueExp: r3(r.O_venueExp), starts: r.starts, c6_share: r3(r.c6), outer: r3(r.outer) };
const sortedA = [...elig].sort((x, y) => y.A - x.A), sortedO = [...eligO].sort((x, y) => y.O - x.O);
const cuts = (sorted, side, val, lo) => {
  const out = {};
  for (const p of [0.01, 0.02, 0.05]) { const k = Math.max(1, Math.round(sorted.length * p)); const thr = val(sorted[k - 1]); out[`top${p * 100}pct`] = { rule: `上位${p * 100}%（${k}人目の値 ${r3(thr)} 以上）`, threshold: r3(thr), racers: sorted.filter((r) => val(r) >= thr).map((r) => candRow(r, side)) }; }
  for (const t of [0.1, 0.2, 0.3]) out[`lower_ge_${t}`] = { rule: `Wilson 95% の下限が ${t} 以上`, threshold: t, racers: sorted.filter((r) => lo(r) >= t).map((r) => candRow(r, side)) };
  return out;
};
const inCuts = cuts(sortedA, "in", (r) => r.A, (r) => r.A_lo);
const outCuts = cuts(sortedO, "out", (r) => r.O, (r) => r.O_lo);

// 安定性: 前の12か月 × 直近12か月、半期（公式の算出期間と同じ 11〜4月・5〜10月）の隣どうし
const mP = tally(P.from, P.to);
const pair = (mA, mB, f, nf, min) => { const xs = [], ys = []; for (const [k, a] of mA) { const b = mB.get(k); if (!b || nf(a) < min || nf(b) < min) continue; xs.push(f(a)); ys.push(f(b)); } return { pairs: xs.length, pearson: r3(pearson(xs, ys)), spearman: r3(spearman(xs, ys)) }; };
const fA = (t) => t.a / t.n46, nA = (t) => t.n46, fB = (t) => t.c12 / t.n, nAll = (t) => t.n, fC = (t) => t.inner / t.n, fO = (t) => t.o13 / t.n13, nO = (t) => t.n13;
const mH = tally(20190401, W.to, half);
const halves = [...new Set([...mH.keys()].map((k) => k.split("|")[1]))].sort().filter((h) => [...mH.keys()].filter((k) => k.endsWith(`|${h}`)).length >= 1000); // 始まったばかりの半期は除く
const byHalf = (h) => new Map([...mH].filter(([k]) => k.endsWith(`|${h}`)).map(([k, t]) => [k.split("|")[0] + "|w", t]));
const halfPairs = [];
for (let i = 1; i < halves.length; i++) {
  const a = byHalf(halves[i - 1]), b = byHalf(halves[i]);
  halfPairs.push({ from: halves[i - 1], to: halves[i], A_min15: pair(a, b, fA, nA, 15), B_min30: pair(a, b, fB, nAll, 30), C_min30: pair(a, b, fC, nAll, 30), O_min15: pair(a, b, fO, nO, 15) });
}
const stability = {
  year_prev_vs_last: { A: pair(mP, mW, fA, nA, MIN_N), B: pair(mP, mW, fB, nAll, MIN_N), C: pair(mP, mW, fC, nAll, MIN_N), O: pair(mP, mW, fO, nO, MIN_N) },
  half_pairs: halfPairs,
};
// 上位の顔ぶれの持続: 前の12か月の上位1%・2%が直近でも上位に残るか
const topSet = (m, p) => { const rs = [...m].map(([k, t]) => ({ id: k.split("|")[0], t })).filter((r) => r.t.n46 >= MIN_N).sort((x, y) => fA(y.t) - fA(x.t)); return new Set(rs.slice(0, Math.max(1, Math.round(rs.length * p))).map((r) => r.id)); };
const persistence = Object.fromEntries([0.01, 0.02, 0.05].map((p) => { const a = topSet(mP, p), b = topSet(mW, p); const both = [...a].filter((x) => b.has(x)).length; return [`top${p * 100}pct`, { prev: a.size, last: b.size, both }]; }));

// 公式の期別（kb を含む長い期間）での B の照合: 同じ期の出走からの B と、c{N}_entries からの B
const pe = new Map(); for (const r of period) { const tot = r.e1 + r.e2 + r.e3 + r.e4 + r.e5 + r.e6; if (tot > 0) pe.set(`${r.id}|${r.f.slice(0, 4)}-${r.f.slice(5, 7)}`, { tot, b: (r.e1 + r.e2) / tot, inner3: (r.e1 + r.e2 + r.e3) / tot, c6: r.e6 / tot }); }
const pxs = [], pys = []; for (const [k, t] of mH) { const p = pe.get(k); if (!p || t.n < 30 || p.tot < 30) continue; pxs.push(t.c12 / t.n); pys.push(p.b); }
const officialB = { pairs: pxs.length, pearson_raceLevel_vs_official: r3(pearson(pxs, pys)), meanAbsDiff: r3(pxs.reduce((s, v, i) => s + Math.abs(v - pys[i]), 0) / pxs.length) };
// 公式の期別だけで出せる B の期→期の安定性（2018〜）
const officialPeriods = [...new Set(period.map((r) => `${r.y}-${r.p}`))].sort();
const offStab = []; for (let i = 1; i < officialPeriods.length; i++) { const a = period.filter((r) => `${r.y}-${r.p}` === officialPeriods[i - 1]), b = new Map(period.filter((r) => `${r.y}-${r.p}` === officialPeriods[i]).map((r) => [r.id, r])); const xs = [], ys = []; for (const r of a) { const s = b.get(r.id); if (!s) continue; const ta = r.e1 + r.e2 + r.e3 + r.e4 + r.e5 + r.e6, tb = s.e1 + s.e2 + s.e3 + s.e4 + s.e5 + s.e6; if (ta < 30 || tb < 30) continue; xs.push((r.e1 + r.e2) / ta); ys.push((s.e1 + s.e2) / tb); } offStab.push({ from: officialPeriods[i - 1], to: officialPeriods[i], pairs: xs.length, pearson: r3(pearson(xs, ys)) }); }

// 会場: 4〜6号艇が3コース以内に入る率・枠なりの率
const venues = [...vW].sort((a, b) => a[0] - b[0]).map(([v, t]) => ({ venue: v, starts: t.n, A_rate: r3(t.a / t.n46), O_rate: r3(t.o13 / t.n13), waku_nari_start_rate: r3(t.nari / t.n) }));
// 会場で補正した順位と生の順位の上位の重なり
const k2 = Math.round(elig.length * 0.02);
const topRaw = new Set(sortedA.slice(0, k2).map((r) => r.id));
const adj = [...elig].sort((x, y) => (y.A - y.A_venueExp) - (x.A - x.A_venueExp)).slice(0, k2);
const venueCheck = { top2pct_n: k2, overlap_raw_vs_venueAdjusted: adj.filter((r) => topRaw.has(r.id)).length, onlyInAdjusted: adj.filter((r) => !topRaw.has(r.id)).map((r) => candRow(r, "in")) };

// レースへの影響（時系列で分ける）: 前の12か月 P で A の上位2%（n46>=30）を「前付け選手」と決め、本体期間（2025-12-03〜）のレースで見る
const trainTop = new Set([...mP].map(([k, t]) => ({ id: Number(k.split("|")[0]), t })).filter((r) => r.t.n46 >= MIN_N).sort((x, y) => fA(y.t) - fA(x.t)).slice(0, Math.round([...mP].filter(([, t]) => t.n46 >= MIN_N).length * 0.02)).map((r) => r.id));
const band = (w) => (w == null ? "na" : w < 4 ? "<4" : w < 5 ? "4-5" : w < 6 ? "5-6" : w < 7 ? "6-7" : "7+");
const strata = new Map(); const obs = [];
for (const [rid, d, v, g, b1win, co, ids, wr] of races) {
  if (b1win == null || co.some((x) => x == null) || ids.some((x) => x == null)) continue;
  if (d <= P.to) continue; // 学習の窓の後だけ
  const inyaBoats = ids.map((id, i) => (trainTop.has(id) ? i + 1 : null)).filter((x) => x != null && x >= 2);
  const grp = inyaBoats.length === 0 ? "none" : inyaBoats.some((b) => b >= 4) ? "boat4to6" : "boat2to3";
  const s = `${v}|${band(wr[0])}`;
  const y = { b1win, b1c1: co[0] === 1 ? 1 : 0, nari: co.every((x, i) => x === i + 1) ? 1 : 0 };
  obs.push({ s, grp, y });
  if (grp === "none") { let t = strata.get(s); if (!t) strata.set(s, (t = { n: 0, b1win: 0, b1c1: 0, nari: 0 })); t.n++; t.b1win += y.b1win; t.b1c1 += y.b1c1; t.nari += y.nari; }
}
const effect = {};
for (const grp of ["none", "boat4to6", "boat2to3"]) {
  const rs = obs.filter((o) => o.grp === grp); const e = { races: rs.length };
  for (const key of ["b1win", "b1c1", "nari"]) {
    const o = rs.reduce((s, r) => s + r.y[key], 0); let ex = 0, va = 0, used = 0;
    for (const r of rs) { const t = strata.get(r.s); if (!t || t.n < 30) continue; const p = t[key] / t.n; ex += p; va += p * (1 - p); used++; }
    const ou = rs.filter((r) => (strata.get(r.s)?.n ?? 0) >= 30).reduce((s, r) => s + r.y[key], 0);
    e[key] = { rate: r3(o / rs.length), wilson95: wilson(o, rs.length).map(r3), expected_same_venue_boat1band: r3(ex / used), diff_pt: r3((ou - ex) / used * 100), diff_95pt: r3(1.96 * Math.sqrt(va) / used * 100), matched: used };
  }
  effect[grp] = e;
}

// 境目の規則（Wilson 下限）の持続: 前の12か月と直近12か月、直近の半期どうし
const ruleSet = (m, lo, min = MIN_N) => new Set([...m].filter(([, t]) => t.n46 >= min && wilson(t.a, t.n46)[0] >= lo).map(([k]) => k.split("|")[0]));
const H1 = byHalf("2025-11"), H2 = byHalf("2026-05");
const rulePersistence = Object.fromEntries([0.1, 0.2, 0.3].map((lo) => { const a = ruleSet(mP, lo), b = ruleSet(mW, lo), h1 = ruleSet(H1, lo, 15), h2 = ruleSet(H2, lo, 15); return [`lower_ge_${lo}`, { year: { prev: a.size, last: b.size, both: [...a].filter((x) => b.has(x)).length }, half_min15: { "2025-11": h1.size, "2026-05": h2.size, both: [...h1].filter((x) => h2.has(x)).length } }]; }));
// 4〜6号艇の走が少ないときのぶれ: 直近12か月で lower>=0.3 の選手の値を、走を間引いて（先頭から n 走）出すと規則に入るか
const shrink = {}; { const byId = new Map(); for (const [id, d, , bn, co] of starts) { if (d < W.from || d > W.to || bn < 4) continue; if (!byId.has(id)) byId.set(id, []); byId.get(id).push(co <= 3 ? 1 : 0); }
  const top = [...ruleSet(mW, 0.3)].map(Number);
  for (const n of [10, 15, 20, 30]) { let inRule = 0; for (const id of top) { const a = byId.get(id).slice(-n); const k = a.reduce((s, v) => s + v, 0); if (wilson(k, a.length)[0] >= 0.3) inRule++; } shrink[`last${n}`] = { of: top.length, stillLowerGe0_3: inRule }; }
  const others = [...byId].filter(([id, a]) => !top.includes(id) && a.length >= 30); for (const n of [10, 15, 20, 30]) { let fp = 0; for (const [, arr] of others) { const a = arr.slice(-n); const k = a.reduce((s, v) => s + v, 0); if (wilson(k, a.length)[0] >= 0.3) fp++; } shrink[`last${n}`].othersFalselyIn = fp; shrink[`last${n}`].others = others.length; } }
// アウト屋の鏡 O の「押し出され」の混入: 本体期間で、1〜3号艇が4コース以遠に出たレースのうち、
// 直近12か月の規則（A の Wilson 下限0.3以上）に入る前付け選手が4〜6号艇から3コース以内に入っていた割合
const inyaW = new Set([...ruleSet(mW, 0.3)].map(Number));
const pushed = new Map(); for (const [, d, , , , co, ids] of races) { if (co.some((x) => x == null) || ids.some((x) => x == null)) continue;
  const inyaIn = [3, 4, 5].some((i) => co[i] <= 3 && inyaW.has(ids[i]));
  for (let b = 1; b <= 3; b++) { if (co[b - 1] < 4) continue; const id = ids[b - 1]; let t = pushed.get(id); if (!t) pushed.set(id, (t = { out: 0, withInya: 0 })); t.out++; if (inyaIn) t.withInya++; } }
const allOut = [...pushed.values()].reduce((a, t) => ({ out: a.out + t.out, withInya: a.withInya + t.withInya }), { out: 0, withInya: 0 });
const outPushed = { allRacers: allOut, top2pct: outCuts.top2pct.racers.map((r) => ({ racer_id: r.racer_id, name: r.name, O: r.value, mainPeriodOutStarts: pushed.get(r.racer_id)?.out ?? 0, ofWhichInyaWentIn: pushed.get(r.racer_id)?.withInya ?? 0 })) };
const nishijima = rowsW.find((r) => r.id === 3024);
const result = {
  generatedAt: new Date().toISOString(), fetchedAt: meta.fetchedAt,
  source: { kb_archive_boats: "2019-04-01〜2025-12-02（course）", race_results: "2025-12-03〜2026-11-02（actual_course_N、N=艇番）×race_entries.racer_id", racer_period_stats: "c1〜c6_entries（2018〜、B の照合）", starts: meta.starts, races_main: meta.races },
  windows: { last12: W, prev12: P, activeFrom: ACTIVE_FROM, minN: MIN_N },
  definitions: { A: "4〜6号艇の走のうち進入1〜3コース", B: "全走のうち進入1・2コース", C: "全走のうち進入コース < 艇番", C25: "2〜6号艇の走のうち進入コース < 艇番", O: "アウト屋の鏡: 1〜3号艇の走のうち進入4〜6コース", c6: "全走のうち6コース", venueExp: "その選手が走った会場の、同じ艇番群の全選手の率の平均（出走で重み）" },
  population: { racersInWindow: rowsW.length, active: active.length, eligA: elig.length, eligO: eligO.length },
  distribution, metricCorr, stability, persistence, rulePersistence, shrink, outPushed, officialB, officialB_stability: offStab, venues, venueCheck,
  raceEffect: { def: "前の12か月（2024-11-03〜2025-11-02）で A の上位2%（n46>=30）を前付け選手と決め、2025-11-03より後の本体期間のレース（6艇の進入がそろうもの）で比べる。期待値は前付け選手のいないレースの同じ会場×1号艇の勝率帯の率", trainTopN: trainTop.size, ...effect },
  nishijima3024: nishijima ? { ...candRow(nishijima, "in"), O: r3(nishijima.O), rankA: sortedA.findIndex((r) => r.id === 3024) + 1, of: sortedA.length } : null,
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "inya-metrics.json"), JSON.stringify(result, null, 1));
fs.writeFileSync(path.join(OUT, "inya-candidates.json"), JSON.stringify({ generatedAt: result.generatedAt, fetchedAt: meta.fetchedAt, window: W, activeFrom: ACTIVE_FROM, minN: MIN_N, population: result.population,
  note: "どの選手にも同じ基準。in は A（4〜6号艇→1〜3コース）、out は O（1〜3号艇→4〜6コース）。value は率、wilson95 は95%区間、n は分母の走数",
  in: inCuts, out: outCuts }, null, 1));
console.log(JSON.stringify({ population: result.population, distribution, metricCorr, stability: stability.year_prev_vs_last, persistence, rulePersistence, shrink, outPushed, venues, officialB_stability: offStab, officialB, venueCheck: { ...venueCheck, onlyInAdjusted: venueCheck.onlyInAdjusted.map((r) => `${r.racer_id}${r.name}`) }, raceEffect: result.raceEffect, nishijima: result.nishijima3024 }, null, 1));
