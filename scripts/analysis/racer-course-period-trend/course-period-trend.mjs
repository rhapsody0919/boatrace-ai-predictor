// 選手の進入コース別成績（公式・期別）を期ごとの線にしてよいかを、e2e の録画の racer_period_stats で測る（本番 DB は読まない）
// 使い方（リポジトリの根で）: node scripts/analysis/racer-course-period-trend/course-period-trend.mjs [e2e/recordings] [data/analysis/racer-course-period-trend/course-period-trend.json]
import fs from "node:fs";
import path from "node:path";

const [recDir = "e2e/recordings", outPath = "data/analysis/racer-course-period-trend/course-period-trend.json"] = process.argv.slice(2);
const har = JSON.parse(fs.readFileSync(path.join(recDir, "api.har"), "utf8"));
const byRacer = new Map();
for (const e of har.log.entries) {
  const u = e.request.url;
  if (!u.includes("racer_period_stats")) continue;
  const m = u.match(/racer_id=eq\.(\d+)/);
  const f = e.response?.content?._file;
  if (!m || !f) continue;
  // 録画に本体の無い応答（本文を持たない記録）だけ飛ばす。中身が壊れていれば止める
  const file = path.join(recDir, f);
  if (!fs.existsSync(file)) continue;
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(d) || !d[0] || !("c1_entries" in d[0])) continue;
  const rows = byRacer.get(m[1]) ?? new Map();
  for (const r of d) rows.set(r.period_year * 2 + r.period_no, r);
  byRacer.set(m[1], rows);
}

const C = [1, 2, 3, 4, 5, 6];
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); if (!a.length) return null; return a[Math.min(a.length - 1, Math.floor(p * (a.length - 1) + 0.5))]; };
const ST_SD1 = 0.064; // 1走ごとの ST の標準偏差（選手1人の中央値、docs/design/racer-trend-compare/analysis/compare-lines.md）

function cell(r, c) {
  const n = num(r[`c${c}_entries`]) ?? 0;
  const p = [1, 2, 3].map((k) => num(r[`c${c}_p${k}`]) ?? 0);
  const nst = n - ["f", "l0", "l1", "k0", "k1"].reduce((s, k) => s + (num(r[`c${c}_${k}`]) ?? 0), 0);
  const st = num(r[`c${c}_avg_st`]);
  return { n, win: p[0], top2: p[0] + p[1], top3: p[0] + p[1] + p[2], nst, st: st && st > 0 ? st : null };
}

// 1. 1期あたりのコース別の進入数（最新の確定期 2027年1期と、全期）
const latestKey = Math.max(...[...byRacer.values()].flatMap((m) => [...m.keys()]));
const dist = {};
for (const scope of ["latest", "all"]) {
  dist[scope] = {};
  for (const g of ["A1", "A2", "B1", "B2", "all"]) {
    const o = {};
    for (const c of C) {
      const ns = [];
      for (const m of byRacer.values()) for (const [k, r] of m) {
        if (scope === "latest" && k !== latestKey) continue;
        if ((num(r.starts) ?? 0) <= 0) continue;
        if (g !== "all" && r.grade !== g) continue;
        ns.push(cell(r, c).n);
      }
      o[`c${c}`] = { rows: ns.length, p10: q(ns, 0.1), p25: q(ns, 0.25), median: q(ns, 0.5), share_ge10: +(ns.filter((x) => x >= 10).length / ns.length).toFixed(3), share_ge20: +(ns.filter((x) => x >= 20).length / ns.length).toFixed(3), share_ge30: +(ns.filter((x) => x >= 30).length / ns.length).toFixed(3) };
    }
    dist[scope][g] = o;
  }
}

// 2. 期→期の変化のうち偶然で説明できない分（モーメント法）
// 率: 偶然の分散 = p̄(1−p̄)/n（p̄ はその選手・コースの全期の合算）。ST: 0.064²/nst
function series(m, c, metric, block) {
  const keys = [...m.keys()].sort((a, b) => a - b);
  const cells = keys.map((k) => ({ k, ...cell(m.get(k), c) }));
  // block 期ずつ、重ならずに束ねる（新しい側から）
  const out = [];
  for (let i = cells.length; i - block >= 0; i -= block) {
    const b = cells.slice(i - block, i);
    if (b[b.length - 1].k - b[0].k !== block - 1) continue; // 連続した期だけ
    const s = b.reduce((a, x) => ({ n: a.n + x.n, win: a.win + x.win, top2: a.top2 + x.top2, top3: a.top3 + x.top3, nst: a.nst + (x.st ? x.nst : 0), stw: a.stw + (x.st ? x.st * x.nst : 0) }), { n: 0, win: 0, top2: 0, top3: 0, nst: 0, stw: 0 });
    out.unshift({ k: b[b.length - 1].k, ...s, st: s.nst > 0 ? s.stw / s.nst : null });
  }
  return out;
}
function valueAndNoise(x, metric, pbar) {
  if (metric === "st") return x.nst > 0 && x.st ? { v: x.st, nv: ST_SD1 ** 2 / x.nst, n: x.nst } : null;
  if (x.n <= 0) return null;
  return { v: x[metric] / x.n, nv: (pbar * (1 - pbar)) / x.n, n: x.n };
}
// 比べる2つの点（同じ選手のコースで lag 個離れた期・束）が、どちらも値と下限の走数を持つか
const usablePair = (a, b, minN, lag, block) =>
  a.v !== undefined && b.v !== undefined && a.n >= minN && b.n >= minN && b.k - a.k === lag * block;
// 率は pt（×100・小数2桁）、平均ST は秒（小数4桁）
const fmtChange = (v, metric) => +(v * (metric === "st" ? 1 : 100)).toFixed(metric === "st" ? 4 : 2);

function changeStats(c, metric, block, minN, lag) {
  let sumD2 = 0, sumNoise = 0, cnt = 0; const absD = []; const hw = [];
  for (const m of byRacer.values()) {
    const s = series(m, c, metric, block);
    const tot = s.reduce((a, x) => ({ n: a.n + x.n, y: a.y + (metric === "st" ? 0 : x[metric]) }), { n: 0, y: 0 });
    const pbar = tot.n ? tot.y / tot.n : 0;
    const vs = s.map((x) => ({ k: x.k, ...(valueAndNoise(x, metric, pbar) ?? {}) }));
    for (let i = lag; i < vs.length; i++) {
      const a = vs[i - lag], b = vs[i];
      if (!usablePair(a, b, minN, lag, block)) continue;
      const d = b.v - a.v;
      sumD2 += d * d; sumNoise += a.nv + b.nv; cnt++; absD.push(Math.abs(d)); hw.push(1.96 * Math.sqrt(b.nv));
    }
  }
  if (!cnt) return null;
  const obsSd = Math.sqrt(sumD2 / cnt), noiseSd = Math.sqrt(sumNoise / cnt);
  const trueVar = Math.max(0, sumD2 / cnt - sumNoise / cnt);
  const f = (v) => fmtChange(v, metric);
  return { pairs: cnt, obsChangeSd: f(obsSd), noiseChangeSd: f(noiseSd), trueChangeSd: f(Math.sqrt(trueVar)), shareNotNoise: +(trueVar / (sumD2 / cnt)).toFixed(3), medianHalfWidth95: f(q(hw, 0.5)), medianAbsChange: f(q(absD, 0.5)) };
}
const metrics = ["win", "top2", "top3", "st"];
const change = {};
for (const block of [1, 3]) for (const minN of [10, 20, 30]) for (const lag of block === 1 ? [1, 2, 4, 8] : [1, 2]) {
  const key = `block${block}_min${minN}_lag${lag}`;
  change[key] = {};
  for (const c of C) for (const mt of metrics) change[key][`c${c}_${mt}`] = changeStats(c, mt, block, minN, lag);
}

// 3. 時系列の当て: 期 t の値を、t−1 の1期・t−1〜t−3 の合算・t−1〜t−6 の合算で当てる（偶然の分を引いた平均二乗誤差）
function predict(c, metric, minTarget) {
  const res = { prev1: [0, 0], sum3: [0, 0], sum6: [0, 0] }; let cnt = 0;
  for (const m of byRacer.values()) {
    const keys = [...m.keys()].sort((a, b) => a - b);
    for (const t of keys) {
      if (t < latestKey - 7) continue; // 目標は直近8期
      const target = cell(m.get(t), c);
      const tot = keys.filter((k) => k <= t).reduce((a, k) => { const x = cell(m.get(k), c); return { n: a.n + x.n, y: a.y + (metric === "st" ? 0 : x[metric]) }; }, { n: 0, y: 0 });
      const pbar = tot.n ? tot.y / tot.n : 0;
      const tv = valueAndNoise(target, metric, pbar);
      if (!tv || tv.n < minTarget) continue;
      const pool = (K) => {
        let n = 0, y = 0, w = 0;
        for (let j = 1; j <= K; j++) { const r = m.get(t - j); if (!r) return null; const x = cell(r, c); if (metric === "st") { if (x.st) { y += x.st * x.nst; w += x.nst; } } else { n += x.n; y += x[metric]; } }
        if (metric === "st") return w >= 10 ? y / w : null;
        return n >= 10 ? y / n : null;
      };
      const p1 = pool(1), p3 = pool(3), p6 = pool(6);
      if (p1 === null || p3 === null || p6 === null) continue;
      res.prev1[0] += (tv.v - p1) ** 2; res.sum3[0] += (tv.v - p3) ** 2; res.sum6[0] += (tv.v - p6) ** 2;
      res.prev1[1] += tv.nv; cnt++;
    }
  }
  if (!cnt) return null;
  const scale = metric === "st" ? 1 : 100; const dg = metric === "st" ? 4 : 2;
  const noise = res.prev1[1] / cnt;
  const f = (k) => +(Math.sqrt(Math.max(0, res[k][0] / cnt - noise)) * scale).toFixed(dg);
  return { targets: cnt, rmseNoiseRemoved_prev1: f("prev1"), rmseNoiseRemoved_sum3: f("sum3"), rmseNoiseRemoved_sum6: f("sum6") };
}
const prediction = {};
for (const c of C) for (const mt of metrics) prediction[`c${c}_${mt}`] = predict(c, mt, 10);

const out = {
  source: "e2e の録画（racer_period_stats の応答。本番 DB は読まない）",
  recordedAt: JSON.parse(fs.readFileSync(path.join(recDir, "meta.json"), "utf8")).recordedAt,
  generatedAt: new Date().toISOString(),
  racers: byRacer.size,
  rows: [...byRacer.values()].reduce((s, m) => s + m.size, 0),
  latestPeriod: { year: Math.floor((latestKey - 1) / 2), no: ((latestKey - 1) % 2) + 1 },
  notes: [
    "母集団は録画に入った選手（レースの出走表から選手ページを開いた選手）で、全選手の無作為抽出ではない",
    "率の偶然の分散は二項 p̄(1−p̄)/n、p̄ はその選手・コースの全期の合算。ST は 1走の SD 0.064 を仮定（compare-lines.md）",
    "shareNotNoise = 期→期の差の分散のうち偶然で説明できない割合（モーメント法、0 で打ち止め）",
    "block3 は重ならない3期の束（今の3期合算の棒と同じ量）を点にしたとき",
    "prediction は目標の期より前だけを使う時系列の当て（直近8期が目標）。偶然の分を引いた RMSE",
  ],
  perPeriodEntries: dist,
  change,
  prediction,
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log("ok", out.racers, out.rows);
