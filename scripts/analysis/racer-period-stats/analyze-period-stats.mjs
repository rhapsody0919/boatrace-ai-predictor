// 選手ページに公式の期別成績（racer_period_stats）を出すときの言える範囲を集計する
// 入力: data/analysis/racer-period-stats/work/rows.json（fetch-period-stats.mjs が作る、gitignore）
// 出力: data/analysis/racer-period-stats/period-stats-display-scope.json
// 実行: node scripts/analysis/racer-period-stats/analyze-period-stats.mjs
import fs from "node:fs";

const IN = "data/analysis/racer-period-stats/work/rows.json";
const OUT = "data/analysis/racer-period-stats/period-stats-display-scope.json";
const { fetchedAt, rows } = JSON.parse(fs.readFileSync(IN, "utf8"));

const GRADES = ["A1", "A2", "B1", "B2"];
const C = [1, 2, 3, 4, 5, 6];
const PTS = [10, 8, 6, 4, 2, 1]; // 勝率の着順点
const EPS = 0.000001;
const pk = (r) => r.period_year * 2 + r.period_no; // 期の連番
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const med = (a) => q(a, 0.5);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const corr = (x, y) => { const mx = mean(x), my = mean(y); let a = 0, b = 0, c = 0; for (let i = 0; i < x.length; i++) { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2; } return a / Math.sqrt(b * c); };
const r3 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const col = (c, name) => "c" + c + "_" + name;
const v0 = (r, c, name) => r[col(c, name)] ?? 0;
const sumCol = (r, name) => C.reduce((s, c) => s + v0(r, c, name), 0);
const counters = {};
const tally = (cond, name) => { counters[name] = (counters[name] ?? 0) + (cond ? 1 : 0); };

const periods = [...new Set(rows.map(pk))].sort((a, b) => a - b);
const latest = periods.at(-1);
const metaOf = (k) => { const r = rows.find((x) => pk(x) === k); return { period: r.period_year + "年" + r.period_no + "期", calc_from: r.calc_from, calc_to: r.calc_to }; };
const periodMeta = periods.map(metaOf);
const byRacer = new Map();
for (const r of rows) { if (!byRacer.has(r.racer_id)) byRacer.set(r.racer_id, new Map()); byRacer.get(r.racer_id).set(pk(r), r); }
const latestRows = rows.filter((r) => pk(r) === latest);

// 0. 列の意味の確認
for (const m of byRacer.values()) for (const [k, r] of m) { const p = m.get(k - 1); if (p) { tally(p.grade === r.grade_prev, "gradePrevEqualsPreviousRowGrade_ok"); tally(true, "gradePrevEqualsPreviousRowGrade_compared"); } }
const winRateDiff = [];
function checkRow(r) {
  tally(sumCol(r, "entries") === r.starts, "courseEntriesSumEqualsStarts");
  tally(sumCol(r, "p1") === r.first_count, "courseP1SumEqualsFirstCount");
  tally(true, "rowsWithStarts");
  for (const c of C) {
    const n = v0(r, c, "entries");
    if (!n) continue;
    const raw = ((v0(r, c, "p1") + v0(r, c, "p2")) / n) * 100;
    const v = Number(r[col(c, "top2_rate")]);
    const t = Math.floor(raw * 10 + EPS) / 10;
    const ro = Math.round(raw * 10) / 10;
    tally(true, "courseTop2Compared");
    tally(Math.abs(v - t) < EPS, "courseTop2MatchesTruncated");
    tally(Math.abs(v - t) >= EPS && Math.abs(v - ro) < EPS, "courseTop2MatchesRoundedOnly");
  }
  const pts = C.reduce((s, c) => s + PTS.reduce((t, w, i) => t + w * v0(r, c, "p" + (i + 1)), 0), 0);
  const d = pts / r.starts - Number(r.win_rate);
  winRateDiff.push(d);
  tally(Math.abs(d) < 0.006, "winRateFromPlacementsWithin0005");
}
rows.filter((r) => r.starts > 0).forEach(checkRow);

// A. 期別成績の推移の表：期のそろい方・出走ゼロの期
const A = { byGrade: {} };
for (const g of GRADES) {
  const ids = latestRows.filter((r) => r.grade === g).map((r) => r.racer_id);
  let all15Rows = 0, all15Starts = 0, gapRacers = 0, spanPeriods = 0, gapPeriods = 0, lowPeriods = 0;
  const nPeriods = [];
  for (const id of ids) {
    const m = byRacer.get(id);
    const ks = [...m.keys()];
    const first = Math.min(...ks);
    nPeriods.push(ks.length);
    all15Rows += ks.length === periods.length ? 1 : 0;
    all15Starts += periods.every((k) => m.get(k)?.starts > 0) ? 1 : 0;
    let gap = 0;
    for (const k of periods.filter((x) => x >= first)) {
      spanPeriods++;
      const r = m.get(k);
      const zero = !r || !r.starts;
      gap += zero ? 1 : 0;
      lowPeriods += !zero && r.starts < 30 ? 1 : 0;
    }
    gapPeriods += gap;
    gapRacers += gap ? 1 : 0;
  }
  const startsLatest = latestRows.filter((r) => r.grade === g && r.starts > 0).map((r) => r.starts);
  A.byGrade[g] = {
    racers: ids.length,
    all15PeriodsHaveRow: all15Rows,
    all15PeriodsStarted: all15Starts,
    periodsWithRow_median: med(nPeriods),
    racersWithAnyZeroStartPeriodSinceFirstRow: gapRacers,
    periodsSinceFirstRow: spanPeriods,
    zeroStartOrMissingPeriods: gapPeriods,
    zeroStartOrMissingShare: r3(gapPeriods / spanPeriods),
    periodsWith1to29Starts: lowPeriods,
    periodsWith1to29StartsShare: r3(lowPeriods / spanPeriods),
    startsLatestPeriod: { p10: q(startsLatest, 0.1), median: med(startsLatest), p90: q(startsLatest, 0.9) },
  };
}
A.perPeriod = periods.map((k, i) => {
  const rs = rows.filter((r) => pk(r) === k);
  const st = rs.filter((r) => r.starts > 0).map((r) => r.starts);
  return { ...periodMeta[i], racers: rs.length, zeroStart: rs.filter((r) => !r.starts).length, startsMedian: med(st), startsP10: q(st, 0.1), startsP90: q(st, 0.9) };
});

// B. コース別：直近K期を合算すると1コースあたり何走か（今の級別、中央値）
const B = { coursePerLatestPeriod: {}, summedLatestK: {} };
for (const g of GRADES) {
  const rs = latestRows.filter((r) => r.grade === g && r.starts > 0);
  B.coursePerLatestPeriod[g] = Object.fromEntries(C.map((c) => [col(c, "entries"), { p10: q(rs.map((r) => v0(r, c, "entries")), 0.1), median: med(rs.map((r) => v0(r, c, "entries"))) }]));
  B.summedLatestK[g] = {};
  const ids = latestRows.filter((r) => r.grade === g).map((r) => r.racer_id);
  for (const K of [1, 2, 3, 4, 6, 10, 15]) {
    const sums = ids.map((id) => {
      const m = byRacer.get(id);
      const s = Object.fromEntries(C.map((c) => [c, 0]));
      for (const k of periods.slice(-K)) { const r = m.get(k); if (r) for (const c of C) s[c] += v0(r, c, "entries"); }
      return s;
    });
    const minC = sums.map((s) => Math.min(...C.map((c) => s[c])));
    B.summedLatestK[g]["K" + K] = {
      ...Object.fromEntries(C.map((c) => ["c" + c + "_median", med(sums.map((s) => s[c]))])),
      minCourse_median: med(minC), minCourse_p10: q(minC, 0.1),
      share_minCourse_ge10: r3(minC.filter((x) => x >= 10).length / minC.length),
      share_minCourse_ge30: r3(minC.filter((x) => x >= 30).length / minC.length),
    };
  }
}
// 合算の式の差：Σ(top2_rate×entries)/Σentries と Σ(p1+p2)/Σentries（直近3期、今の選手）
const mergeDiff = [];
const stDiff = [];
for (const r of latestRows) {
  const m = byRacer.get(r.racer_id);
  for (const c of C) {
    let a = 0, b = 0, n = 0;
    for (const k of periods.slice(-3)) { const x = m.get(k); const e = x ? v0(x, c, "entries") : 0; if (e) { n += e; a += Number(x[col(c, "top2_rate")]) * e; b += (v0(x, c, "p1") + v0(x, c, "p2")) * 100; } }
    if (n) mergeDiff.push(Math.abs(a / n - b / n));
  }
  if (r.starts > 0 && r.avg_st != null) {
    let s = 0, n = 0;
    for (const c of C) { const e = v0(r, c, "entries"); const st = r[col(c, "avg_st")]; if (e && st != null) { s += Number(st) * e; n += e; } }
    if (n) stDiff.push(Math.abs(s / n - Number(r.avg_st)));
  }
}
B.mergeTop2_weightedRateVsCounts = { comparisons: mergeDiff.length, medianAbsDiffPt: r3(med(mergeDiff)), p99AbsDiffPt: r3(q(mergeDiff, 0.99)), maxAbsDiffPt: r3(Math.max(...mergeDiff)) };
B.avgSt_courseEntriesWeightedVsOverall = { racers: stDiff.length, medianAbsDiff: r3(med(stDiff)), p90AbsDiff: r3(q(stDiff, 0.9)), maxAbsDiff: r3(Math.max(...stDiff)), share_le_0_01: r3(stDiff.filter((d) => d <= 0.0101).length / stDiff.length) };

// C1. 率の選手差のうち本物の割合（信頼性）
// 同じ期・同じ区分の選手のあいだで、観測の分散 − 二項の分散の平均 = 本物の差の分散 τ²。
// 級は grade_prev（前の期の成績で決まり、この期の大半に適用された級）で分ける。grade はこの期の成績で決まるので、結果で選んだことになり差が縮む。
// 信頼性(n) = τ² / (τ² + p(1−p)/n)。n は進入数。15期それぞれで出し平均する。各期 n>=10 の行だけ使う
function reliability(filterRow, c, kind) {
  const tauList = [], pList = [];
  let used = 0;
  for (const k of periods) {
    const xs = rows.filter((r) => pk(r) === k && filterRow(r) && v0(r, c, "entries") >= 10).map((r) => {
      const n = v0(r, c, "entries");
      const s = kind === "win" ? v0(r, c, "p1") : v0(r, c, "p1") + v0(r, c, "p2");
      return { p: s / n, n };
    });
    if (xs.length < 30) continue;
    used += xs.length;
    const pbar = mean(xs.map((x) => x.p));
    const v = mean(xs.map((x) => (x.p - pbar) ** 2));
    const bin = mean(xs.map((x) => (pbar * (1 - pbar)) / x.n));
    tauList.push(Math.max(0, v - bin));
    pList.push(pbar);
  }
  if (!tauList.length) return null;
  const tau2 = mean(tauList), p = mean(pList), b = p * (1 - p);
  const nFor = (R) => (tau2 > 0 ? Math.ceil((R / (1 - R)) * (b / tau2)) : null);
  return {
    rowsUsed: used, meanRate: r3(p), trueSdPt: r3(Math.sqrt(tau2) * 100),
    rel_n10: r3(tau2 / (tau2 + b / 10)), rel_n30: r3(tau2 / (tau2 + b / 30)), rel_n60: r3(tau2 / (tau2 + b / 60)),
    n_for_rel_0_5: nFor(0.5), n_for_rel_0_7: nFor(0.7),
    ci95_halfwidth_pt_n10: r3(1.96 * Math.sqrt(b / 10) * 100), ci95_halfwidth_pt_n30: r3(1.96 * Math.sqrt(b / 30) * 100),
  };
}
const rel = { all: {} };
for (const c of C) for (const kind of ["win", "top2"]) rel.all["c" + c + "_" + kind] = reliability(() => true, c, kind);
for (const g of GRADES) { rel[g] = {}; for (const c of C) for (const kind of ["win", "top2"]) rel[g]["c" + c + "_" + kind] = reliability((r) => r.grade_prev === g, c, kind); }

// C2. 推移の上下は「調子」か：勝率の期→期の変化が次の変化を当てるか
const sdPts = (r) => {
  const cnt = PTS.map((_, i) => sumCol(r, "p" + (i + 1)));
  const n = cnt.reduce((s, x) => s + x, 0);
  if (!n) return null;
  const m = cnt.reduce((s, x, i) => s + x * PTS[i], 0) / n;
  return Math.sqrt(cnt.reduce((s, x, i) => s + x * (PTS[i] - m) ** 2, 0) / n);
};
function trendFor(minStarts, racerFilter) {
  const dx = [], dy = [], errLast = [], errAvg3 = [];
  let noiseSig = 0, noiseAll = 0;
  const ok = (r) => r && r.starts >= minStarts;
  for (const [id, m] of byRacer) {
    if (!racerFilter(id, m)) continue;
    for (const k of periods) {
      const z = m.get(k - 2), a = m.get(k - 1), b = m.get(k), c = m.get(k + 1);
      if (ok(a) && ok(b)) {
        const sa = sdPts(a), sb = sdPts(b);
        if (sa && sb) { noiseAll++; noiseSig += Math.abs(Number(b.win_rate) - Number(a.win_rate)) > 1.96 * Math.sqrt(sa ** 2 / a.starts + sb ** 2 / b.starts) ? 1 : 0; }
      }
      if (ok(a) && ok(b) && ok(c)) { dx.push(Number(b.win_rate) - Number(a.win_rate)); dy.push(Number(c.win_rate) - Number(b.win_rate)); }
      if (ok(z) && ok(a) && ok(b) && ok(c)) {
        errLast.push(Math.abs(Number(c.win_rate) - Number(b.win_rate)));
        const avg = (Number(z.win_rate) * z.starts + Number(a.win_rate) * a.starts + Number(b.win_rate) * b.starts) / (z.starts + a.starts + b.starts);
        errAvg3.push(Math.abs(Number(c.win_rate) - avg));
      }
    }
  }
  return {
    minStartsPerPeriod: minStarts,
    tripletsForDeltaAutocorr: dx.length, deltaAutocorr: r3(corr(dx, dy)),
    meanDelta: r3(mean(dx)), medianAbsDelta: r3(med(dx.map(Math.abs))),
    nextPeriodMAE_useLastPeriod: r3(mean(errLast)), nextPeriodMAE_useStartsWeightedLast3: r3(mean(errAvg3)), maeQuadruplets: errLast.length,
    adjacentPairs: noiseAll, shareChangeBeyond95Noise: r3(noiseSig / noiseAll),
  };
}
const firstPeriod = periods[0];
const trend = {
  all: trendFor(60, () => true),
  enteredAfterFirstPeriod: trendFor(60, (id, m) => Math.min(...m.keys()) > firstPeriod + 1),
  presentFromFirstPeriod: trendFor(60, (id, m) => m.has(firstPeriod)),
};

const out = {
  source: "racer_period_stats（本番 Supabase、読み取りのみ）",
  fetchedAt, generatedAt: new Date().toISOString(),
  rows: rows.length, racers: byRacer.size, periods: periodMeta,
  latestPeriod: periodMeta.at(-1), latestPeriodRacers: latestRows.length,
  notes: [
    "grade はその期の成績で決まった級（次の行の grade_prev と一致するかで確認）。適用は算出期間の終わりの2か月後から半年",
    "現役＝最新の期（2026年2期）に行がある選手。級はその行の grade",
    "信頼性は同じ期・同じ級（grade_prev）の選手間の分散分解。n は進入数。期をまたぐ合算の信頼性は、合算後の n を当てはめた近似（選手の力が期で変わる分は無視）",
  ],
  columnChecks: { counters, winRateDiff: { median: r3(med(winRateDiff)), p10: r3(q(winRateDiff, 0.1)), p90: r3(q(winRateDiff, 0.9)) } },
  A, B, C: { reliability: rel, trend },
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ counters, winRateDiff: out.columnChecks.winRateDiff }, null, 1));
