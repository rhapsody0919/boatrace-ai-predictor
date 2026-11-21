// analyze-weather-in-escape.js から字のまま移した統計の部品（期待値・ブートストラップ・区分の要約・判定）と、その定数。副作用なし

const FIRST_HALF_END = "2022-12-31";

const TECHNIQUES = ["逃げ", "差し", "まくり", "まくり差し", "抜き", "恵まれ"];

const BOOT_REPS = 1000;
const CI_LEVEL = 0.975; // Bonferroni（判定の機会が2つ）
const MIN_STRATUM = 30;
const VENUE_SIGN_MIN_N = 300;

const pt = (x) =>
  x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 10;

// 再現できるよう、ブートストラップの乱数は種を固定する
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

/** 会場×月×レース番号帯×級別の期待値（30件未満の層は会場×月） */
function expectedRates(races) {
  const strata = new Map();
  const fallback = new Map();
  const add = (m, k, r) => {
    const s = m.get(k) ?? { n: 0, win: 0 };
    s.n += 1;
    s.win += r.inWin;
    m.set(k, s);
  };
  for (const r of races) {
    add(fallback, `${r.venue}|${r.month}`, r);
    if (r.cls) add(strata, `${r.venue}|${r.month}|${r.rnBand}|${r.cls}`, r);
  }
  return (r) => {
    const s = r.cls
      ? strata.get(`${r.venue}|${r.month}|${r.rnBand}|${r.cls}`)
      : null;
    const f =
      s && s.n >= MIN_STRATUM ? s : fallback.get(`${r.venue}|${r.month}`);
    return f.win / f.n;
  };
}

/** 全会場の差 D̄（区分ごと）。venueAgg: Map(venue → {N, W, bins: {key: {n, w}}}) */
function pooledDiff(venueAgg, binKey) {
  let n = 0;
  let num = 0;
  for (const v of venueAgg.values()) {
    const b = v.bins[binKey];
    if (!b || !b.n || !v.N) continue;
    n += b.n;
    num += b.w - (b.n * v.W) / v.N;
  }
  return n ? num / n : null;
}

/** 区分ごとの件数 {n, w} に1レース分を足す */
function addToBin(agg, key, inWin) {
  agg.bins[key] ??= { n: 0, w: 0 };
  agg.bins[key].n += 1;
  agg.bins[key].w += inWin;
}

/** 対象レースを 会場×日（クラスタ）・会場・会場×区分の技・補正用の残差に集める */
function accumulateRaces(target, binOf, expected) {
  // 会場 → 会場×日（クラスタ）→ 区分ごとの件数
  const clustersByVenue = new Map();
  const venueAgg = new Map();
  const tech = new Map();
  const adj = new Map();
  for (const r of target) {
    const key = binOf(r);
    const cKey = r.date;
    let cl = clustersByVenue.get(r.venue);
    if (!cl) clustersByVenue.set(r.venue, (cl = new Map()));
    const c = cl.get(cKey) ?? { N: 0, W: 0, bins: {} };
    c.N += 1;
    c.W += r.inWin;
    addToBin(c, key, r.inWin);
    cl.set(cKey, c);

    const v = venueAgg.get(r.venue) ?? { N: 0, W: 0, bins: {} };
    v.N += 1;
    v.W += r.inWin;
    addToBin(v, key, r.inWin);
    venueAgg.set(r.venue, v);

    const tk = `${r.venue}|${key}`;
    const t = tech.get(tk) ?? {};
    if (r.technique) t[r.technique] = (t[r.technique] ?? 0) + 1;
    tech.set(tk, t);

    if (expected) {
      const a = adj.get(key) ?? { n: 0, resid: 0 };
      a.n += 1;
      a.resid += r.inWin - expected(r);
      adj.set(key, a);
    }
  }
  return { clustersByVenue, venueAgg, tech, adj };
}

/** 会場ごとにクラスタ（日）を復元抽出して、区分ごとの全会場の差 D̄ を BOOT_REPS 回出す */
function bootstrapDiffs(clustersByVenue, bins) {
  const rand = mulberry32(211);
  const clusterLists = [...clustersByVenue].map(([venue, m]) => [
    venue,
    [...m.values()],
  ]);
  const boot = Object.fromEntries(bins.map((b) => [b.key, []]));
  for (let i = 0; i < BOOT_REPS; i++) {
    const agg = new Map();
    for (const [venue, list] of clusterLists) {
      const v = { N: 0, W: 0, bins: {} };
      for (let j = 0; j < list.length; j++) {
        const c = list[Math.floor(rand() * list.length)];
        v.N += c.N;
        v.W += c.W;
        for (const [k, b] of Object.entries(c.bins)) {
          v.bins[k] ??= { n: 0, w: 0 };
          v.bins[k].n += b.n;
          v.bins[k].w += b.w;
        }
      }
      agg.set(venue, v);
    }
    for (const b of bins) boot[b.key].push(pooledDiff(agg, b.key));
  }
  return boot;
}

function quantile(arr, q) {
  const s = arr.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null;
}

/** 会場×区分の結果を venues へ書く */
function recordVenueBin(venues, venue, v, b, key, d, tech) {
  venues[venue] ??= {
    all: { n: v.N, inWinRate: pt(v.W / v.N) },
    bins: {},
  };
  venues[venue].bins[key] = {
    n: b.n,
    inWinRate: pt(b.w / b.n),
    diffVsVenue: pt(d),
    techniques: Object.fromEntries(
      TECHNIQUES.map((t) => [t, tech.get(`${venue}|${key}`)?.[t] ?? 0]),
    ),
  };
}

/** 1区分の全体の結果。会場ごとの結果は venues へ書く */
function summarizeBin(bin, { venueAgg, tech, boot, adj }, venues) {
  const dBar = pooledDiff(venueAgg, bin.key);
  let sameSign = 0;
  let eligible = 0;
  let n = 0;
  for (const [venue, v] of venueAgg) {
    const b = v.bins[bin.key];
    if (!b) continue;
    n += b.n;
    const d = b.w / b.n - v.W / v.N;
    recordVenueBin(venues, venue, v, b, bin.key, d, tech);
    if (b.n >= VENUE_SIGN_MIN_N && dBar != null) {
      eligible += 1;
      if (Math.sign(d) === Math.sign(dBar)) sameSign += 1;
    }
  }
  const a = adj.get(bin.key);
  const alpha = (1 - CI_LEVEL) / 2;
  return {
    label: bin.label,
    n,
    diffVsVenue: pt(dBar),
    ci: boot
      ? [
          pt(quantile(boot[bin.key], alpha)),
          pt(quantile(boot[bin.key], 1 - alpha)),
        ]
      : null,
    adjustedDiff: a ? pt(a.resid / a.n) : null,
    venueSign: { eligible, sameSign },
  };
}

/**
 * 区分ごとの会場内比較。binOf(race) が区分キー（対象外は null）を返す
 */
function compare(
  races,
  bins,
  binOf,
  { bootstrap = false, expected = null } = {},
) {
  const target = races.filter((r) => binOf(r) != null);
  const { clustersByVenue, venueAgg, tech, adj } = accumulateRaces(
    target,
    binOf,
    expected,
  );
  const boot = bootstrap ? bootstrapDiffs(clustersByVenue, bins) : null;

  const venues = {};
  const pooled = {};
  for (const bin of bins) {
    pooled[bin.key] = summarizeBin(bin, { venueAgg, tech, boot, adj }, venues);
  }
  return { pooled, venues };
}

function judge(full, first, second, keys) {
  return Object.fromEntries(
    keys.map((key) => {
      const f = full.pooled[key];
      const d = f.diffVsVenue;
      const a = first.pooled[key]?.diffVsVenue;
      const b = second.pooled[key]?.diffVsVenue;
      const checks = {
        c1_absDiffAtLeast3pt: d != null && Math.abs(d) >= 3,
        c2_ciExcludesZero:
          f.ci != null && f.ci[0] != null && (f.ci[0] > 0 || f.ci[1] < 0),
        c3_adjustedKeeps:
          d != null &&
          f.adjustedDiff != null &&
          Math.sign(f.adjustedDiff) === Math.sign(d) &&
          Math.abs(f.adjustedDiff) >= (Math.abs(d) * 2) / 3,
        c4_halvesSameSign:
          a != null &&
          b != null &&
          Math.sign(a) === Math.sign(d) &&
          Math.sign(b) === Math.sign(d),
        c5_venuesSameSign:
          f.venueSign.eligible > 0 &&
          f.venueSign.sameSign >= (f.venueSign.eligible * 2) / 3,
      };
      return [key, { ...checks, pass: Object.values(checks).every(Boolean) }];
    }),
  );
}

function analyze(races, bins, binOf, judgeKeys) {
  const firstHalf = races.filter((r) => r.date <= FIRST_HALF_END);
  const secondHalf = races.filter((r) => r.date > FIRST_HALF_END);
  const expected = expectedRates(races.filter((r) => binOf(r) != null));
  const full = compare(races, bins, binOf, { bootstrap: true, expected });
  const first = compare(firstHalf, bins, binOf);
  const second = compare(secondHalf, bins, binOf);
  return {
    pooled: full.pooled,
    firstHalf: first.pooled,
    secondHalf: second.pooled,
    judge: judge(full, first, second, judgeKeys),
    venues: full.venues,
  };
}

export {
  FIRST_HALF_END,
  TECHNIQUES,
  BOOT_REPS,
  CI_LEVEL,
  pt,
  compare,
  analyze,
};
