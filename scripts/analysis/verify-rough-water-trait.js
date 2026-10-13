/**
 * 「荒れ水面に強い／弱い」は選手の性質として持続するか（BOA-716）
 *
 * 選手ページの条件別の表（src/utils/racerConditionStats.js、BOA-336）に
 * 「荒れ水面に強い／弱い」の印を付けてよいかを、印の見せ方を決める前に確かめる。
 *
 * 入力は公式K・Bファイルの解析済みファイル（kb-day/v1、~/boatrace-archive-backup/kb-archive）。
 * 本番DB（race_conditions）は風・波が 2025-12 以降しか無く、期間を前後に分ける検証に足りないため、
 * 同じ公式の値を6年分持つアーカイブを使う。本番DBは読まない（書き込みもしない）。
 *
 * 区分は画面と同じ:
 *   風: 風速 5m 以上（STRONG_WIND_MS）／未満
 *   波: 波高 5cm 以上（ROUGH_WAVE_CM）／未満。江戸川（03）は母数から外す（WAVE_EXCLUDED_VENUE_CODES）
 *   荒れ（まとめ）: 風5m以上 または 波5cm以上。静水は 風5m未満 かつ 波5cm未満（江戸川は風だけで判定）
 * 1走の数え方: 欠場（進入コースが無い走）は外す。F・L・失格などは走に数え、1着・3着内には数えない
 *
 * 選手の「荒れ水面の差」の定義（4つ）:
 *   self : 荒れの率 − 本人の全体の率（今の画面と同じ比べ方）
 *   calm : 荒れの率 − 本人の静水の率
 *   pop  : 荒れの率 − 全選手の荒れの率
 *   adj  : (荒れの走の 実績−期待) の平均 − (静水の走の 実績−期待) の平均
 *          期待は同じ期間の全選手の率で、進入コース×全国勝率の帯（0.5刻み）×荒れか×会場ごと
 *          （200走未満の層は会場を外す）。コース・級（力量）・会場の偏りを除いた差
 *   adjv : adj を「同じ会場の中で」荒れと静水を比べ、会場ごとの差を nR·nC/(nR+nC) で重み付けた平均。
 *          本人の地元・得意会場が荒れやすい会場だと adj に「荒れに強い」が混ざるため、それを除く
 *
 * 検証:
 *   1. 期間を前後に分け、前の差が後の差を予測するか（相関・前の五分位ごとの後の差・ブートストラップ区間）
 *      偶然との比較は、選手ごと・期間ごと・会場ごとに「荒れ」の札を同じ走数のまま入れ替えた並べ替え（200回）。
 *      会場の中で入れ替えるので、地元・得意会場の偏りは偶然の側にも残る
 *   2. 印の候補ルール（差の閾値×最低走数）で、印が付く割合と後の期間の差
 *   3. 比べる相手（self/calm/pop/adj）ごとの持続と、力量・コースとの相関
 *   4. 風と波の差の相関（期間をまたいだ交差）
 *
 * 期間の分け方:
 *   long : 前 2020-02-01〜2023-05-31 / 後 2023-06-01〜2026-09-30（上限を見る）
 *   year : 1年ずつ（各年10/1〜翌9/30）の隣り合う5組を合わせる（画面の母数＝荒れの走が20〜40走に近い）
 *
 * 使い方:
 *   node scripts/analysis/verify-rough-water-trait.js
 *   KB_ARCHIVE_DIR=/path/to/kb-archive node scripts/analysis/verify-rough-water-trait.js
 * 出力: data/analysis/rough-water-trait.json
 */

import fs from "fs";
import path from "path";
import zlib from "zlib";
import os from "os";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_DIR =
  process.env.KB_ARCHIVE_DIR ||
  path.join(os.homedir(), "boatrace-archive-backup/kb-archive");
const OUT_PATH = path.join(
  __dirname,
  "../../data/analysis/rough-water-trait.json",
);

// 画面の定数と同じ値（src/utils/racerConditionStats.js・src/components/race/basicInfoStats.js）
const STRONG_WIND_MS = 5;
const ROUGH_WAVE_CM = 5;
const WAVE_EXCLUDED_VENUE = 3;

const FROM = "2020-02-01";
const TO = "2026-09-30";
const LONG = {
  A: ["2020-02-01", "2023-05-31"],
  B: ["2023-06-01", "2026-09-30"],
};
const YEARS = [2020, 2021, 2022, 2023, 2024, 2025].map((y) => [
  `${y}-10-01`,
  `${y + 1}-09-30`,
]);
const MIN_VENUE_CELL = 200;
const BOOT_REPS = 1000;
const PERM_REPS = 200;
const MIN_RUNS_LIST = [10, 20, 30, 50];
const CONDS = ["wind", "wave", "rough"];
const OUTCOMES = ["win", "top3"];
const DEFS = ["self", "calm", "pop", "adj", "adjv"];

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
const dateInt = (s) => Number(s.replaceAll("-", ""));

// ---------- 読み込み ----------
function loadRuns() {
  const parsedDir = path.join(ARCHIVE_DIR, "parsed");
  const R = {
    racer: [],
    date: [],
    venue: [],
    course: [],
    win: [],
    top3: [],
    wind: [],
    wave: [],
    band: [],
    natWin: [],
  };
  const hash = crypto.createHash("sha256");
  let nRaces = 0;
  let days = 0;
  for (const month of fs.readdirSync(parsedDir).sort()) {
    const dir = path.join(parsedDir, month);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir).sort()) {
      if (!file.endsWith(".json.gz")) continue;
      const date = file.slice(3, 13);
      if (date < FROM || date > TO) continue;
      const buf = fs.readFileSync(path.join(dir, file));
      hash.update(file).update(buf);
      const day = JSON.parse(zlib.gunzipSync(buf));
      days += 1;
      const di = dateInt(day.date);
      for (const venue of day.k?.venues ?? []) {
        const vc = venue.venue_code;
        const bVenue = day.b?.venues?.find((v) => v.venue_code === vc);
        for (const race of venue.races ?? []) {
          const rows = (race.rows ?? []).filter(
            (x) => x.course != null && x.racer_id,
          );
          if (rows.length === 0) continue;
          nRaces += 1;
          const bRace = bVenue?.races?.find(
            (r) => r.race_number === race.race_number,
          );
          const byRank = new Map();
          for (const x of race.rows ?? [])
            if (x.rank != null) byRank.set(x.rank, x.boat_number);
          for (const x of rows) {
            const e = bRace?.entries?.find(
              (b) => b.boat_number === x.boat_number,
            );
            const nw = e?.national_win_rate;
            R.racer.push(x.racer_id);
            R.date.push(di);
            R.venue.push(vc);
            R.course.push(x.course);
            R.win.push(x.rank === 1 ? 1 : 0);
            R.top3.push(x.rank != null && x.rank <= 3 ? 1 : 0);
            R.wind.push(race.wind_speed ?? -1);
            R.wave.push(race.wave_height ?? -1);
            R.natWin.push(nw ?? -1);
            // 全国勝率の帯（0.5刻み、2.0未満と8.0以上は端にまとめる）。不明は 99
            R.band.push(
              nw == null || nw <= 0
                ? 99
                : Math.min(16, Math.max(4, Math.floor(nw * 2))),
            );
          }
        }
      }
    }
  }
  return { R, nRaces, days, inputHash: hash.digest("hex") };
}

// 条件の札: 1=荒れ 0=静水 -1=判定できない
function condFlags(R) {
  const n = R.racer.length;
  const wind = new Int8Array(n);
  const wave = new Int8Array(n);
  const rough = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    wind[i] = R.wind[i] < 0 ? -1 : R.wind[i] >= STRONG_WIND_MS ? 1 : 0;
    wave[i] =
      R.venue[i] === WAVE_EXCLUDED_VENUE || R.wave[i] < 0
        ? -1
        : R.wave[i] >= ROUGH_WAVE_CM
          ? 1
          : 0;
    if (wind[i] === 1 || wave[i] === 1) rough[i] = 1;
    else if (
      wind[i] === 0 &&
      (wave[i] === 0 || R.venue[i] === WAVE_EXCLUDED_VENUE)
    )
      rough[i] = 0;
    else rough[i] = -1;
  }
  return { wind, wave, rough };
}

function indicesIn(R, [from, to]) {
  const a = dateInt(from);
  const b = dateInt(to);
  const out = [];
  for (let i = 0; i < R.date.length; i++)
    if (R.date[i] >= a && R.date[i] <= b) out.push(i);
  return out;
}

// ---------- 期待値（同じ期間の全選手の率） ----------
function expectationTable(R, idx, flag, y) {
  const fine = new Map();
  const coarse = new Map();
  const add = (m, k, v) => {
    const s = m.get(k) ?? { n: 0, s: 0 };
    s.n += 1;
    s.s += v;
    m.set(k, s);
  };
  for (const i of idx) {
    const f = flag[i];
    if (f < 0) continue;
    add(fine, `${f}|${R.course[i]}|${R.band[i]}|${R.venue[i]}`, y[i]);
    add(coarse, `${f}|${R.course[i]}|${R.band[i]}`, y[i]);
  }
  return (i, f) => {
    const s = fine.get(`${f}|${R.course[i]}|${R.band[i]}|${R.venue[i]}`);
    if (s && s.n >= MIN_VENUE_CELL) return s.s / s.n;
    const c = coarse.get(`${f}|${R.course[i]}|${R.band[i]}`);
    if (c && c.n > 0) return c.s / c.n;
    return null;
  };
}

// 選手ごとの走（札が判定できる走だけ）
function racerRuns(R, idx, flag, y) {
  const E = expectationTable(R, idx, flag, y);
  const byRacer = new Map();
  let popRough = 0;
  let popRoughN = 0;
  for (const i of idx) {
    const f = flag[i];
    if (f < 0) continue;
    const eR = E(i, 1);
    const eC = E(i, 0);
    if (eR == null || eC == null) continue;
    let d = byRacer.get(R.racer[i]);
    if (!d)
      byRacer.set(
        R.racer[i],
        (d = { y: [], eR: [], eC: [], f: [], v: [], c1: 0, nat: 0, natN: 0 }),
      );
    d.y.push(y[i]);
    d.eR.push(eR);
    d.eC.push(eC);
    d.f.push(f);
    d.v.push(R.venue[i]);
    if (R.course[i] === 1) d.c1 += 1;
    if (R.natWin[i] > 0) {
      d.nat += R.natWin[i];
      d.natN += 1;
    }
    if (f === 1) {
      popRough += y[i];
      popRoughN += 1;
    }
  }
  return { byRacer, popRoughRate: popRough / popRoughN };
}

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

// 前後のペア（選手ごと）。pairs は [{A: d, B: d}]（d は racerRuns の値）
function analysePairs(pairs, popA, popB, minRuns, seed) {
  const rand = mulberry32(seed);
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
  const n = rows.length;
  if (n < 30) return { nRacers: n };
  const res = {
    nRacers: n,
    nRoughA: medianOf(rows.map((r) => r.tA.nR)),
    nRoughB: medianOf(rows.map((r) => r.tB.nR)),
  };
  for (const def of DEFS) {
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
    // 前の五分位ごとの後の差
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
    const sdA = Math.sqrt(cov(x, x));
    const cAB = cov(x, y);
    res[def] = {
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
  // 組ごとの相関（year の5組。同じ年の組み合わせで結果が揺れないか）
  const tags = [...new Set(rows.map((r) => r.p.tag).filter((t) => t != null))];
  if (tags.length > 1) {
    res.byPair = tags.map((tag) => {
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
  res.confound = {};
  const nat = rows.map((r) => (r.p.A.natN ? r.p.A.nat / r.p.A.natN : 0));
  const c1 = rows.map((r) => r.p.A.c1 / r.p.A.y.length);
  for (const def of DEFS) {
    const x = rows.map((r) => r.tA[def]);
    res.confound[def] = {
      vsNationalWinRate: r4(pearson(x, nat)),
      vsCourse1Share: r4(pearson(x, c1)),
    };
  }
  // 印の候補ルール（前の期間で決め、後の期間で確かめる）
  res.marks = markRules(rows);
  res.meanSeAdjA_pt = pt(Math.sqrt(mean(rows.map((r) => r.tA.seAdj2))));
  return res;
}

function medianOf(a) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
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

// 全国の基準（荒れでコースごとの1着率がどう変わるか）
function populationContext(R, flags, idx) {
  const out = {};
  for (const cond of CONDS) {
    const t = {};
    for (const i of idx) {
      const f = flags[cond][i];
      if (f < 0) continue;
      const k = `${f}|${R.course[i]}`;
      const s = t[k] ?? { n: 0, w: 0 };
      s.n += 1;
      s.w += R.win[i];
      t[k] = s;
    }
    let nR = 0,
      nAll = 0;
    for (const i of idx) {
      const f = flags[cond][i];
      if (f >= 0) {
        nAll += 1;
        if (f === 1) nR += 1;
      }
    }
    out[cond] = {
      roughShareOfRuns: r4(nR / nAll),
      winRateByCourse_pt: Object.fromEntries(
        [1, 2, 3, 4, 5, 6].map((c) => [
          c,
          {
            calm: pt(t[`0|${c}`].w / t[`0|${c}`].n),
            rough: pt(t[`1|${c}`].w / t[`1|${c}`].n),
          },
        ]),
      ),
    };
  }
  return out;
}

function buildPeriod(R, flags, range) {
  const idx = indicesIn(R, range);
  const data = {};
  for (const cond of CONDS) {
    data[cond] = {};
    for (const outcome of OUTCOMES)
      data[cond][outcome] = racerRuns(R, idx, flags[cond], R[outcome]);
  }
  return { idx, data };
}

function pairsOf(PA, PB, cond, outcome, tag = null) {
  const a = PA.data[cond][outcome];
  const b = PB.data[cond][outcome];
  const out = [];
  for (const [id, dA] of a.byRacer) {
    const dB = b.byRacer.get(id);
    if (!dB) continue;
    out.push({ A: dA, B: dB, popA: a.popRoughRate, popB: b.popRoughRate, tag });
  }
  return out;
}

// 選手1人・1年の荒れの走数の分布（画面の母数の目安）
function roughRunsPerRacerYear(P) {
  const out = {};
  for (const cond of CONDS) {
    const ns = [];
    for (const d of P.data[cond].win.byRacer.values()) {
      if (d.y.length < 100) continue; // 年100走未満（休みが長い選手）は外す
      ns.push(d.f.filter((f) => f === 1).length);
    }
    ns.sort((a, b) => a - b);
    out[cond] = {
      racers: ns.length,
      p10: quantile(ns, 0.1),
      p25: quantile(ns, 0.25),
      median: quantile(ns, 0.5),
      p75: quantile(ns, 0.75),
      p90: quantile(ns, 0.9),
    };
  }
  return out;
}

function main() {
  const t0 = Date.now();
  const { R, nRaces, days, inputHash } = loadRuns();
  console.error(
    `loaded ${R.racer.length} runs / ${nRaces} races / ${days} days in ${((Date.now() - t0) / 1000).toFixed(0)}s`,
  );
  const flags = condFlags(R);

  const result = {
    meta: {
      ticket: "BOA-716",
      generatedAt: new Date().toISOString(),
      source:
        "公式K・Bファイルの解析済み（kb-day/v1、~/boatrace-archive-backup/kb-archive/parsed）",
      inputSha256: inputHash,
      period: [FROM, TO],
      days,
      races: nRaces,
      runs: R.racer.length,
      racers: new Set(R.racer).size,
      definitions: {
        wind: `風速 ${STRONG_WIND_MS}m 以上が荒れ`,
        wave: `波高 ${ROUGH_WAVE_CM}cm 以上が荒れ（江戸川を除く）`,
        rough:
          "風5m以上 または 波5cm以上が荒れ。静水は両方とも未満（江戸川は風だけ）",
        self: "荒れの率 − 本人の全体の率（今の画面）",
        calm: "荒れの率 − 本人の静水の率",
        pop: "荒れの率 − 全選手の荒れの率",
        adj: "荒れの(実績−期待)平均 − 静水の(実績−期待)平均。期待は同期間の全選手、進入コース×全国勝率0.5刻み×荒れか×会場",
        adjv: "adj を同じ会場の中で比べ、会場ごとの差を nR·nC/(nR+nC) で重み付けた平均（地元・得意会場の偏りを除く）",
      },
      split: { long: LONG, year: YEARS },
      bootReps: BOOT_REPS,
      permReps: PERM_REPS,
    },
  };

  // long
  const PA = buildPeriod(R, flags, [LONG.A[0], LONG.A[1]]);
  const PB = buildPeriod(R, flags, [LONG.B[0], LONG.B[1]]);
  result.populationContext = {
    A: populationContext(R, flags, PA.idx),
    B: populationContext(R, flags, PB.idx),
  };
  result.long = {};
  let seed = 716;
  for (const cond of CONDS) {
    result.long[cond] = {};
    for (const outcome of OUTCOMES) {
      result.long[cond][outcome] = {};
      for (const m of MIN_RUNS_LIST) {
        result.long[cond][outcome][`min${m}`] = analysePairs(
          pairsOf(PA, PB, cond, outcome),
          null,
          null,
          m,
          seed++,
        );
      }
      console.error(
        `long ${cond} ${outcome} done ${((Date.now() - t0) / 1000).toFixed(0)}s`,
      );
    }
  }
  result.long.windWave = {
    win: windWaveRelation(PA.data, PB.data, "win", 50),
    top3: windWaveRelation(PA.data, PB.data, "top3", 50),
  };

  // year（隣り合う1年の5組を合わせる。同じ選手が複数の組に入る）
  const Ps = YEARS.map((r) => buildPeriod(R, flags, r));
  result.roughRunsPerRacerYear = roughRunsPerRacerYear(Ps[Ps.length - 1]);
  result.year = {};
  for (const cond of CONDS) {
    result.year[cond] = {};
    for (const outcome of OUTCOMES) {
      result.year[cond][outcome] = {};
      for (const m of [10, 20, 30]) {
        const pairs = [];
        for (let k = 0; k + 1 < Ps.length; k++)
          pairs.push(
            ...pairsOf(
              Ps[k],
              Ps[k + 1],
              cond,
              outcome,
              `${YEARS[k][0]}→${YEARS[k + 1][0]}`,
            ),
          );
        result.year[cond][outcome][`min${m}`] = analysePairs(
          pairs,
          null,
          null,
          m,
          seed++,
        );
      }
      console.error(
        `year ${cond} ${outcome} done ${((Date.now() - t0) / 1000).toFixed(0)}s`,
      );
    }
  }
  const ww = { win: [], top3: [] };
  for (let k = 0; k + 1 < Ps.length; k++) {
    for (const o of OUTCOMES)
      ww[o].push(windWaveRelation(Ps[k].data, Ps[k + 1].data, o, 20));
  }
  result.year.windWave = ww;

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 1) + "\n");
  console.error(
    `wrote ${OUT_PATH} in ${((Date.now() - t0) / 1000).toFixed(0)}s`,
  );
}

main();
