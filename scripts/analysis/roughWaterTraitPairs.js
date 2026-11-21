// verify-rough-water-trait.js から字のまま移した、期間の対の分析（持続・置換の帰無分布・混同・風と波の関係・印の規則）と繰り返しの回数。副作用なし

import {
  mulberry32,
  r4,
  pt,
  trait,
  shuffledLabels,
  pearson,
  cov,
  spearman,
  mean,
  quantile,
  meanCI,
  medianOf,
} from "./roughWaterTraitStats.js";

const BOOT_REPS = 1000;
const PERM_REPS = 200;

const DEFS = ["self", "calm", "pop", "adj", "adjv"];

// 前後の両方で差が出せる選手の行（走数が minRuns に満たない選手は外す）
function pairedRows(pairs, minRuns) {
  const rows = [];
  for (const p of pairs) {
    const tA = trait(p.A, p.A.f, p.popA);
    const tB = trait(p.B, p.B.f, p.popB);
    if (!tA || !tB) continue;
    if (
      tA.nR < minRuns ||
      tB.nR < minRuns ||
      tA.nC < minRuns ||
      tB.nC < minRuns
    )
      continue;
    if (tA.adjv == null || tB.adjv == null) continue;
    rows.push({ p, tA, tB });
  }
  return rows;
}

// 前の五分位ごとの後の差
function quintilesOf(x, y) {
  const n = x.length;
  const order = x.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const quint = [];
  for (let q = 0; q < 5; q++) {
    const part = order
      .slice(Math.floor((q * n) / 5), Math.floor(((q + 1) * n) / 5))
      .map(([, i]) => i);
    const ci = meanCI(part.map((i) => y[i]));
    quint.push({
      q: q + 1,
      meanA_pt: pt(mean(part.map((i) => x[i]))),
      meanB_pt: pt(ci.mean),
      lo_pt: pt(ci.lo),
      hi_pt: pt(ci.hi),
      n: part.length,
    });
  }
  return quint;
}

// 1つの差の定義について、前後の相関・ブートストラップ区間・五分位
function persistence(rows, def, rand) {
  const n = rows.length;
  const x = rows.map((r) => r.tA[def]);
  const y = rows.map((r) => r.tB[def]);
  const rObs = pearson(x, y);
  const boot = [];
  for (let b = 0; b < BOOT_REPS; b++) {
    const bx = [],
      by = [];
    for (let k = 0; k < n; k++) {
      const j = Math.floor(rand() * n);
      bx.push(x[j]);
      by.push(y[j]);
    }
    boot.push(pearson(bx, by));
  }
  boot.sort((a, b) => a - b);
  const quint = quintilesOf(x, y);
  const sdA = Math.sqrt(cov(x, x));
  const cAB = cov(x, y);
  return {
    pearson: r4(rObs),
    ci95: [r4(quantile(boot, 0.025)), r4(quantile(boot, 0.975))],
    spearman: r4(spearman(x, y)),
    sdA_pt: pt(sdA),
    // 前後の共分散＝期間をまたいで残るばらつき（誤差が独立なら）。負なら 0
    persistentSd_pt: pt(Math.sqrt(Math.max(0, cAB))),
    covAB: r4(cAB * 1e4),
    // 前の差 1pt が後の期間に何pt 残るか（後の差を前の差に回帰した傾き）
    slopeBA: r4(cAB / (sdA * sdA)),
    quintiles: quint,
    q5MinusQ1B_pt: r4(quint[4].meanB_pt - quint[0].meanB_pt),
  };
}

// 並べ替え（荒れの札を、選手・期間ごとに同じ走数のまま入れ替える）。1回の入れ替えで self と adj を両方出す
function permutationNull(rows, rand) {
  const permDefs = ["self", "adj", "adjv"];
  const nullR = { self: [], adj: [], adjv: [] };
  const nullSd = { self: [], adj: [], adjv: [] };
  for (let k = 0; k < PERM_REPS; k++) {
    const x = { self: [], adj: [], adjv: [] };
    const y = { self: [], adj: [], adjv: [] };
    for (const r of rows) {
      const a = trait(r.p.A, shuffledLabels(r.p.A, rand), r.p.popA);
      const b = trait(r.p.B, shuffledLabels(r.p.B, rand), r.p.popB);
      for (const def of permDefs) {
        x[def].push(a[def]);
        y[def].push(b[def]);
      }
    }
    for (const def of permDefs) {
      nullR[def].push(pearson(x[def], y[def]));
      nullSd[def].push(Math.sqrt(cov(x[def], x[def])));
    }
  }
  return { permDefs, nullR, nullSd };
}

// 実際の相関を並べ替えの結果と比べて res[def].perm に書く
function attachPermutation(res, rows, rand) {
  const { permDefs, nullR, nullSd } = permutationNull(rows, rand);
  for (const def of permDefs) {
    const null_ = nullR[def].sort((a, b) => a - b);
    const sdNull = nullSd[def].sort((a, b) => a - b);
    const obs = res[def].pearson;
    res[def].perm = {
      reps: PERM_REPS,
      nullMean: r4(mean(null_)),
      null95: [r4(quantile(null_, 0.025)), r4(quantile(null_, 0.975))],
      pOneSided: r4(
        (null_.filter((v) => v >= obs).length + 1) / (PERM_REPS + 1),
      ),
      // 1つの期間の中のばらつき: 実際の差のSD と 入れ替えたときのSD
      sdObsA_pt: res[def].sdA_pt,
      sdNullA_pt: pt(mean(sdNull)),
      sdNullA95_pt: [pt(quantile(sdNull, 0.025)), pt(quantile(sdNull, 0.975))],
    };
  }
}

// 組ごとの相関（year の5組。同じ年の組み合わせで結果が揺れないか）
function byPairOf(rows) {
  const tags = [...new Set(rows.map((r) => r.p.tag).filter((t) => t != null))];
  if (tags.length <= 1) return undefined;
  return tags.map((tag) => {
    const sub = rows.filter((r) => r.p.tag === tag);
    const o = { pair: tag, nRacers: sub.length };
    for (const def of ["self", "adj", "adjv"])
      o[def] = r4(
        pearson(
          sub.map((r) => r.tA[def]),
          sub.map((r) => r.tB[def]),
        ),
      );
    return o;
  });
}

// 力量・コースとの相関（前の期間）
function confoundOf(rows) {
  const out = {};
  const nat = rows.map((r) => (r.p.A.natN ? r.p.A.nat / r.p.A.natN : 0));
  const c1 = rows.map((r) => r.p.A.c1 / r.p.A.y.length);
  for (const def of DEFS) {
    const x = rows.map((r) => r.tA[def]);
    out[def] = {
      vsNationalWinRate: r4(pearson(x, nat)),
      vsCourse1Share: r4(pearson(x, c1)),
    };
  }
  return out;
}

// 前後のペア（選手ごと）。pairs は [{A: d, B: d}]（d は racerRuns の値）
function analysePairs(pairs, popA, popB, minRuns, seed) {
  const rand = mulberry32(seed);
  const rows = pairedRows(pairs, minRuns);
  const n = rows.length;
  if (n < 30) return { nRacers: n };
  const res = {
    nRacers: n,
    nRoughA: medianOf(rows.map((r) => r.tA.nR)),
    nRoughB: medianOf(rows.map((r) => r.tB.nR)),
  };
  for (const def of DEFS) res[def] = persistence(rows, def, rand);
  attachPermutation(res, rows, rand);
  const byPair = byPairOf(rows);
  if (byPair) res.byPair = byPair;
  res.confound = confoundOf(rows);
  // 印の候補ルール（前の期間で決め、後の期間で確かめる）
  res.marks = markRules(rows);
  res.meanSeAdjA_pt = pt(Math.sqrt(mean(rows.map((r) => r.tA.seAdj2))));
  return res;
}

function markRules(rows) {
  const out = [];
  for (const def of ["self", "adj", "adjv"]) {
    for (const T of [0.05, 0.1, 0.15]) {
      const strong = rows.filter((r) => r.tA[def] >= T);
      const weak = rows.filter((r) => r.tA[def] <= -T);
      const none = rows.filter((r) => Math.abs(r.tA[def]) < T);
      const s = meanCI(strong.map((r) => r.tB.adj));
      const w = meanCI(weak.map((r) => r.tB.adj));
      const z = meanCI(none.map((r) => r.tB.adj));
      const sSelf = meanCI(strong.map((r) => r.tB.self));
      const wSelf = meanCI(weak.map((r) => r.tB.self));
      const signKeep =
        (strong.filter((r) => r.tB[def] > 0).length +
          weak.filter((r) => r.tB[def] < 0).length) /
        Math.max(1, strong.length + weak.length);
      out.push({
        def,
        threshold_pt: T * 100,
        shareMarked: r4((strong.length + weak.length) / rows.length),
        nStrong: strong.length,
        nWeak: weak.length,
        B_adj_strong_pt: [pt(s.mean), pt(s.lo), pt(s.hi)],
        B_adj_weak_pt: [pt(w.mean), pt(w.lo), pt(w.hi)],
        B_adj_none_pt: [pt(z.mean), pt(z.lo), pt(z.hi)],
        B_self_strong_pt: [pt(sSelf.mean), pt(sSelf.lo), pt(sSelf.hi)],
        B_self_weak_pt: [pt(wSelf.mean), pt(wSelf.lo), pt(wSelf.hi)],
        signKeptInB: r4(signKeep),
      });
    }
  }
  return out;
}

// 風と波の差の関係（adj）。同じ期間の相関は同じ走を共有するので、期間をまたいだ交差も出す
function windWaveRelation(dataA, dataB, outcome, minRuns) {
  const get = (data, cond, racer) => {
    const run = data[cond][outcome];
    const d = run.byRacer.get(racer);
    if (!d) return null;
    const t = trait(d, d.f, run.popRoughRate);
    return t && t.nR >= minRuns && t.nC >= minRuns ? t.adj : null;
  };
  const racers = [...dataA.wind[outcome].byRacer.keys()];
  const v = {
    wAwB: [[], []],
    vAvB: [[], []],
    wAvB: [[], []],
    vAwB: [[], []],
    wAvA: [[], []],
  };
  for (const id of racers) {
    const wA = get(dataA, "wind", id),
      vA = get(dataA, "wave", id);
    const wB = get(dataB, "wind", id),
      vB = get(dataB, "wave", id);
    if ([wA, vA, wB, vB].some((x) => x == null)) continue;
    v.wAwB[0].push(wA);
    v.wAwB[1].push(wB);
    v.vAvB[0].push(vA);
    v.vAvB[1].push(vB);
    v.wAvB[0].push(wA);
    v.wAvB[1].push(vB);
    v.vAwB[0].push(vA);
    v.vAwB[1].push(wB);
    v.wAvA[0].push(wA);
    v.wAvA[1].push(vA);
  }
  const o = { nRacers: v.wAwB[0].length };
  for (const [k, [x, y]] of Object.entries(v))
    o[k] = { r: r4(pearson(x, y)), cov: r4(cov(x, y) * 1e4) };
  return o;
}

export { BOOT_REPS, PERM_REPS, analysePairs, windWaveRelation };
