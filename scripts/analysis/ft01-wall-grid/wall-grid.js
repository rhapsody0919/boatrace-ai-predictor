#!/usr/bin/env node
/**
 * FT01 優勝戦の思考の投稿の較正: 準優勝戦・優勝戦の「イン崩れ注意度の3段 × 1号艇（または1コース艇）の展示タイム順位3段」の
 * 1着を逃した率（hq 依頼、2026-10-25）。本番 DB は読み取りだけ（claude_ro、READ ONLY のトランザクション、最後に ROLLBACK）。
 *
 *   node --env-file=.env.local scripts/analysis/ft01-wall-grid/wall-grid.js [--to 2026-10-24] [--out data/analysis/ft01-wall-grid]
 *
 * 定義
 * - 期間: 2025-06-01〜--to。〜2025-12-02 は kb_archive_*（stage が '準優勝戦'・'優勝戦'）、2025-12-03〜 は本体
 *   （race_conditions.race_stage が '準優勝戦'・'優勝戦' の完全一致）
 * - 除外: 不成立（race_status='no_race'）・中止（is_cancelled、races.cancellation_status）・結果なし・返還艇のあるレース
 *   （本体: race_status<>'normal' か F・L、長期: finish_raw が 01〜06 以外の艇がいる）。is_no_race は使わない（BOA-1107）
 * - 注意度: gapband-r-v1。勝率差 = round(1号艇の全国勝率×100) − round(2〜6号艇の最高×100)、帯 = clamp(floor(差/50), -8, 6)、
 *   率 = in_caution_gap_band_daily の (ラウンド, 帯) の race_date < レース日 の累積 non_win/n（朝の生成と同じ、p_from=NULL）。
 *   pct = (200*k + n) div (2*n)、段 low: pct<35、mid: 35<=pct<55、high: pct>=55。累積 n<100 のセルは出さない（sparse）
 * - 展示タイム順位: exhibition_time の6艇の昇順、同タイムは小さい方の順位をそろって取る（method=min。例 6.70・6.70 → ともに1位）。
 *   6艇そろわないレースは除く。3段 1〜2位・3〜4位・5〜6位
 * - 進入: boat 版は艇番1、course 版は実進入1コースの艇（本体 race_results.actual_course_N、長期 kb_archive_boats.course）。
 *   注意度はどちらも1号艇の勝率差で決まる同じ値
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { checkRoUrl, RO_ROLE } from "../../lib/roQuery.js";

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const FROM = "2025-06-01";
const KB_END = "2025-12-02";
const TO = arg("--to", "2026-10-24");
const OUT = arg("--out", "data/analysis/ft01-wall-grid");
const CFG = { thresholds: [35, 55], bandWidthCents: 50, bandMin: -8, bandMax: 6, minCellN: 100 }; // src/constants/inCautionConfig.js

const client = new pg.Client({ connectionString: checkRoUrl(process.env.SUPABASE_RO_DB_URL), ssl: { rejectUnauthorized: false }, application_name: "ft01-wall-grid" });
await client.connect();
let caution, kbRows, mainRows;
try {
  await client.query("BEGIN READ ONLY");
  const who = (await client.query("select current_user u")).rows[0].u;
  if (who !== RO_ROLE) throw new Error(`接続ロールが ${who}（${RO_ROLE} でない）`);
  await client.query("SET LOCAL statement_timeout = '120s'");
  caution = (await client.query(`select race_date::text d, round_grp r, gap_band b, n, non_win k
    from in_caution_gap_band_daily where round_grp in ('junyu','yusho') and race_date < $1::date order by 1`, [TO])).rows;
  kbRows = (await client.query(`select r.race_id, r.race_date::text d, r.stage, b.boat_number bn, b.national_win_rate w,
      b.exhibition_time et, b.course c, b.finish_raw fr
    from kb_archive_races r join kb_archive_boats b on b.race_id = r.race_id
    where r.race_date between $1::date and $2::date and r.stage in ('準優勝戦','優勝戦') and r.has_result`, [FROM, KB_END])).rows;
  mainRows = (await client.query(`select r.race_id, r.race_date::text d, c.race_stage stage, e.boat_number bn, e.win_rate w,
      e.is_absent ea, x.exhibition_time et, x.is_absent xa, rr.rank1, rr.rank2, rr.rank3, rr.rank4, rr.rank5, rr.rank6,
      rr.actual_course_1 a1, rr.actual_course_2 a2, rr.actual_course_3 a3, rr.actual_course_4 a4, rr.actual_course_5 a5, rr.actual_course_6 a6,
      rr.race_status rs, rr.is_cancelled ic, r.cancellation_status cs, st.is_flying f, st.is_late_start l
    from races r join race_conditions c on c.race_id = r.race_id
    join race_entries e on e.race_id = r.race_id
    left join exhibition_data x on x.race_id = r.race_id and x.boat_number = e.boat_number
    left join race_results rr on rr.race_id = r.race_id
    left join race_start_timings st on st.race_id = r.race_id and st.boat_number = e.boat_number
    where r.race_date > $1::date and r.race_date <= $2::date and c.race_stage in ('準優勝戦','優勝戦')`, [KB_END, TO])).rows;
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}

// ---- 注意度: (round,band) ごとに日付順の累積（その日を含まない）
const cum = new Map(); // key r|b -> [{d, n, k}] 昇順・各要素はその日より前の累積
for (const row of caution) {
  const key = `${row.r}|${row.b}`;
  const arr = cum.get(key) ?? [];
  const last = arr.at(-1);
  const base = last ? { n: last.n + last.dn, k: last.k + last.dk } : { n: 0, k: 0 };
  arr.push({ d: row.d, n: base.n, k: base.k, dn: row.n, dk: row.non_win ?? row.k });
  cum.set(key, arr);
}
function cumBefore(r, b, d) {
  const arr = cum.get(`${r}|${b}`) ?? [];
  let lo = 0, hi = arr.length; // 最初の arr[i].d >= d
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].d < d) lo = m + 1; else hi = m; }
  if (lo < arr.length) return { n: arr[lo].n, k: arr[lo].k };
  const last = arr.at(-1);
  return last ? { n: last.n + last.dn, k: last.k + last.dk } : { n: 0, k: 0 };
}
const pctOf = (k, n) => Math.floor((200 * k + n) / (2 * n));
const levelOf = (p) => (p < CFG.thresholds[0] ? "low" : p < CFG.thresholds[1] ? "mid" : "high");
const band = (g) => Math.min(CFG.bandMax, Math.max(CFG.bandMin, Math.floor(g / CFG.bandWidthCents)));
const roundOf = (stage) => (stage === "優勝戦" ? "yusho" : "junyu");
const cents = (v) => (v == null ? null : Math.round(Number(v) * 100));
const rankGroup = (rk) => (rk <= 2 ? "1-2" : rk <= 4 ? "3-4" : "5-6");

// ---- レースごとにまとめる
const drop = {};
const bump = (k) => (drop[k] = (drop[k] ?? 0) + 1);
function groupBy(rows) { const m = new Map(); for (const r of rows) { if (!m.has(r.race_id)) m.set(r.race_id, []); m.get(r.race_id).push(r); } return m; }

const races = [];
function finishRace({ race_id, d, stage, boats, src }) {
  // boats: [{bn, w, et, course, finish (1..6 or null), returned(bool)}]
  if (boats.length !== 6 || new Set(boats.map((b) => b.bn)).size !== 6) return bump(`${src}:6艇でない`);
  if (boats.some((b) => b.returned)) return bump(`${src}:返還艇あり`);
  // 1着の艇が1艇に決まれば足りる（本体は 2025-12〜2026-03 に rank4〜6 が空のレースがある。1着かどうかだけを使う）
  if (boats.filter((b) => b.finish === 1).length !== 1) return bump(`${src}:1着が1艇に決まらない`);
  const ets = boats.map((b) => (b.et == null ? null : Number(b.et)));
  if (ets.some((t) => t == null || !(t > 0))) return bump(`${src}:展示タイムが6艇そろわない`);
  const b1 = boats.find((b) => b.bn === 1);
  const others = boats.filter((b) => b.bn !== 1 && b.w != null).map((b) => cents(b.w));
  if (b1.w == null || others.length === 0) return bump(`${src}:勝率差が出せない`);
  const gap = cents(b1.w) - Math.max(...others);
  const r = roundOf(stage);
  const bnd = band(gap);
  const c = cumBefore(r, bnd, d);
  const rank = (b) => 1 + boats.filter((o) => Number(o.et) < Number(b.et)).length; // method=min
  const c1 = boats.filter((b) => b.course === 1);
  const coursesOk = new Set(boats.map((b) => b.course)).size === 6 && boats.every((b) => b.course >= 1 && b.course <= 6);
  races.push({
    race_id, d, round: r, src, gap, band: bnd, cumN: c.n, cumK: c.k,
    pct: c.n >= CFG.minCellN ? pctOf(c.k, c.n) : null,
    level: c.n >= CFG.minCellN ? levelOf(pctOf(c.k, c.n)) : "sparse",
    boat: { rank: rank(b1), nonWin: b1.finish !== 1 ? 1 : 0 },
    // 感度: 同タイムを大きい方の順位に寄せる（method=max）
    boatTieMax: { rank: boats.filter((o) => Number(o.et) <= Number(b1.et)).length, nonWin: b1.finish !== 1 ? 1 : 0 },
    course: coursesOk && c1.length === 1 ? { bn: c1[0].bn, rank: rank(c1[0]), nonWin: c1[0].finish !== 1 ? 1 : 0 } : null,
    tie1: boats.filter((o) => Number(o.et) === Number(b1.et)).length > 1,
  });
}

for (const [race_id, rows] of groupBy(kbRows)) {
  finishRace({
    race_id, d: rows[0].d, stage: rows[0].stage, src: "kb",
    boats: rows.map((x) => ({
      bn: x.bn, w: x.w, et: x.et, course: x.c,
      finish: /^0[1-6]$/.test(x.fr ?? "") ? Number(x.fr) : null,
      returned: !/^0[1-6]$/.test(x.fr ?? ""), // F・L・K・S・NULL・00 はレースごと除外
    })),
  });
}
for (const [race_id, rows] of groupBy(mainRows)) {
  const x0 = rows[0];
  if (x0.rank1 == null) { bump("main:結果なし"); continue; }
  if (x0.rs === "no_race") { bump("main:不成立"); continue; }
  if (x0.ic || (x0.cs != null && x0.cs !== "")) { bump("main:中止"); continue; }
  if (x0.rs !== "normal") { bump(`main:返還艇あり（race_status=${x0.rs}）`); continue; }
  const order = [x0.rank1, x0.rank2, x0.rank3, x0.rank4, x0.rank5, x0.rank6];
  const ac = [x0.a1, x0.a2, x0.a3, x0.a4, x0.a5, x0.a6];
  finishRace({
    race_id, d: x0.d, stage: x0.stage, src: "main",
    boats: rows.map((x) => ({
      bn: x.bn, w: x.w, et: x.et, course: ac[x.bn - 1],
      finish: order.indexOf(x.bn) >= 0 ? order.indexOf(x.bn) + 1 : null,
      returned: !!(x.ea || x.xa || x.f || x.l),
    })),
  });
}

// ---- 集計
const wilson = (k, n, z = 1.96) => {
  if (n === 0) return [null, null];
  const p = k / n, den = 1 + (z * z) / n, c = (p + (z * z) / (2 * n)) / den;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [+(100 * (c - h)).toFixed(1), +(100 * (c + h)).toFixed(1)];
};
const cell = (rs, key) => {
  const n = rs.length, k = rs.reduce((s, r) => s + r[key].nonWin, 0);
  const [lo, hi] = wilson(k, n);
  return { n, nonWin: k, pct: n ? +((100 * k) / n).toFixed(1) : null, lo, hi };
};
const LEVELS = ["low", "mid", "high"], RG = ["1-2", "3-4", "5-6"], ROUNDS = ["all", "junyu", "yusho"];
function grid(rs, key) {
  const use = rs.filter((r) => r[key] && r.level !== "sparse");
  const out = [];
  for (const rd of ROUNDS) for (const lv of [...LEVELS, "all"]) for (const g of [...RG, "all"]) {
    const sel = use.filter((r) => (rd === "all" || r.round === rd) && (lv === "all" || r.level === lv) && (g === "all" || rankGroup(r[key].rank) === g));
    out.push({ version: key, round: rd, level: lv, exhRank: g, ...cell(sel, key) });
  }
  return out;
}
// 層（ラウンド×段）をそろえた順位3段の傾きの Mantel の検定（得点 1・2・3）
function mantelTrend(rs, key) {
  const use = rs.filter((r) => r[key] && r.level !== "sparse");
  let num = 0, v = 0;
  for (const rd of ["junyu", "yusho"]) for (const lv of LEVELS) {
    const s = use.filter((r) => r.round === rd && r.level === lv);
    const N = s.length; if (N < 2) continue;
    const x = s.map((r) => RG.indexOf(rankGroup(r[key].rank)) + 1), y = s.map((r) => r[key].nonWin);
    const m = y.reduce((a, b) => a + b, 0), sx = x.reduce((a, b) => a + b, 0), sxx = x.reduce((a, b) => a + b * b, 0);
    const T = x.reduce((a, xi, i) => a + xi * y[i], 0);
    num += T - (m * sx) / N;
    v += ((m * (N - m)) / (N * N * (N - 1))) * (N * sxx - sx * sx);
  }
  return { z: +(num / Math.sqrt(v)).toFixed(2), strata: "round×level" };
}

const summary = {
  question: "準優勝戦・優勝戦で、イン崩れ注意度（gapband-r-v1）の3段 × 展示タイム順位3段の1着を逃した率",
  requestedBy: "hq（FT01 優勝戦の思考の投稿の較正）",
  period: { from: FROM, to: TO, kbThrough: KB_END, mainFrom: "2025-12-03",
    actualFirstDate: races.map((r) => r.d).sort()[0], actualLastDate: races.map((r) => r.d).sort().at(-1) },
  generatedAt: new Date().toISOString(),
  definitions: {
    caution: "gapband-r-v1: round(勝率×100) の1号艇−2〜6号艇の最高、帯 clamp(floor/50,-8,6)、in_caution_gap_band_daily の (ラウンド,帯) の前日までの累積、pct=(200k+n) div 2n、low<35・35<=mid<55・high>=55、累積 n<100 は sparse で除外",
    exhRank: "exhibition_time 昇順の6艇内順位、同タイムは method=min（そろって小さい方の順位）、6艇そろわないレースは除外",
    versions: { boat: "艇番1", course: "実進入1コースの艇（本体 actual_course_N、長期 kb_archive_boats.course）。注意度は同じ値" },
    excluded: "不成立（race_status=no_race）・中止（is_cancelled・cancellation_status）・結果なし・返還艇（本体 race_status<>normal か F/L/欠場、長期 finish_raw が 01〜06 以外）。is_no_race は不使用",
  },
  counts: { racesUsed: races.length, bySrc: { kb: races.filter((r) => r.src === "kb").length, main: races.filter((r) => r.src === "main").length },
    sparse: races.filter((r) => r.level === "sparse").length, courseVersionMissing: races.filter((r) => !r.course).length,
    course1NotBoat1: races.filter((r) => r.course && r.course.bn !== 1).length, boat1ExhTie: races.filter((r) => r.tie1).length, dropped: drop },
  mantelTrend: { boat: mantelTrend(races, "boat"), course: mantelTrend(races, "course"),
    boatFirstHalf: mantelTrend(races.filter((r) => r.d < "2026-03-01"), "boat"), boatSecondHalf: mantelTrend(races.filter((r) => r.d >= "2026-03-01"), "boat") },
  byPeriod: { boat_until_2026_02: grid(races.filter((r) => r.d < "2026-03-01"), "boat").filter((c) => c.round === "all" && c.level === "all"),
    boat_from_2026_03: grid(races.filter((r) => r.d >= "2026-03-01"), "boat").filter((c) => c.round === "all" && c.level === "all"),
    boat_dsWindow_2026_03_10_to_10_24: grid(races.filter((r) => r.d >= "2026-03-10"), "boat").filter((c) => c.round === "all" && c.level === "all") },
  grid: [...grid(races, "boat"), ...grid(races, "course")],
  sensitivityTieMax: grid(races, "boatTieMax").filter((c) => c.level !== "high"),
  mantelTrendTieMax: mantelTrend(races, "boatTieMax"),
  pctByLevel: Object.fromEntries(["low", "mid", "high"].map((lv) => { const p = races.filter((r) => r.level === lv).map((r) => r.pct); return [lv, { n: p.length, min: Math.min(...p), max: Math.max(...p) }]; })),
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "wall-grid.json"), JSON.stringify(summary, null, 2) + "\n");
const head = "version,round,level,exh_rank,n,non_win,pct,wilson_lo,wilson_hi";
fs.writeFileSync(path.join(OUT, "wall-grid.csv"), [head, ...summary.grid.map((c) => [c.version, c.round, c.level, c.exhRank, c.n, c.nonWin, c.pct ?? "", c.lo ?? "", c.hi ?? ""].join(","))].join("\n") + "\n");
console.log(JSON.stringify({ period: summary.period, counts: summary.counts, mantelTrend: summary.mantelTrend }, null, 2));
