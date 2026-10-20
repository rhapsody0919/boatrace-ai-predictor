// 1号艇の選手別「単勝・複勝回収率」が、20〜45走でどれだけぶれるか（読み取りのみ）
// 式は src/services/supabaseDataService.js getRacerBoatReturnRate と同じ（不成立だけ除く）
// 実行: node --env-file=.env.local scripts/analysis/full-picture-boat1-return/analyze-boat1-return-rate-noise.mjs
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
const s = createClient(process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

const START = "2025-12-01";
const END = process.env.END_DATE || "2026-10-19"; // 終わりの日（この日を含む）
const OUT = process.env.OUT || "data/analysis/full-picture-boat1-return/boat1-return-rate-noise.json";

async function fetchAll(table, cols, filter) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = s.from(table).select(cols).gte("race_id", START).lte("race_id", END + "-99").order("race_id").range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table} ${from}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

const addDays = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const isNoRace = (r) => r.race_status === "no_race";
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
const q = (a, p) => { const b = [...a].sort((x, y) => x - y); const i = (b.length - 1) * p; const lo = Math.floor(i); return b[lo] + (b[Math.ceil(i)] - b[lo]) * (i - lo); };
const pearson = (x, y) => { const mx = mean(x), my = mean(y); let n = 0, dx = 0, dy = 0; for (let i = 0; i < x.length; i++) { n += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; } return n / Math.sqrt(dx * dy); };
const rank = (a) => { const idx = a.map((v, i) => [v, i]).sort((p, q2) => p[0] - q2[0]); const r = new Array(a.length); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; } return r; };
const spearman = (x, y) => pearson(rank(x), rank(y));
let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

const main = async () => {
  const entries = await fetchAll("race_entries", "race_id, racer_id, player_name, boat_number", (qq) => qq.eq("boat_number", 1));
  const results = await fetchAll("race_results", "race_id, rank1, rank2, payout_win, payout_place_1, payout_place_2, race_status");
  const res = new Map(results.map((r) => [r.race_id, r]));
  // 1走ごとの記録
  const runs = [];
  for (const e of entries) {
    const r = res.get(e.race_id);
    if (!r || isNoRace(r) || e.racer_id == null) continue;
    const win = r.rank1 === 1 ? (r.payout_win ?? 0) : 0;
    const place = r.rank1 === 1 ? (r.payout_place_1 ?? 0) : r.rank2 === 1 ? (r.payout_place_2 ?? 0) : 0;
    runs.push({ date: e.race_id.slice(0, 10), racer: e.racer_id, name: e.player_name, win, place, w1: r.rank1 === 1 ? 1 : 0, t2: r.rank1 === 1 || r.rank2 === 1 ? 1 : 0 });
  }
  const group = (rs) => { const m = new Map(); for (const x of rs) { if (!m.has(x.racer)) m.set(x.racer, []); m.get(x.racer).push(x); } return m; };
  const stat = (rs) => ({ n: rs.length, winRR: mean(rs.map((x) => x.win)), placeRR: mean(rs.map((x) => x.place)), winRate: mean(rs.map((x) => x.w1)) * 100, top2: mean(rs.map((x) => x.t2)) * 100 });

  // ① 直近180日（画面と同じ窓）
  const cut180 = addDays(END, -180);
  const recent = runs.filter((x) => x.date >= cut180);
  const all1 = stat(recent);
  const byR = group(recent);
  const band = [...byR.values()].filter((rs) => rs.length >= 20 && rs.length <= 45);
  const B = 2000;
  const per = band.map((rs) => {
    const st = stat(rs);
    const bw = [], bp = [], bwr = [], bt2 = [];
    for (let b = 0; b < B; b++) { let w = 0, p = 0, a = 0, t = 0; for (let i = 0; i < rs.length; i++) { const x = rs[Math.floor(rnd() * rs.length)]; w += x.win; p += x.place; a += x.w1; t += x.t2; } bw.push(w / rs.length); bp.push(p / rs.length); bwr.push(a / rs.length * 100); bt2.push(t / rs.length * 100); }
    const maxWin = Math.max(...rs.map((x) => x.win));
    return { racer: rs[0].racer, name: rs[0].name, ...st,
      winCI: [q(bw, 0.025), q(bw, 0.975)], placeCI: [q(bp, 0.025), q(bp, 0.975)], winRateCI: [q(bwr, 0.025), q(bwr, 0.975)], top2CI: [q(bt2, 0.025), q(bt2, 0.975)],
      maxWinPayout: maxWin, winRRwithoutMax: rs.length > 1 ? (rs.reduce((a, x) => a + x.win, 0) - maxWin) / (rs.length - 1) : null };
  });
  const dist = (k) => ({ p10: q(per.map((x) => x[k]), 0.1), p25: q(per.map((x) => x[k]), 0.25), median: q(per.map((x) => x[k]), 0.5), p75: q(per.map((x) => x[k]), 0.75), p90: q(per.map((x) => x[k]), 0.9), sd: sd(per.map((x) => x[k])) });
  const width = (k) => { const w = per.map((x) => x[k][1] - x[k][0]); return { median: q(w, 0.5), p10: q(w, 0.1), p90: q(w, 0.9) }; };
  const share = (f) => per.filter(f).length / per.length;
  const four = ["篠崎", "黒井", "谷川", "山口"].map((k) => per.filter((x) => (x.name || "").replace(/[\s\u3000]/g, "").includes(k)).map((x) => ({ name: x.name, n: x.n, winRR: +x.winRR.toFixed(1), placeRR: +x.placeRR.toFixed(1), winCI: x.winCI.map((v) => +v.toFixed(1)), placeCI: x.placeCI.map((v) => +v.toFixed(1)), winRate: +x.winRate.toFixed(1), winRateCI: x.winRateCI.map((v) => +v.toFixed(1)), top2: +x.top2.toFixed(1), maxWinPayout: x.maxWinPayout, winRRwithoutMax: +(x.winRRwithoutMax ?? 0).toFixed(1) })));

  // 1走あたりの払戻のばらつきから、n走の標準誤差の目安（母集団全体の1号艇）
  const sdWin = sd(recent.map((x) => x.win)), sdPlace = sd(recent.map((x) => x.place));
  const seAt = (sdv, n) => +(1.96 * sdv / Math.sqrt(n)).toFixed(1);

  // ② 時系列で分けた再現性: 前半窓の値が後半窓の値をどれだけ当てるか
  const MID = process.env.MID_DATE || "2026-05-31";
  const A = group(runs.filter((x) => x.date <= MID)), Bw = group(runs.filter((x) => x.date > MID));
  const pairs = [];
  for (const [rid, ra] of A) { const rb = Bw.get(rid); if (!rb || ra.length < 20 || ra.length > 45 || rb.length < 15) continue; pairs.push([stat(ra), stat(rb)]); }
  const rel = (k) => ({ pearson: +pearson(pairs.map((p) => p[0][k]), pairs.map((p) => p[1][k])).toFixed(3), spearman: +spearman(pairs.map((p) => p[0][k]), pairs.map((p) => p[1][k])).toFixed(3) });
  // 回収率100%超え組と未満組で、後半の回収率の平均が違うか
  const split = (k) => { const hi = pairs.filter((p) => p[0][k] >= 100), lo = pairs.filter((p) => p[0][k] < 100); return { hiN: hi.length, hiNext: hi.length ? +mean(hi.map((p) => p[1][k])).toFixed(1) : null, loN: lo.length, loNext: lo.length ? +mean(lo.map((p) => p[1][k])).toFixed(1) : null }; };
  // 1着率の上位・下位の比較（同じ組み）
  const medWR = q(pairs.map((p) => p[0].winRate), 0.5);
  const wrSplit = { hiN: pairs.filter((p) => p[0].winRate >= medWR).length, hiNextWinRate: +mean(pairs.filter((p) => p[0].winRate >= medWR).map((p) => p[1].winRate)).toFixed(1), loNextWinRate: +mean(pairs.filter((p) => p[0].winRate < medWR).map((p) => p[1].winRate)).toFixed(1), medianSplit: +medWR.toFixed(1) };
  // 同じ窓の中での、1着率と単勝回収率の関係
  const withinCorr = { winRate_vs_winRR: +spearman(per.map((x) => x.winRate), per.map((x) => x.winRR)).toFixed(3), top2_vs_placeRR: +spearman(per.map((x) => x.top2), per.map((x) => x.placeRR)).toFixed(3) };

  const r1 = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" ? +v.toFixed(1) : v]));
  const out = {
    fetchedAt: new Date().toISOString(), source: "race_entries(boat_number=1) × race_results、不成立(race_status='no_race')だけ除く、getRacerBoatReturnRate と同じ式",
    window180: { from: cut180, to: END, boat1Runs: recent.length, racers: byR.size, allBoat1: r1(all1), sdPerRunYen: { win: +sdWin.toFixed(0), place: +sdPlace.toFixed(0) },
      ci95HalfWidthPts: { win: { n20: seAt(sdWin, 20), n30: seAt(sdWin, 30), n45: seAt(sdWin, 45) }, place: { n20: seAt(sdPlace, 20), n30: seAt(sdPlace, 30), n45: seAt(sdPlace, 45) } } },
    band20to45: { racers: per.length, distribution: { winRR: r1(dist("winRR")), placeRR: r1(dist("placeRR")), winRate: r1(dist("winRate")), top2: r1(dist("top2")) },
      bootstrapCI95Width: { winRR: r1(width("winCI")), placeRR: r1(width("placeCI")), winRate: r1(width("winRateCI")), top2: r1(width("top2CI")) },
      shareWinCIcontains75: +share((x) => x.winCI[0] <= 75 && x.winCI[1] >= 75).toFixed(3), shareWinCIcontains100: +share((x) => x.winCI[0] <= 100 && x.winCI[1] >= 100).toFixed(3),
      sharePlaceCIcontains100: +share((x) => x.placeCI[0] <= 100 && x.placeCI[1] >= 100).toFixed(3),
      shareWinRRover100: +share((x) => x.winRR >= 100).toFixed(3), sharePlaceRRover100: +share((x) => x.placeRR >= 100).toFixed(3),
      withinWindowSpearman: withinCorr, bootstrapB: B },
    fourRaces: four,
    timeSplit: { first: `${START}..${MID}（前半20〜45走）`, second: `${addDays(MID, 1)}..${END}（後半15走以上）`, pairs: pairs.length,
      reliability: { winRR: rel("winRR"), placeRR: rel("placeRR"), winRate: rel("winRate"), top2: rel("top2") },
      over100Split: { winRR: split("winRR"), placeRR: split("placeRR") }, winRateMedianSplit: wrSplit },
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
};
main().catch((e) => { console.error(e); process.exit(1); });
