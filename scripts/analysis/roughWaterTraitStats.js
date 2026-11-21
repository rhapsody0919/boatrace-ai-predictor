// verify-rough-water-trait.js から字のまま移した統計の部品（乱数・相関・分位・平均の信頼区間）。副作用なし

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r4 = (x) =>
  x == null || !Number.isFinite(x) ? null : Math.round(x * 1e4) / 1e4;
const pt = (x) =>
  x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 10;

// 選手1人の差（札 labels は f と同じ長さの 0/1）
function trait(d, labels, popRoughRate) {
  let nR = 0,
    nC = 0,
    sR = 0,
    sC = 0,
    rR = 0,
    rC = 0,
    vR = 0,
    vC = 0;
  const byVenue = new Map();
  for (let k = 0; k < d.y.length; k++) {
    let g = byVenue.get(d.v[k]);
    if (!g) byVenue.set(d.v[k], (g = { nR: 0, nC: 0, rR: 0, rC: 0 }));
    if (labels[k] === 1) {
      nR += 1;
      sR += d.y[k];
      rR += d.y[k] - d.eR[k];
      vR += d.eR[k] * (1 - d.eR[k]);
      g.nR += 1;
      g.rR += d.y[k] - d.eR[k];
    } else {
      nC += 1;
      sC += d.y[k];
      rC += d.y[k] - d.eC[k];
      vC += d.eC[k] * (1 - d.eC[k]);
      g.nC += 1;
      g.rC += d.y[k] - d.eC[k];
    }
  }
  if (nR === 0 || nC === 0) return null;
  let wSum = 0,
    wd = 0;
  for (const g of byVenue.values()) {
    if (g.nR === 0 || g.nC === 0) continue;
    const w = (g.nR * g.nC) / (g.nR + g.nC);
    wSum += w;
    wd += w * (g.rR / g.nR - g.rC / g.nC);
  }
  const N = nR + nC;
  const pR = sR / nR;
  const pC = sC / nC;
  const pAll = (sR + sC) / N;
  return {
    nR,
    nC,
    pR,
    pAll,
    self: pR - pAll,
    calm: pR - pC,
    pop: pR - popRoughRate,
    adj: rR / nR - rC / nC,
    adjv: wSum > 0 ? wd / wSum : null,
    adjvWeight: wSum,
    seAdj2: vR / nR / nR + vC / nC / nC,
  };
}

// 札を会場ごとに入れ替える（会場の中の荒れの走数は保つ）
function shuffledLabels(d, rand) {
  if (!d.groups) {
    const m = new Map();
    d.v.forEach((v, k) => {
      if (!m.has(v)) m.set(v, []);
      m.get(v).push(k);
    });
    d.groups = [...m.values()];
  }
  const a = d.f.slice();
  for (const idx of d.groups) {
    for (let k = idx.length - 1; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1));
      const t = a[idx[k]];
      a[idx[k]] = a[idx[j]];
      a[idx[j]] = t;
    }
  }
  return a;
}

// ---------- 統計 ----------
function pearson(x, y) {
  const n = x.length;
  if (n < 3) return null;
  let mx = 0,
    my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}
function cov(x, y) {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let s = 0;
  for (let i = 0; i < n; i++) s += (x[i] - mx) * (y[i] - my);
  return s / (n - 1);
}
function ranks(x) {
  const idx = x.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(x.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}
const spearman = (x, y) => pearson(ranks(x), ranks(y));
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const quantile = (sorted, q) =>
  sorted[
    Math.min(
      sorted.length - 1,
      Math.max(0, Math.floor(q * (sorted.length - 1))),
    )
  ];
function meanCI(a) {
  const m = mean(a);
  if (a.length < 2) return { mean: m, lo: null, hi: null, n: a.length };
  const sd = Math.sqrt(
    a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1),
  );
  const se = sd / Math.sqrt(a.length);
  return { mean: m, lo: m - 1.96 * se, hi: m + 1.96 * se, n: a.length };
}

function medianOf(a) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

export {
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
};
