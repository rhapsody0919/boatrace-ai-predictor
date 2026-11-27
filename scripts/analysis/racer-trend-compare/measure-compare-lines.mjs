// 選手ページの「STの推移」「展示タイムの推移」に足す比べる線（同級・同コースの平均ST、同じレースの他の5艇の展示の平均）の
// 大きさとぶれを、e2e の録画（get_racer_scoped_race_rows の応答）だけで測る。本番 DB は読まない。
// 使い方: node scripts/analysis/racer-trend-compare/measure-compare-lines.mjs [録画のフォルダ] [出力の JSON]
//   既定: e2e/recordings → docs/design/racer-trend-compare/analysis/compare-lines.json
import fs from "node:fs";
import path from "node:path";

const recDir = process.argv[2] ?? "e2e/recordings";
const outPath = process.argv[3] ?? "docs/design/racer-trend-compare/analysis/compare-lines.json";

const har = JSON.parse(fs.readFileSync(path.join(recDir, "api.har"), "utf8"));
const meta = JSON.parse(fs.readFileSync(path.join(recDir, "meta.json"), "utf8"));

// 1. 選手×レースの行を集める（同じ選手の重複の要求は race_id で1行に）
const runs = new Map(); // key racer|race
const sinceSet = new Set();
for (const e of har.log.entries) {
  if (!e.request.url.includes("/rpc/get_racer_scoped_race_rows")) continue;
  const file = e.response.content?._file;
  if (!file) continue;
  const body = JSON.parse(fs.readFileSync(path.join(recDir, file), "utf8"));
  if (!Array.isArray(body)) throw new Error(`配列でない応答: ${file}`);
  const p = JSON.parse(e.request.postData.text);
  sinceSet.add(p.p_since);
  for (const r of body) runs.set(`${Number(p.p_racer_id)}|${r.race_id}`, { racerId: Number(p.p_racer_id), ...r });
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const median = (a) => { const b = [...a].sort((x, y) => x - y); const n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };
const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(p * (b.length - 1))]; };
const r4 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10000) / 10000);
// 乱数の種を固定した bootstrap（選手で束ねて引き直す）
let seed = 20261127;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const clusterCI = (groups, stat, B = 2000) => {
  const keys = [...groups.keys()];
  const vals = [];
  for (let b = 0; b < B; b++) {
    const pick = [];
    for (let i = 0; i < keys.length; i++) pick.push(...groups.get(keys[Math.floor(rand() * keys.length)]));
    if (pick.length) vals.push(stat(pick));
  }
  return [r4(q(vals, 0.025)), r4(q(vals, 0.975))];
};

const all = [...runs.values()].filter((r) => r.race_status === "normal" || r.race_status == null);
const dates = all.map((r) => r.race_date).sort();
const splitDate = dates[Math.floor(dates.length / 2)];

// 2. ST の行（その選手の艇、F・L を除く、実進入コースは race_results 由来、無ければ entry_course）
const stRuns = [];
for (const r of all) {
  const row = (r.st_rows ?? []).find((x) => x[0] === r.boat_number);
  if (!row) continue;
  const [, st, isF, isL, , entryCourse] = row;
  if (st == null || isF || isL) continue;
  const course = r.actual_courses?.[r.boat_number - 1] ?? entryCourse;
  if (!course || !["A1", "A2", "B1", "B2"].includes(r.grade)) continue;
  stRuns.push({ racerId: r.racerId, date: r.race_date, course, grade: r.grade, st: Number(st) });
}

// 2a. 録画の中のコース×級の平均（全国の st_course_baseline の代わり。母集団は録画の選手だけ）
const cells = {};
for (const x of stRuns) (cells[`${x.course}|${x.grade}`] ??= []).push(x);
const baseline = {};
for (const [k, v] of Object.entries(cells)) {
  const g = new Map();
  for (const x of v) { if (!g.has(x.racerId)) g.set(x.racerId, []); g.get(x.racerId).push(x.st); }
  baseline[k] = { n: v.length, racers: g.size, avg_st: r4(mean(v.map((x) => x.st))), ci95: clusterCI(g, mean, 1000) };
}
const gradeGap = {};
for (let c = 1; c <= 6; c++) {
  const a = baseline[`${c}|A1`], b = baseline[`${c}|B1`], b2 = baseline[`${c}|B2`], a2 = baseline[`${c}|A2`];
  gradeGap[c] = { A1: a?.avg_st, A2: a2?.avg_st, B1: b?.avg_st, B2: b2?.avg_st, B1_minus_A1: r4(b && a ? b.avg_st - a.avg_st : null), B2_minus_A1: r4(b2 && a ? b2.avg_st - a.avg_st : null) };
}

// 2b. 選手1人の1走ごとの ST のぶれ（30走以上の選手）。生と、コース×級の平均を引いた後
const byRacer = new Map();
for (const x of stRuns) { if (!byRacer.has(x.racerId)) byRacer.set(x.racerId, []); byRacer.get(x.racerId).push(x); }
const sdRaw = [], sdAdj = [], nRuns = [], racerDev = [];
for (const [, v] of byRacer) {
  if (v.length < 30) continue;
  sdRaw.push(sd(v.map((x) => x.st)));
  const adj = v.map((x) => x.st - baseline[`${x.course}|${x.grade}`].avg_st);
  sdAdj.push(sd(adj));
  nRuns.push(v.length);
  racerDev.push(mean(adj)); // 選手の平均と、その選手の線（走ごとに引いた基準の平均）の差
}
// 線の位置: 選手ごとに「級を入れた線」と「級を入れない線（コースだけ）」の差
const courseOnly = {};
for (let c = 1; c <= 6; c++) courseOnly[c] = mean(stRuns.filter((x) => x.course === c).map((x) => x.st));
const lineShift = [];
for (const [, v] of byRacer) {
  if (v.length < 30) continue;
  lineShift.push(mean(v.map((x) => baseline[`${x.course}|${x.grade}`].avg_st - courseOnly[x.course])));
}

// 3. 展示: その選手の展示 − 同じレースの他の5艇の展示の平均（他の5艇がそろう走だけ）
const exRuns = [];
for (const r of all) {
  const ex = (r.exhibition_rows ?? []).filter((x) => x[1] != null && Number(x[1]) > 0);
  const own = ex.find((x) => x[0] === r.boat_number);
  const others = ex.filter((x) => x[0] !== r.boat_number);
  if (!own || others.length !== 5) continue;
  const o = mean(others.map((x) => Number(x[1])));
  exRuns.push({ racerId: r.racerId, date: r.race_date, venue: r.venue_code, boat: r.boat_number, raw: Number(own[1]), diff: Number(own[1]) - o });
}
const exBy = new Map();
for (const x of exRuns) { if (!exBy.has(x.racerId)) exBy.set(x.racerId, []); exBy.get(x.racerId).push(x); }
const exSdRaw = [], exSdDiff = [], exRatio = [], exN = [];
for (const [, v] of exBy) {
  if (v.length < 30) continue;
  const a = sd(v.map((x) => x.raw)), b = sd(v.map((x) => x.diff));
  exSdRaw.push(a); exSdDiff.push(b); exRatio.push(b / a); exN.push(v.length);
}
// 同じ会場の中だけで見た生のぶれ（会場の差を除いた後、日の差がどれだけ残るか）
const exSdRawWithinVenue = [];
for (const [, v] of exBy) {
  if (v.length < 30) continue;
  const byV = new Map();
  for (const x of v) { if (!byV.has(x.venue)) byV.set(x.venue, []); byV.get(x.venue).push(x.raw); }
  const resid = [];
  for (const [, w] of byV) { if (w.length < 2) continue; const m = mean(w); for (const y of w) resid.push(y - m); }
  if (resid.length >= 20) exSdRawWithinVenue.push(Math.sqrt(resid.reduce((s, y) => s + y * y, 0) / (resid.length - 1)));
}

// 4. 艇番ごとの差の平均。生（選手の構成をそろえない）と、選手の平均を引いた後（同じ選手の中で比べる）
const racerMean = new Map([...exBy].map(([k, v]) => [k, mean(v.map((x) => x.diff))]));
const byBoat = {};
const half = (s) => (s < splitDate ? "前半" : "後半");
for (let b = 1; b <= 6; b++) {
  const v = exRuns.filter((x) => x.boat === b && exBy.get(x.racerId).length >= 10);
  const g = new Map();
  for (const x of v) { if (!g.has(x.racerId)) g.set(x.racerId, []); g.get(x.racerId).push(x.diff - racerMean.get(x.racerId)); }
  const gRaw = new Map();
  for (const x of v) { if (!gRaw.has(x.racerId)) gRaw.set(x.racerId, []); gRaw.get(x.racerId).push(x.diff); }
  const within = v.map((x) => x.diff - racerMean.get(x.racerId));
  const halves = {};
  for (const h of ["前半", "後半"]) { const w = v.filter((x) => half(x.date) === h).map((x) => x.diff - racerMean.get(x.racerId)); halves[h] = { n: w.length, within_mean: r4(mean(w)) }; }
  byBoat[b] = { n: v.length, racers: g.size, raw_mean: r4(mean(v.map((x) => x.diff))), raw_ci95: clusterCI(gRaw, mean), within_racer_mean: r4(mean(within)), within_ci95: clusterCI(g, mean), halves };
}

const summarize = (a) => ({ racers: a.length, median: r4(median(a)), p10: r4(q(a, 0.1)), p90: r4(q(a, 0.9)) });
const out = {
  generated_at: new Date().toISOString(),
  source: { recording: recDir, recorded_at: meta.recordedAt, rpc: "get_racer_scoped_race_rows", p_since: [...sinceSet], racers: new Set(all.map((r) => r.racerId)).size, runs: all.length, date_range: [dates[0], dates[dates.length - 1]], split_date_for_halves: splitDate },
  population_note: "e2e の録画に入った選手（試験の対象に選ばれた選手）の走だけ。全国の母集団ではない。st_course_baseline の応答は録画に無いので、コース×級の平均は録画の中で数え直した値",
  st: {
    runs_used: stRuns.length, rule: "その選手の艇、F・L・ST なしを除く、コースは race_results の実進入（無ければ entry_course）、級はレース時点の race_entries.grade",
    baseline_in_recording: baseline, grade_gap_by_course: gradeGap,
    per_racer_sd_raw: summarize(sdRaw), per_racer_sd_after_baseline: summarize(sdAdj), per_racer_runs: summarize(nRuns),
    racer_mean_minus_line: summarize(racerDev.map(Math.abs)), racer_mean_minus_line_sd: r4(sd(racerDev)),
    line_shift_grade_vs_course_only: { ...summarize(lineShift.map(Math.abs)), signed_p10: r4(q(lineShift, 0.1)), signed_p90: r4(q(lineShift, 0.9)) },
    min_runs_per_racer: 30,
  },
  exhibition: {
    runs_used: exRuns.length, rule: "その選手の展示と、同じレースの他の艇の展示がちょうど5つそろう走だけ（欠場・未計測を除く）。差 = 自分 − 他の5艇の平均",
    per_racer_sd_raw: summarize(exSdRaw), per_racer_sd_raw_within_venue: summarize(exSdRawWithinVenue), per_racer_sd_diff: summarize(exSdDiff), per_racer_ratio_diff_over_raw: summarize(exRatio), per_racer_runs: summarize(exN),
    min_runs_per_racer: 30,
    by_boat_number: byBoat, by_boat_rule: "10走以上ある選手の走。within は選手ごとの差の平均を引いた後（同じ選手で艇番が変わると差がどう動くか）。CI は選手で束ねた bootstrap 2000回",
  },
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 1));
