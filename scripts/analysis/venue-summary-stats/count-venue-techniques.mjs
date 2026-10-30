/**
 * 会場の常設の要約（BOA-1189 GS02-b）に出す数字の検証。本番 DB は読み取りだけ（SELECT のみ）。
 *
 * 数えるもの:
 *   1. 会場×決まり手（逃げ・差し・まくり・まくり差し・抜き・恵まれ）の割合。分母は結果と決まり手のあるレース
 *   2. 会場×進入コースの1着率（venue-course-win-rate と同じ定義。決まり手との重なりと更新の幅を見るために数え直す）
 *   3. 会場差が偶然を超えるか: 信頼性 = 1 − 平均の標本分散 ÷ 会場間の観測分散、前半6か月×後半6か月の会場順位の相関（Spearman）
 *   4. 1コースの逃げと1コース1着の重なり（1コース1着の内訳: 逃げ・抜き・恵まれ・その他）
 *   5. 更新の幅: 1か月ずらした12か月の窓どうしの差、今の会場カード（直近90日）との差
 *   6. venues.cluster（会場カードの「イン強い／アウト強い／バランス型」）と12か月の1号艇1着率の照合
 *
 * 定義:
 *   レース: 不成立（race_status='no_race'）・中止（is_cancelled が false でない）・1着なし・決まり手なしを除く
 *           （winning_technique_stats・venue_technique_period_stats と同じ除外）
 *   2025-12-02 以前は kb_archive_races（technique）＋ kb_archive_boats（course・finish_rank）、
 *   2025-12-03 以降は race_results（winning_technique・rank1・actual_course_N）
 *   1着艇の進入コースが不明なレースは、決まり手の集計には入れ、コースの集計からは外す
 * 使い方: node --env-file=.env.local scripts/analysis/venue-summary-stats/count-venue-techniques.mjs [--to=2026-10-30] [--out=path]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { supabase, fetchAll } from "../../lib/supabaseClient.js";
import { placedRanks, isNoRaceResult } from "../../lib/raceOutcomeFilters.js";

if (!supabase) throw new Error("Supabase の環境変数が無い");

const ARGS = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const TO = ARGS.to ?? "2026-10-30";
const OUT = ARGS.out ?? "data/analysis/venue-summary-stats/venue-techniques.json";
const CUTOVER = "2025-12-03";
const TECH = ["逃げ", "差し", "まくり", "まくり差し", "抜き", "恵まれ"];
const VN = ["", "桐生", "戸田", "江戸川", "平和島", "多摩川", "浜名湖", "蒲郡", "常滑", "津", "三国", "びわこ", "住之江", "尼崎", "鳴門", "丸亀", "児島", "宮島", "徳山", "下関", "若松", "芦屋", "福岡", "唐津", "大村"];

function addDays(d, n) {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
function monthsBack(d, m) {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCMonth(x.getUTCMonth() - m);
  return addDays(x.toISOString().slice(0, 10), 1);
}
const TO_PREV = addDays(monthsBack(TO, 1), -1); // 1か月前の12か月の窓の終わり
const FETCH_FROM = monthsBack(TO_PREV, 12);
const W = {
  "12m": { from: monthsBack(TO, 12), to: TO },
  "6m": { from: monthsBack(TO, 6), to: TO },
  "3m": { from: monthsBack(TO, 3), to: TO },
  "90d": { from: addDays(TO, -89), to: TO },
  "12m_first_half": { from: monthsBack(TO, 12), to: addDays(monthsBack(TO, 6), -1) },
  "12m_second_half": { from: monthsBack(TO, 6), to: TO },
  "12m_prev_month": { from: FETCH_FROM, to: TO_PREV },
};

const races = []; // { date, venue, tech, wc（1着艇の進入コース or null）, ww（1着艇の枠番） }
const skipped = { no_race_or_cancelled: 0, no_winner: 0, no_technique: 0 };

if (FETCH_FROM < CUTOVER) {
  const kr = await fetchAll("kb_archive_races", "race_id,race_date,venue_code,has_result,technique",
    (q) => q.gte("race_date", FETCH_FROM).lt("race_date", CUTOVER).order("race_id"));
  const kb = await fetchAll("kb_archive_boats", "race_id,boat_number,course,finish_rank",
    (q) => q.gte("race_id", FETCH_FROM).lt("race_id", CUTOVER).eq("finish_rank", 1).order("race_id").order("boat_number"));
  const win = new Map();
  for (const b of kb) if (!win.has(b.race_id)) win.set(b.race_id, b); // 1着の同着は艇番の小さい1艇
  for (const r of kr) {
    if (!r.has_result) { skipped.no_race_or_cancelled++; continue; }
    const w = win.get(r.race_id);
    if (!w) { skipped.no_winner++; continue; }
    if (!r.technique) { skipped.no_technique++; continue; }
    races.push({ date: r.race_date, venue: Number(r.venue_code), tech: r.technique, wc: w.course ?? null, ww: w.boat_number });
  }
}
const rr = await fetchAll("race_results",
  "race_id,rank1,race_status,is_cancelled,refund_boats,winning_technique,actual_course_1,actual_course_2,actual_course_3,actual_course_4,actual_course_5,actual_course_6",
  (q) => q.gte("race_id", FETCH_FROM < CUTOVER ? CUTOVER : FETCH_FROM).lt("race_id", addDays(TO, 1)).order("race_id"));
for (const r of rr) {
  if (isNoRaceResult(r) || r.is_cancelled !== false) { skipped.no_race_or_cancelled++; continue; }
  const { rank1 } = placedRanks(r);
  if (rank1 == null) { skipped.no_winner++; continue; }
  if (!r.winning_technique) { skipped.no_technique++; continue; }
  races.push({ date: r.race_id.slice(0, 10), venue: parseInt(r.race_id.split("-")[3], 10), tech: r.winning_technique, wc: r["actual_course_" + rank1] ?? null, ww: rank1 });
}

const venuesRes = await supabase.from("venues").select("code,cluster").order("code");
if (venuesRes.error) throw new Error("venues の読み取りに失敗: " + venuesRes.error.message);
const clusterOf = Object.fromEntries(venuesRes.data.map((v) => [v.code, v.cluster]));

function wilson(k, n, z = 1.96) {
  if (!n) return [null, null];
  const p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [+((c - h) / d).toFixed(4), +((c + h) / d).toFixed(4)];
}
const r4 = (x) => (x == null || Number.isNaN(x) ? null : +x.toFixed(4));
const inW = (w) => races.filter((r) => r.date >= W[w].from && r.date <= W[w].to);

function summarize(list) {
  const n = list.length;
  const withCourse = list.filter((r) => r.wc != null);
  const nc = withCourse.length;
  const tech = Object.fromEntries(TECH.map((t) => {
    const k = list.filter((r) => r.tech === t).length;
    return [t, { count: k, rate: n ? r4(k / n) : null, ci95: wilson(k, n) }];
  }));
  const other = list.filter((r) => !TECH.includes(r.tech)).length;
  const course = [1, 2, 3, 4, 5, 6].map((c) => {
    const k = withCourse.filter((r) => r.wc === c).length;
    return { course: c, wins: k, rate: nc ? r4(k / nc) : null, ci95: wilson(k, nc) };
  });
  const waku1 = list.filter((r) => r.ww === 1).length;
  const c1 = withCourse.filter((r) => r.wc === 1);
  const br = { "逃げ": 0, "抜き": 0, "恵まれ": 0, other: 0 };
  for (const r of c1) br[r.tech in br ? r.tech : "other"]++;
  return {
    races: n, races_with_winner_course: nc, other_technique: other, techniques: tech, by_course: course,
    waku1_win_rate: n ? r4(waku1 / n) : null,
    course1_win_breakdown: { course1_wins: c1.length, ...br, nige_share_of_course1_wins: c1.length ? r4(br["逃げ"] / c1.length) : null },
    nige_by_not_course1: withCourse.filter((r) => r.tech === "逃げ" && r.wc !== 1).length,
    course1_rate_minus_nige_rate_pt: n && nc ? +((c1.length / nc - tech["逃げ"].count / n) * 100).toFixed(2) : null,
  };
}

// 信頼性（会場間の分散のうち偶然で説明できない割合）
function reliability(rows) {
  const ps = rows.map((r) => r.p), m = ps.reduce((a, b) => a + b, 0) / ps.length;
  const obs = ps.reduce((a, p) => a + (p - m) ** 2, 0) / (ps.length - 1);
  const samp = rows.reduce((a, r) => a + (r.p * (1 - r.p)) / r.n, 0) / rows.length;
  return obs > 0 ? r4(Math.max(0, 1 - samp / obs)) : null;
}
function rank(xs) {
  const s = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const out = Array(xs.length);
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j + 1 < s.length && s[j + 1][0] === s[i][0]) j++;
    for (let k = i; k <= j; k++) out[s[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}
function spearman(a, b) {
  const ra = rank(a), rb = rank(b), n = a.length, mean = (n + 1) / 2;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - mean) * (rb[i] - mean);
    da += (ra[i] - mean) ** 2;
    db += (rb[i] - mean) ** 2;
  }
  return r4(num / Math.sqrt(da * db));
}

const per = {};
for (const w of Object.keys(W)) {
  const list = inW(w);
  per[w] = { ...W[w], all: summarize(list), venues: {} };
  for (let v = 1; v <= 24; v++) per[w].venues[String(v).padStart(2, "0")] = { name: VN[v], ...summarize(list.filter((r) => r.venue === v)) };
}
const vkeys = Object.keys(per["12m"].venues);
function metricRows(w, kind, key) {
  return vkeys.map((vk) => {
    const s = per[w].venues[vk];
    if (kind === "tech") return { p: s.techniques[key].rate, k: s.techniques[key].count, n: s.races };
    const c = s.by_course[key - 1];
    return { p: c.rate, k: c.wins, n: s.races_with_winner_course };
  });
}
const absChange = (a, b) => a.map((r, i) => Math.abs(r.p - b[i].p) * 100);
const maxOf = (xs) => +Math.max(...xs).toFixed(2);
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return +((s[11] + s[12]) / 2).toFixed(2);
}
const metrics = [...TECH.map((t) => ["tech", t]), ...[1, 2, 3, 4, 5, 6].map((c) => ["course", c])];
const venueDiff = {};
for (const [kind, key] of metrics) {
  const name = kind === "tech" ? key : "course" + key;
  const cur = metricRows("12m", kind, key);
  const allS = per["12m"].all;
  const allN = kind === "tech" ? allS.races : allS.races_with_winner_course;
  const allK = kind === "tech" ? allS.techniques[key].count : allS.by_course[key - 1].wins;
  // その会場を除く全国との2群の比率の z。Bonferroni（24会場）で |z|>3.08 を「全国と違う」とする
  const vsNation = cur.map((r, i) => {
    const kr = allK - r.k, nr = allN - r.n, pr = kr / nr, pp = allK / allN;
    const z = (r.p - pr) / Math.sqrt(pp * (1 - pp) * (1 / r.n + 1 / nr));
    return { venue: VN[Number(vkeys[i])], diff_pt: +((r.p - pr) * 100).toFixed(2), z: +z.toFixed(2) };
  });
  const d90 = metricRows("90d", kind, key), prev = metricRows("12m_prev_month", kind, key);
  venueDiff[name] = {
    reliability: { "3m": reliability(metricRows("3m", kind, key)), "6m": reliability(metricRows("6m", kind, key)), "12m": reliability(cur) },
    split_half_spearman: spearman(metricRows("12m_first_half", kind, key).map((r) => r.p), metricRows("12m_second_half", kind, key).map((r) => r.p)),
    count_12m_min: Math.min(...cur.map((r) => r.k)), count_12m_max: Math.max(...cur.map((r) => r.k)),
    count_90d_min: Math.min(...d90.map((r) => r.k)),
    rate_12m_range_pt: [+(Math.min(...cur.map((r) => r.p)) * 100).toFixed(1), +(Math.max(...cur.map((r) => r.p)) * 100).toFixed(1)],
    national_12m: r4(allK / allN),
    venues_beyond_national_bonferroni: vsNation.filter((x) => Math.abs(x.z) > 3.08).map((x) => x.venue + (x.diff_pt > 0 ? "+" : "") + x.diff_pt),
    venues_beyond_national_z196_count: vsNation.filter((x) => Math.abs(x.z) > 1.96).length,
    vs_national: vsNation,
    change_vs_prev_month_window_pt: { max: maxOf(absChange(cur, prev)), median: median(absChange(cur, prev)) },
    change_90d_vs_12m_pt: { max: maxOf(absChange(d90, cur)), median: median(absChange(d90, cur)) },
    venue_rank_spearman_90d_vs_12m: spearman(d90.map((r) => r.p), cur.map((r) => r.p)),
  };
}

// venues.cluster（001_schema.sql update_venue_stats の式: 枠番1の1着率 >=60% in_strong、<50% out_strong、他 balanced。直近90日）と照合
const clusterOfRate = (p) => (p >= 0.6 ? "in_strong" : p < 0.5 ? "out_strong" : "balanced");
const clusterCheck = vkeys.map((vk) => {
  const v = Number(vk), s12 = per["12m"].venues[vk], s90 = per["90d"].venues[vk];
  return {
    venue: VN[v], db_cluster: clusterOf[v] ?? null,
    waku1_win_rate_12m: s12.waku1_win_rate, waku1_win_rate_90d: s90.waku1_win_rate,
    same_rule_12m: clusterOfRate(s12.waku1_win_rate), same_rule_90d: clusterOfRate(s90.waku1_win_rate),
    match_12m: clusterOf[v] === clusterOfRate(s12.waku1_win_rate), match_90d: clusterOf[v] === clusterOfRate(s90.waku1_win_rate),
  };
});

const lines = races.map((r) => [r.date, r.venue, r.ww, r.wc, r.tech].join("|")).sort();
const out = {
  generated_at: new Date().toISOString(),
  script: "scripts/analysis/venue-summary-stats/count-venue-techniques.mjs",
  period_to: TO, windows: W,
  definition: {
    denominator_technique: "結果と決まり手のあるレース（不成立・中止・1着なし・決まり手なしを除く。winning_technique_stats・venue_technique_period_stats と同じ除外）",
    denominator_course: "そのうち1着艇の進入コースが分かるレース",
    reliability: "1 − 平均の標本分散 p(1−p)/n ÷ 会場間の観測分散（24会場、不偏分散）",
    split_half: "12m_first_half と 12m_second_half の会場順位の Spearman",
    vs_national: "その会場を除く全国との2群の比率の z。Bonferroni（24会場）の閾値 |z|>3.08",
    cluster_rule: "docs/db-migration/001_schema.sql update_venue_stats(): 枠番1の1着率 >=0.60 in_strong、<0.50 out_strong（元は直近90日）",
    sources: { kb_archive: FETCH_FROM + "〜2025-12-02", race_results: CUTOVER + "〜" + TO },
  },
  skipped, races_counted: races.length,
  content_sha256: crypto.createHash("sha256").update(lines.join("\n")).digest("hex"),
  venue_difference: venueDiff,
  cluster_check: clusterCheck,
  windows_detail: Object.fromEntries(["12m", "90d", "12m_first_half", "12m_second_half"].map((w) => [w, per[w]])),
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log("written", OUT, races.length, JSON.stringify(skipped));
