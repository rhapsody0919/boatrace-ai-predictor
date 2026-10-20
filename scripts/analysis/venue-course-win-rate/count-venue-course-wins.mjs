/**
 * 会場×進入コース（1〜6）の1着率と母数を、期間（直近3か月・6か月・1年）ごとに数える（ブログの図の母数確認）。
 * 本番 DB は読み取りだけ。新しい表 race_results（2025-12-03〜）と長期の表 kb_archive_*（〜2025-12-02）をつなぐ。
 *
 * 定義:
 *   分母 races        結果のあるレース（不成立 race_status='no_race' を除く。中止・順延は race_results に行が無い）
 *   分子 wins_course  1着艇（返還艇を除く rank1。長期の表は finish_rank=1）の実際の進入コース（K ファイル）が k
 *   参考 wins_waku    1着艇の枠番（艇番）が k
 *   races_course_present  コース k に艇がいたレース（欠場で5艇以下だと6コースが無い）
 *   1着艇の進入コースが不明なレースは分母から除き、件数を別に出す
 *   同着: 長期の表は dead_heat、新しい表は remark に「同着あり」。1着の同着は rank1 の1艇だけを数え、件数を出す
 * 使い方: node scripts/analysis/venue-course-win-rate/count-venue-course-wins.mjs [--to=2026-10-19] [--out=path]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const LIB = process.env.REPO_LIB ?? new URL("../../lib/", import.meta.url).href;
const { supabase, fetchAll } = await import(new URL("supabaseClient.js", LIB.endsWith("/") ? LIB : LIB + "/").href);
const { placedRanks, isNoRaceResult } = await import(new URL("raceOutcomeFilters.js", LIB.endsWith("/") ? LIB : LIB + "/").href);

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const TO = arg("to") ?? "2026-10-19";
const OUT = arg("out") ?? "data/analysis/venue-course-win-rate/venue-course-win-rate.json";
const CUTOVER = "2025-12-03"; // これより前は kb_archive_*
const shift = (d, months) => { const x = new Date(d + "T00:00:00Z"); x.setUTCMonth(x.getUTCMonth() - months); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
const PERIODS = { "3m": shift(TO, 3), "6m": shift(TO, 6), "12m": shift(TO, 12) };
const FROM = PERIODS["12m"];
const nextDay = (d) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };

const wilson = (k, n, z = 1.96) => {
  if (!n) return [null, null];
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [+((c - h) / d).toFixed(4), +((c + h) / d).toFixed(4)];
};

// 1レース = { date, venue, winnerCourse, winnerWaku, coursesPresent:Set, waku_nari, dead_heat, partial_refund, src }
const races = [];
const skipped = { no_race: 0, winner_course_unknown: 0, no_winner: 0 };

// 長期の表
if (FROM < CUTOVER) {
  const kr = await fetchAll("kb_archive_races", "race_id,race_date,venue_code,has_result,dead_heat",
    (q) => q.gte("race_date", FROM).lt("race_date", CUTOVER).order("race_id"));
  const kb = await fetchAll("kb_archive_boats", "race_id,boat_number,course,finish_rank,finish_raw",
    (q) => q.gte("race_id", FROM).lt("race_id", CUTOVER).order("race_id").order("boat_number"));
  const byRace = new Map();
  for (const b of kb) { if (!byRace.has(b.race_id)) byRace.set(b.race_id, []); byRace.get(b.race_id).push(b); }
  for (const r of kr) {
    if (!r.has_result) { skipped.no_race++; continue; }
    const boats = byRace.get(r.race_id) ?? [];
    const winners = boats.filter((b) => b.finish_rank === 1).sort((a, b) => a.boat_number - b.boat_number);
    if (!winners.length) { skipped.no_winner++; continue; }
    const w = winners[0];
    if (w.course == null) { skipped.winner_course_unknown++; continue; }
    const present = new Set(boats.filter((b) => b.course != null).map((b) => b.course));
    const nari = boats.filter((b) => b.course != null).every((b) => b.course === b.boat_number);
    const refund = boats.some((b) => b.finish_raw && !/^0[1-6]$/.test(b.finish_raw.trim()));
    races.push({ date: r.race_date, venue: r.venue_code, winnerCourse: w.course, winnerWaku: w.boat_number, present, nari,
      dead_heat: !!r.dead_heat && winners.length > 1, partial_refund: refund, boats: boats.filter((b) => b.course != null).length, src: "kb_archive" });
  }
}
// 新しい表
const rr = await fetchAll("race_results",
  "race_id,rank1,race_status,refund_boats,remark,actual_course_1,actual_course_2,actual_course_3,actual_course_4,actual_course_5,actual_course_6",
  (q) => q.gte("race_id", FROM < CUTOVER ? CUTOVER : FROM).lt("race_id", nextDay(TO)).order("race_id"));
for (const r of rr) {
  const venue = parseInt(r.race_id.split("-")[3], 10), date = r.race_id.slice(0, 10);
  if (isNoRaceResult(r)) { skipped.no_race++; continue; }
  const { rank1 } = placedRanks(r);
  if (rank1 == null) { skipped.no_winner++; continue; }
  const ac = [1, 2, 3, 4, 5, 6].map((n) => r[`actual_course_${n}`]);
  const wc = ac[rank1 - 1];
  if (wc == null) { skipped.winner_course_unknown++; continue; }
  const present = new Set(ac.filter((c) => c != null));
  const nari = ac.every((c, i) => c == null || c === i + 1);
  races.push({ date, venue, winnerCourse: wc, winnerWaku: rank1, present, nari, dead_heat: /同着/.test(r.remark ?? ""),
    partial_refund: r.race_status === "partial_refund", boats: present.size, src: "race_results" });
}

// 中止・順延（confirmed）の件数（注記用）
const cancelled = await fetchAll("races", "race_id,cancellation_status",
  (q) => q.eq("cancellation_status", "confirmed").gte("race_id", FROM).lt("race_id", nextDay(TO)).order("race_id"));

const VN = ["", "桐生", "戸田", "江戸川", "平和島", "多摩川", "浜名湖", "蒲郡", "常滑", "津", "三国", "びわこ", "住之江", "尼崎", "鳴門", "丸亀", "児島", "宮島", "徳山", "下関", "若松", "芦屋", "福岡", "唐津", "大村"];
const summarize = (list) => {
  const n = list.length;
  const by = (f) => [1, 2, 3, 4, 5, 6].map((k) => list.filter((r) => f(r) === k).length);
  const wc = by((r) => r.winnerCourse), ww = by((r) => r.winnerWaku);
  const present = [1, 2, 3, 4, 5, 6].map((k) => list.filter((r) => r.present.has(k)).length);
  return {
    races: n,
    days: new Set(list.map((r) => r.date)).size,
    not_waku_nari_races: list.filter((r) => !r.nari).length,
    under6_boats_races: list.filter((r) => r.boats < 6).length,
    partial_refund_races: list.filter((r) => r.partial_refund).length,
    dead_heat_first_races: list.filter((r) => r.dead_heat).length,
    by_course: [1, 2, 3, 4, 5, 6].map((k, i) => ({
      course: k, wins: wc[i], rate: n ? +(wc[i] / n).toFixed(4) : null, ci95: wilson(wc[i], n),
      races_course_present: present[i], rate_if_present: present[i] ? +(wc[i] / present[i]).toFixed(4) : null,
    })),
    by_waku: [1, 2, 3, 4, 5, 6].map((k, i) => ({ waku: k, wins: ww[i], rate: n ? +(ww[i] / n).toFixed(4) : null })),
    max_abs_diff_course_vs_waku_pt: n ? +Math.max(...[0, 1, 2, 3, 4, 5].map((i) => Math.abs(wc[i] - ww[i]) / n * 100)).toFixed(2) : null,
  };
};
const lines = races.map((r) => `${r.date}|${r.venue}|${r.winnerWaku}|${r.winnerCourse}`).sort();
const out = { generated_at: new Date().toISOString(), period_to: TO, script: "scripts/analysis/venue-course-win-rate/count-venue-course-wins.mjs",
  definition: { denominator: "結果のあるレース（不成立を除く。中止・順延は結果の行が無いので入らない）", numerator: "1着艇（返還艇を除く）の実際の進入コース（公式Kファイル）", waku_reference: "1着艇の枠番（艇番）", ci: "Wilson 95%", dead_heat: "1着の同着は艇番の小さい1艇（新しい表は rank1）" },
  max_race_date: lines.length ? lines[lines.length - 1].slice(0, 10) : null, content_sha256: crypto.createHash("sha256").update(lines.join("\n")).digest("hex"), periods: {}, sources: { kb_archive: `${FROM}〜2025-12-02`, race_results: `${CUTOVER}〜${TO}` },
  skipped_total: skipped, rows: { races_counted: races.length, race_results_rows: rr.length }, cancelled_confirmed_races: cancelled.length };
for (const [key, from] of Object.entries(PERIODS)) {
  const inP = races.filter((r) => r.date >= from && r.date <= TO);
  out.periods[key] = { from, to: TO, all: summarize(inP), venues: {} };
  for (let v = 1; v <= 24; v++) {
    const s = summarize(inP.filter((r) => r.venue === v));
    s.cancelled_confirmed = cancelled.filter((c) => +c.race_id.split("-")[3] === v && c.race_id.slice(0, 10) >= from).length;
    out.periods[key].venues[String(v).padStart(2, "0")] = { name: VN[v], ...s };
  }
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log("written", OUT, races.length, skipped);
