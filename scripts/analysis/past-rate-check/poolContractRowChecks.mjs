import path from "path";
import { fileURLToPath } from "url";

const ROOT = process.env.REPO_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { supabase } = await import(path.join(ROOT, "scripts/lib/supabaseClient.js"));

const KB_END = "2025-12-02";

// 再現のための固定の乱数（mulberry32）
let seed = 20261016;
const rand = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

async function q(fn, label) {
  for (let t = 0; ; t++) {
    const { data, error } = await fn();
    if (!error) return data;
    if (t === 2) throw new Error(`${label}: ${error.message}`);
    await new Promise((r) => setTimeout(r, 1000 * (t + 1)));
  }
}
async function all(fn, label) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const d = await q(() => fn().range(from, from + 999), label);
    rows.push(...d);
    if (d.length < 1000) return rows;
  }
}

// ---------- (a)〜(e) ----------
/** layer の行を race_id で和集合にする。同じ race_id で行が違う物・漏れ・並び・件数の不整合を数える */
function unionRows(metas) {
  const U = new Map(); const conflict = [];
  const cnt = { leak: 0, orderBad: 0, nMismatch: 0 };
  for (const m of metas.filter((x) => x.status === "ok")) scanLayer(m.body, U, conflict, cnt);
  return { U, conflict, cnt };
}
const isOrderBad = (r, prev) => r.race_date > prev.race_date || (r.race_date === prev.race_date && r.race_id > prev.race_id);
function scanLayer(j, U, conflict, cnt) {
  if (j.rows.length !== j.n_returned || j.n_returned > j.n_total) cnt.nMismatch++;
  for (let i = 0; i < j.rows.length; i++) {
    const r = j.rows[i];
    if (r.race_date > j.pool_cutoff || r.race_date >= j.race_id.slice(0, 10)) cnt.leak++;
    if (i && isOrderBad(r, j.rows[i - 1])) cnt.orderBad++;
    mergeRow(U, conflict, r, j.race_id);
  }
}
function mergeRow(U, conflict, r, from) {
  const s = JSON.stringify(r);
  if (U.has(r.race_id) && U.get(r.race_id).s !== s) conflict.push({ race_id: r.race_id, a: U.get(r.race_id).from, b: from });
  if (!U.has(r.race_id)) U.set(r.race_id, { s, r, from });
}

/** 本体: race_results（全件） */
async function loadRaceResults(mainIds) {
  const RR = new Map();
  for (const c of chunks(mainIds, 200)) for (const x of await q(() => supabase.from("race_results")
    .select("race_id,rank1,rank2,rank3,payout_trio,payout_trifecta,is_cancelled,is_no_race,race_status,refund_boats,actual_course_1,actual_course_2,actual_course_3,actual_course_4,actual_course_5,actual_course_6")
    .in("race_id", c), "rr")) RR.set(x.race_id, x);
  return RR;
}
/** 返還・F・出遅れの艇（条件で引く。期間は標本の行の範囲） */
const loadStBad = (minMain, maxMain) => all(() => supabase.from("race_start_timings").select("race_id,boat_number,start_timing,is_flying,is_late_start,finish_mark")
  .gte("race_id", minMain.slice(0, 10)).lte("race_id", maxMain.slice(0, 10) + "-99")
  .or("is_flying.eq.true,is_late_start.eq.true,finish_mark.in.(F,L,欠)").order("race_id").order("boat_number"), "st bad");
async function loadCancelled(minMain, maxMain) {
  return new Set((await all(() => supabase.from("races").select("race_id").not("cancellation_status", "is", null)
    .gte("race_id", minMain.slice(0, 10)).lte("race_id", maxMain.slice(0, 10) + "-99").order("race_id"), "cancel")).map((x) => x.race_id));
}
/** 長期: kb_archive_races（全件） */
async function loadArchiveRaces(arcIds) {
  const KR = new Map();
  for (const c of chunks(arcIds, 200)) for (const x of await q(() => supabase.from("kb_archive_races")
    .select("race_id,has_result,payout_3tan,payout_3fuku").in("race_id", c), "kr")) KR.set(x.race_id, x);
  return KR;
}
/** 長期: kb_archive_boats（返還・欠けた進入）。race_id -> boats（返還判定・進入・ST） */
async function loadArchiveBoats(arcIds) {
  const KB = new Map();
  const arcSample = shuffle(arcIds).slice(0, 3000);
  for (const c of chunks(arcSample, 150)) for (const x of await q(() => supabase.from("kb_archive_boats")
    .select("race_id,boat_number,course,start_timing,is_flying,is_late_start,finish_raw").in("race_id", c), "kb")) (KB.get(x.race_id) || KB.set(x.race_id, []).get(x.race_id)).push(x);
  return KB;
}

// (a)
function aEval(list, get, tan, fuku) {
  let eqTan = 0, eqFuku = 0, bothNull = 0, nullLayerOnly = 0, missing = 0; const bad = [];
  for (const r of list) {
    const d = get(r.race_id); if (!d) { missing++; continue; }
    const t = d[tan] == null ? null : Number(d[tan]), f = d[fuku] == null ? null : Number(d[fuku]);
    if (r.payout_3tan === t) { if (t == null) bothNull++; else eqTan++; } else { if (r.payout_3tan == null) nullLayerOnly++; bad.push({ race_id: r.race_id, layer: r.payout_3tan, tan: t, fuku: f }); }
    if (r.payout_3tan != null && r.payout_3tan === f) eqFuku++;
  }
  return { n: list.length, eq_3tan: eqTan, both_null: bothNull, mismatch: bad.length, layer_null_db_value: nullLayerOnly, eq_3fuku: eqFuku, missing_in_db: missing, mismatch_examples: bad.slice(0, 10) };
}
function checkA(M, A, RR, KR) {
  const aMainS = shuffle(M).slice(0, 100), aArcS = shuffle(A).slice(0, 100);
  return {
    main_random100: aEval(aMainS, (id) => RR.get(id), "payout_trio", "payout_trifecta"),
    main_all: aEval(M, (id) => RR.get(id), "payout_trio", "payout_trifecta"),
    archive_random100: aEval(aArcS, (id) => KR.get(id), "payout_3tan", "payout_3fuku"),
    archive_all: aEval(A, (id) => KR.get(id), "payout_3tan", "payout_3fuku"),
    layer_null_payout: { main: M.filter((r) => r.payout_3tan == null).length, archive: A.filter((r) => r.payout_3tan == null).length },
  };
}

// (b) 本体: F・出遅れ・欠の艇。コースは DB の実進入（無ければ layer の course_by_boat）
const negativeStAtSameTiming = (r, s) => (r.st_by_course || []).some((v) => v != null && s.start_timing != null && Math.abs(v - Number(s.start_timing)) < 1e-9 && v < 0);
function bMainBoat(s, byId, RR, bRes) {
  const r = byId.get(s.race_id); if (!r) return;
  const d = RR.get(s.race_id);
  const c = d?.[`actual_course_${s.boat_number}`] ?? r.course_by_boat?.[s.boat_number - 1];
  if (!c) { bRes.no_course++; if (negativeStAtSameTiming(r, s)) bRes.violations.push({ race_id: s.race_id, boat: s.boat_number, why: "コース不明で負の ST" }); return; }
  bRes.checked++;
  const v = r.st_by_course?.[c - 1];
  if (v == null) bRes.ok++; else bRes.violations.push({ race_id: s.race_id, boat: s.boat_number, course: c, st: v, flag: { f: s.is_flying, l: s.is_late_start, m: s.finish_mark } });
}
function checkBMain(stBad, byId, RR) {
  const bRes = { checked: 0, ok: 0, violations: [], no_course: 0 };
  for (const s of stBad) bMainBoat(s, byId, RR, bRes);
  return bRes;
}
const isReturnedBoat = (b) => b.is_flying || b.is_late_start || ["F", "L0", "L1"].includes(b.finish_raw);
function bArcBoat(rid, b, r, bArc) {
  if (!isReturnedBoat(b)) return;
  const c = b.course ?? r.course_by_boat?.[b.boat_number - 1]; if (!c || c < 1 || c > 6) return;
  bArc.checked++;
  if (r.st_by_course?.[c - 1] == null) bArc.ok++; else bArc.violations.push({ race_id: rid, boat: b.boat_number, course: c, st: r.st_by_course[c - 1] });
}
/** 長期（標本 3,000 レース） */
function checkBArc(KB, byId) {
  const bArc = { checked: 0, ok: 0, violations: [] };
  for (const [rid, boats] of KB) {
    const r = byId.get(rid);
    for (const b of boats) bArcBoat(rid, b, r, bArc);
  }
  return bArc;
}

// (c)
const isNonRace = (r, RR, cancelled) => { const d = RR.get(r.race_id); return cancelled.has(r.race_id) || !d || d.rank1 == null || d.is_cancelled || d.is_no_race || d.race_status === "no_race"; };
const nonRaceRow = (r, RR, cancelled) => ({ race_id: r.race_id, rr: RR.get(r.race_id) ? { rank1: RR.get(r.race_id).rank1, is_cancelled: RR.get(r.race_id).is_cancelled, is_no_race: RR.get(r.race_id).is_no_race, race_status: RR.get(r.race_id).race_status } : null, cancelled: cancelled.has(r.race_id) });
function checkC(M, A, RR, KR, cancelled) {
  const cMain = M.filter((r) => isNonRace(r, RR, cancelled)).map((r) => nonRaceRow(r, RR, cancelled));
  const cArc = A.filter((r) => { const d = KR.get(r.race_id); return !d || !d.has_result; }).map((r) => r.race_id);
  const statusCounts = {}; for (const r of M) { const s = RR.get(r.race_id)?.race_status ?? "null"; statusCounts[s] = (statusCounts[s] || 0) + 1; }
  return { cMain, cArc, statusCounts };
}

// (d) 本体: course_by_boat と DB の actual_course を艇ごとに照合
const dbCourses = (x) => [1, 2, 3, 4, 5, 6].map((b) => { const v = x[`actual_course_${b}`]; return v == null || v < 1 || v > 6 ? null : Number(v); });
function dMainBoat(m, r, db, b) {
  const l = r.course_by_boat?.[b] ?? null, v = db[b];
  if (l === v) m.layer_eq_db++; else if (l == null) m.layer_null_db_value++; else if (v == null) { m.layer_value_db_null++; if (m.examples.length < 10) m.examples.push({ race_id: r.race_id, boat: b + 1, layer: l, db: null }); } else { m.layer_ne_db++; if (m.examples.length < 10) m.examples.push({ race_id: r.race_id, boat: b + 1, layer: l, db: v }); }
}
function dMainRow(m, r, x) {
  if (!x) return;
  m.rows++;
  const db = dbCourses(x);
  if (db.every((v) => v == null)) { m.db_all_null++; if ((r.course_by_boat || []).some((v) => v != null)) { m.db_all_null_layer_filled++; m.examples.push({ race_id: r.race_id, layer: r.course_by_boat, db }); } }
  for (let b = 0; b < 6; b++) dMainBoat(m, r, db, b);
}
function dArchiveRace(s, rid, boats, r) {
  s.rows++;
  for (const b of boats) {
    const l = r.course_by_boat?.[b.boat_number - 1] ?? null, v = b.course == null || b.course < 1 || b.course > 6 ? null : Number(b.course);
    if (l === v) { if (l == null) s.layer_null_db_null++; else s.layer_eq_db++; } else if (v == null) { s.layer_value_db_null++; s.examples.length < 10 && s.examples.push({ race_id: rid, boat: b.boat_number, layer: l, db: v }); } else { s.layer_ne_db++; s.examples.length < 10 && s.examples.push({ race_id: rid, boat: b.boat_number, layer: l, db: v }); }
  }
}
function checkD(M, RR, KB, byId) {
  const d = { main: { rows: 0, db_all_null: 0, db_all_null_layer_filled: 0, layer_eq_db: 0, layer_null_db_value: 0, layer_value_db_null: 0, layer_ne_db: 0, examples: [] },
    archive_sample: { rows: 0, layer_eq_db: 0, layer_null_db_null: 0, layer_value_db_null: 0, layer_ne_db: 0, examples: [] } };
  for (const r of M) dMainRow(d.main, r, RR.get(r.race_id));
  const layerNullRows = M.filter((r) => (r.course_by_boat || []).some((v) => v == null));
  d.main.layer_rows_with_null = layerNullRows.length;
  d.main.layer_rows_with_null_by_month = layerNullRows.reduce((o, r) => ((o[r.race_date.slice(0, 7)] = (o[r.race_date.slice(0, 7)] || 0) + 1), o), {});
  for (const [rid, boats] of KB) dArchiveRace(d.archive_sample, rid, boats, byId.get(rid));
  return d;
}

// (e) 本体: 1〜3着の艇が返還（refund_boats・finish_mark F/L/欠・is_flying・is_late_start）
function parseRefundBoats(raw) {
  let rb = []; try { rb = Array.isArray(raw) ? raw : JSON.parse(raw || "[]"); } catch { rb = []; }
  return rb;
}
function eMainRow(m, r, x, bad) {
  if (!x) return;
  m.rows++;
  const rb = parseRefundBoats(x.refund_boats);
  if (rb.length) m.races_with_refund_in_pool_period++;
  const top = [r.rank1, r.rank2, r.rank3];
  const hit = top.filter((b) => rb.map(Number).includes(b) || bad.get(r.race_id)?.has(b));
  if (hit.length) m.violations.push({ race_id: r.race_id, top, refund_boats: rb, flagged: [...(bad.get(r.race_id) || [])] });
  if (x.rank1 !== r.rank1 || x.rank2 !== r.rank2 || x.rank3 !== r.rank3) { m.rank_ne_db++; m.rank_ne_examples.length < 10 && m.rank_ne_examples.push({ race_id: r.race_id, layer: top, db: [x.rank1, x.rank2, x.rank3] }); }
}
function eArchiveRace(s, rid, boats, r) {
  s.rows++;
  const ret = new Set(boats.filter(isReturnedBoat).map((b) => b.boat_number));
  if ([r.rank1, r.rank2, r.rank3].some((b) => ret.has(b))) s.violations.push({ race_id: rid, top: [r.rank1, r.rank2, r.rank3], returned: [...ret] });
}
function checkE(M, RR, KB, byId, stBad) {
  const bad = new Map(); for (const s of stBad) (bad.get(s.race_id) || bad.set(s.race_id, new Set()).get(s.race_id)).add(s.boat_number);
  const e = { main: { rows: 0, violations: [], rank_ne_db: 0, rank_ne_examples: [], races_with_refund_in_pool_period: 0 }, archive_sample: { rows: 0, violations: [] } };
  for (const r of M) eMainRow(e.main, r, RR.get(r.race_id), bad);
  for (const [rid, boats] of KB) eArchiveRace(e.archive_sample, rid, boats, byId.get(rid));
  // 返還を含むレース（1〜3着の外の返還）が行に残っていること（除きすぎていないか）
  e.main.rows_with_refund_outside_top3 = M.filter((r) => bad.has(r.race_id)).length;
  return e;
}

async function rowChecks(metas) {
  const { U, conflict, cnt } = unionRows(metas);
  const rows = [...U.values()].map((v) => v.r);
  const M = rows.filter((r) => r.race_date > KB_END), A = rows.filter((r) => r.race_date <= KB_END);
  console.log("union rows", rows.length, "main", M.length, "archive", A.length);
  const mainIds = M.map((r) => r.race_id), arcIds = A.map((r) => r.race_id);

  const RR = await loadRaceResults(mainIds);
  const minMain = mainIds.reduce((a, b) => (a < b ? a : b), "9"), maxMain = mainIds.reduce((a, b) => (a > b ? a : b), "0");
  const stBad = await loadStBad(minMain, maxMain);
  const cancelled = await loadCancelled(minMain, maxMain);
  const KR = await loadArchiveRaces(arcIds);
  const KB = await loadArchiveBoats(arcIds);

  const byId = new Map(rows.map((r) => [r.race_id, r]));
  const a = checkA(M, A, RR, KR);
  const bRes = checkBMain(stBad, byId, RR);
  const bArc = checkBArc(KB, byId);
  const negST = rows.filter((r) => (r.st_by_course || []).some((v) => v != null && v < 0)).length;
  const { cMain, cArc, statusCounts } = checkC(M, A, RR, KR, cancelled);
  const d = checkD(M, RR, KB, byId);
  const e = checkE(M, RR, KB, byId, stBad);

  return {
    union: { rows: rows.length, main: M.length, archive: A.length, main_range: [minMain, maxMain],
      same_race_different_row_across_layers: conflict.length, conflict_examples: conflict.slice(0, 10),
      rows_after_cutoff_or_race_day: cnt.leak, order_violations: cnt.orderBad, layers_n_mismatch: cnt.nMismatch },
    a, b: { main: { ...bRes, violations_n: bRes.violations.length, violations: bRes.violations.slice(0, 20), st_bad_boats_in_period: stBad.length },
      archive_sample: { ...bArc, violations_n: bArc.violations.length, violations: bArc.violations.slice(0, 20) }, rows_with_negative_st: negST },
    c: { main_violations: cMain.length, main_examples: cMain.slice(0, 20), archive_violations: cArc.length, archive_examples: cArc.slice(0, 20), main_race_status: statusCounts, cancelled_in_period: cancelled.size },
    d, e: { main: { ...e.main, violations_n: e.main.violations.length, violations: e.main.violations.slice(0, 20) }, archive_sample: { ...e.archive_sample, violations_n: e.archive_sample.violations.length, violations: e.archive_sample.violations.slice(0, 20) } },
  };
}

export { ROOT, supabase, shuffle, q, all, rowChecks };
