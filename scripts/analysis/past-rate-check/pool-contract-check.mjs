/**
 * BOA-635 T0-3 本番の値の約束の実測（spec「母集団の約束」D-1〜D-6）。読み取りだけ（DB・Storage に書かない）。
 *  (a) payout_3tan = race_results.payout_trio（3連単）で payout_trifecta（3連複）ではない。長期は kb_archive_races.payout_3tan
 *  (b) F・出遅れの艇のコースの st_by_course が null
 *  (c) 不成立・中止のレースが行に無い
 *  (d) 実進入が分からない艇が艇番で埋まっていない（course_by_boat を DB の実進入と照合）
 *  (e) rank1〜3 に返還艇が入るレースが行に無い（finish_mark・is_flying・is_late_start・refund_boats を独立の正解に）
 *  (f) 同じ run_id なら発走前と発走後で同じ行（D-6）。過去の取得結果・今の API・Storage の実体を比べる
 *  (g) 応答の gzip 後の大きさ  (h) n_returned < n_total の割合  (i) LAYER_FIRST_DATE
 *
 * 実行: node --env-file=.env.local scripts/analysis/past-rate-check/pool-contract-check.mjs
 *   PCC_WORK（取得した layer の置き場、既定 data/analysis/past-rate-check/work/pool-contract）
 *   PCC_OUT（結果 JSON、既定 data/analysis/past-rate-check/pool-contract-check.json）
 *   PCC_PRIOR（過去の取得結果の JSON を「,」区切り。1ファイル1レース or 配列。(f) に使う）
 *   PCC_SAMPLE_DAYS（既定 2026-10-06..2026-10-15）、PCC_FULL_DAY（全レースを取る日、既定 2026-10-15）
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";
import { fileURLToPath } from "url";

const ROOT = process.env.REPO_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { supabase } = await import(path.join(ROOT, "scripts/lib/supabaseClient.js"));
const { readObject, objectPath, BUCKET } = await import(path.join(ROOT, "api/_lib/analogyV16.js"));
const WORK = process.env.PCC_WORK || path.join(ROOT, "data/analysis/past-rate-check/work/pool-contract");
const OUT = process.env.PCC_OUT || path.join(ROOT, "data/analysis/past-rate-check/pool-contract-check.json");
const API = "https://www.boat-ai.jp/api/analogy/layer/";
const KB_END = "2025-12-02";
fs.mkdirSync(WORK, { recursive: true });

const dayRange = (a, b) => { const o = []; for (let d = new Date(a + "T00:00:00Z"); d <= new Date(b + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) o.push(d.toISOString().slice(0, 10)); return o; };
const [S0, S1] = (process.env.PCC_SAMPLE_DAYS || "2026-10-06..2026-10-15").split("..");
const FULL_DAY = process.env.PCC_FULL_DAY || "2026-10-15";
// 再現のための固定の乱数（mulberry32）
let seed = 20261016;
const rand = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] : null; };

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

/** API から layer を取る。ok なら WORK に保存。大きさ（JSON・gzip）を測る */
async function fetchLayer(rid) {
  for (let t = 0; ; t++) {
    try {
      const res = await fetch(API + rid);
      const text = await res.text();
      if (!res.ok) return { race_id: rid, http: res.status };
      const j = JSON.parse(text);
      const meta = { race_id: rid, status: j.status, cache: res.headers.get("cache-control"),
        bytes_json: Buffer.byteLength(text), bytes_gzip: zlib.gzipSync(text).length, fetched_at: new Date().toISOString() };
      if (j.status === "ok") fs.writeFileSync(path.join(WORK, `${rid}.json`), text);
      return { ...meta, body: j.status === "ok" ? j : null };
    } catch (e) {
      if (t === 2) return { race_id: rid, error: String(e) };
    }
  }
}
const racesOf = async (day) => (await q(() => supabase.from("races").select("race_id,start_time,cancellation_status")
  .eq("race_date", day).order("race_id"), `races ${day}`));

// ---------- (i) LAYER_FIRST_DATE ----------
async function firstDate() {
  const days = dayRange("2026-10-01", "2026-10-10");
  const out = [];
  for (const day of days) {
    const races = await racesOf(day);
    const snaps = await all(() => supabase.from("analogy_v16_snapshots").select("race_id,status")
      .eq("stage", "racecard").gte("race_id", day).lt("race_id", day + "-99"), `snap ${day}`);
    const venues = [...new Set(races.map((r) => r.race_id.slice(11, 13)))];
    // 会場ごとに 1R・12R（会場が少なければ 6R も）を最大8レース
    const pick = shuffle(venues).slice(0, 4).flatMap((v) => [`${day}-${v}-01`, `${day}-${v}-12`])
      .filter((rid) => races.some((r) => r.race_id === rid));
    const got = [];
    for (const rid of pick) { const r = await fetchLayer(rid); got.push({ race_id: rid, status: r.status ?? r.http ?? r.error }); }
    const rec = { day, races: races.length, venues: venues.length, snapshots_racecard: snaps.length,
      snapshots_ok: snaps.filter((s) => s.status === "ok").length, api: got };
    console.log("(i)", day, rec.races, rec.snapshots_racecard, got.map((g) => g.status).join(","));
    out.push(rec);
  }
  const first = out.find((d) => d.api.some((g) => g.status === "ok"));
  return { days: out, layer_first_date: first?.day ?? null };
}

// ---------- 標本の layer ----------
async function sampleLayers() {
  const metas = [];
  for (const day of dayRange(S0, S1)) {
    const races = (await racesOf(day)).filter((r) => !r.cancellation_status);
    const ids = day === FULL_DAY ? races.map((r) => r.race_id) : shuffle(races.map((r) => r.race_id)).slice(0, 6);
    for (const rid of ids) {
      const m = await fetchLayer(rid);
      metas.push(m);
    }
    console.log("sample", day, ids.length, metas.filter((m) => m.race_id.startsWith(day) && m.status === "ok").length);
  }
  return metas;
}

// ---------- (f) D-6 ----------
// status を除いて比べる（分割代入で外す）
// eslint-disable-next-line no-unused-vars
const canon = (j) => { const { status, ...rest } = j; return JSON.stringify(rest); };
async function d6(metas) {
  const prior = (process.env.PCC_PRIOR || "").split(",").filter(Boolean).flatMap((f) => {
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    const st = fs.statSync(f);
    // 取得時刻はファイルの更新時刻（1ファイル1レースのとき正確。配列のファイルは書き出しの時刻＝全件の取得後）
    return (Array.isArray(j) ? j : [j]).filter((x) => x.status === "ok").map((x) => ({ body: x, file: f, mtime: st.mtime.toISOString() }));
  });
  const res = [];
  for (const { body: p, file: _file, mtime: _mtime } of prior) {
    const race = (await q(() => supabase.from("races").select("race_date,start_time").eq("race_id", p.race_id), "race"))[0];
    const deadline = race?.start_time ? new Date(`${race.race_date}T${race.start_time}+09:00`).toISOString() : null;
    const snap = (await q(() => supabase.from("analogy_v16_snapshots").select("run_id,computed_at")
      .eq("race_id", p.race_id).eq("stage", "racecard"), "snap"))[0];
    const now = await fetchLayer(p.race_id);
    const storage = snap ? await readObject(objectPath(p.race_id, snap.run_id, "layer", p.race_id)) : null;
    res.push({
      race_id: p.race_id, prior_file: path.basename(_file), prior_fetched_at: _mtime, deadline,
      prior_before_deadline: deadline ? _mtime < deadline : null,
      run_prior: p.run_id, run_now: now.body?.run_id ?? now.status, run_snapshot: snap?.run_id ?? null,
      same_run: p.run_id === now.body?.run_id,
      prior_eq_now: now.body ? canon(p) === canon(now.body) : null,
      now_eq_storage: now.body && storage ? canon(now.body) === JSON.stringify(Object.fromEntries(Object.entries(storage).filter(([k]) => k !== "status"))) : null,
      n_rows: p.rows?.length,
    });
  }
  // 今回の標本でも、API の応答と Storage の実体を直接比べる（最大30レース）
  const direct = [];
  for (const m of metas.filter((x) => x.status === "ok").slice(0, 30)) {
    const st = await readObject(objectPath(m.race_id, m.body.run_id, "layer", m.race_id));
    direct.push({ race_id: m.race_id, eq: !!st && canon(m.body) === JSON.stringify(Object.fromEntries(Object.entries(st).filter(([k]) => k !== "status"))) });
  }
  // 同じレースの layer が複数の run_id に置かれていないか（Storage の一覧。読み取り）
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL).replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_KEY;
  const list = async (prefix) => {
    const r = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, { method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: 1000, offset: 0 }) });
    if (!r.ok) throw new Error(`list ${prefix}: HTTP ${r.status}`);
    return r.json();
  };
  const multi = [];
  for (const day of dayRange(S0, S1)) {
    const runs = (await list(`${day}/`)).map((o) => o.name).filter((n) => !n.startsWith("exh-"));
    const byRace = {};
    for (const run of runs) {
      const files = [];
      for (let off = 0; ; off += 1000) {
        const r = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, { method: "POST",
          headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ prefix: `${day}/${run}/layer/`, limit: 1000, offset: off }) });
        const d = await r.json();
        files.push(...d);
        if (d.length < 1000) break;
      }
      for (const f of files) (byRace[f.name] ||= []).push(run);
    }
    const dup = Object.entries(byRace).filter(([, v]) => v.length > 1);
    // 作り直されたレース: 古い run と新しい run の layer の行が同じか（run_id が変わっても行が変わらないか）
    let rowsEq = 0, restEq = 0; const changed = [];
    for (const [name, rs] of dup) {
      const rid = name.replace(".json.gz", "");
      const [x, y] = await Promise.all(rs.slice(0, 2).map((run) => readObject(objectPath(rid, run, "layer", rid))));
      // run_id・status を除いて比べる
      // eslint-disable-next-line no-unused-vars
      const strip = ({ run_id, status, ...o }) => JSON.stringify(o);
      if (JSON.stringify(x.rows) === JSON.stringify(y.rows)) rowsEq++; else changed.push(rid);
      if (strip(x) === strip(y)) restEq++;
    }
    const snaps = await all(() => supabase.from("analogy_v16_snapshots").select("race_id,run_id,computed_at").eq("stage", "racecard")
      .gte("race_id", day).lt("race_id", day + "-99"), "snap runs");
    const snapRuns = snaps.reduce((o, x) => ((o[x.run_id] = (o[x.run_id] || 0) + 1), o), {});
    multi.push({ day, runs: runs.length, run_ids: runs, races_with_layer: Object.keys(byRace).length, races_in_2plus_runs: dup.length,
      rebuilt_rows_equal: rowsEq, rebuilt_all_but_run_id_equal: restEq, rebuilt_rows_changed: changed, snapshot_runs: snapRuns });
    console.log("(f) storage", day, runs.length, Object.keys(byRace).length, dup.length);
  }
  return { prior_vs_now: res, api_vs_storage: { n: direct.length, equal: direct.filter((d) => d.eq).length, diffs: direct.filter((d) => !d.eq) },
    storage_runs: multi };
}

// ---------- (a)〜(e) ----------
async function rowChecks(metas) {
  const U = new Map(); const conflict = [];
  let leak = 0, orderBad = 0, nMismatch = 0;
  for (const m of metas.filter((x) => x.status === "ok")) {
    const j = m.body;
    if (j.rows.length !== j.n_returned || j.n_returned > j.n_total) nMismatch++;
    for (let i = 0; i < j.rows.length; i++) {
      const r = j.rows[i];
      if (r.race_date > j.pool_cutoff || r.race_date >= j.race_id.slice(0, 10)) leak++;
      if (i && (r.race_date > j.rows[i - 1].race_date || (r.race_date === j.rows[i - 1].race_date && r.race_id > j.rows[i - 1].race_id))) orderBad++;
      const s = JSON.stringify(r);
      if (U.has(r.race_id) && U.get(r.race_id).s !== s) conflict.push({ race_id: r.race_id, a: U.get(r.race_id).from, b: j.race_id });
      if (!U.has(r.race_id)) U.set(r.race_id, { s, r, from: j.race_id });
    }
  }
  const rows = [...U.values()].map((v) => v.r);
  const M = rows.filter((r) => r.race_date > KB_END), A = rows.filter((r) => r.race_date <= KB_END);
  console.log("union rows", rows.length, "main", M.length, "archive", A.length);
  const mainIds = M.map((r) => r.race_id), arcIds = A.map((r) => r.race_id);

  // 本体: race_results（全件）
  const RR = new Map();
  for (const c of chunks(mainIds, 200)) for (const x of await q(() => supabase.from("race_results")
    .select("race_id,rank1,rank2,rank3,payout_trio,payout_trifecta,is_cancelled,is_no_race,race_status,refund_boats,actual_course_1,actual_course_2,actual_course_3,actual_course_4,actual_course_5,actual_course_6")
    .in("race_id", c), "rr")) RR.set(x.race_id, x);
  const minMain = mainIds.reduce((a, b) => (a < b ? a : b), "9"), maxMain = mainIds.reduce((a, b) => (a > b ? a : b), "0");
  // 返還・F・出遅れの艇（条件で引く。期間は標本の行の範囲）
  const stBad = await all(() => supabase.from("race_start_timings").select("race_id,boat_number,start_timing,is_flying,is_late_start,finish_mark")
    .gte("race_id", minMain.slice(0, 10)).lte("race_id", maxMain.slice(0, 10) + "-99")
    .or("is_flying.eq.true,is_late_start.eq.true,finish_mark.in.(F,L,欠)").order("race_id").order("boat_number"), "st bad");
  const cancelled = new Set((await all(() => supabase.from("races").select("race_id").not("cancellation_status", "is", null)
    .gte("race_id", minMain.slice(0, 10)).lte("race_id", maxMain.slice(0, 10) + "-99").order("race_id"), "cancel")).map((x) => x.race_id));

  // 長期: kb_archive_races（全件）・kb_archive_boats（返還・欠けた進入）
  const KR = new Map();
  for (const c of chunks(arcIds, 200)) for (const x of await q(() => supabase.from("kb_archive_races")
    .select("race_id,has_result,payout_3tan,payout_3fuku").in("race_id", c), "kr")) KR.set(x.race_id, x);
  const KB = new Map(); // race_id -> boats（返還判定・進入・ST）
  const arcSample = shuffle(arcIds).slice(0, 3000);
  for (const c of chunks(arcSample, 150)) for (const x of await q(() => supabase.from("kb_archive_boats")
    .select("race_id,boat_number,course,start_timing,is_flying,is_late_start,finish_raw").in("race_id", c), "kb")) (KB.get(x.race_id) || KB.set(x.race_id, []).get(x.race_id)).push(x);

  const byId = new Map(rows.map((r) => [r.race_id, r]));
  // (a)
  const aMainS = shuffle(M).slice(0, 100), aArcS = shuffle(A).slice(0, 100);
  const aEval = (list, get, tan, fuku) => {
    let eqTan = 0, eqFuku = 0, bothNull = 0, nullLayerOnly = 0, missing = 0; const bad = [];
    for (const r of list) {
      const d = get(r.race_id); if (!d) { missing++; continue; }
      const t = d[tan] == null ? null : Number(d[tan]), f = d[fuku] == null ? null : Number(d[fuku]);
      if (r.payout_3tan === t) { if (t == null) bothNull++; else eqTan++; } else { if (r.payout_3tan == null) nullLayerOnly++; bad.push({ race_id: r.race_id, layer: r.payout_3tan, tan: t, fuku: f }); }
      if (r.payout_3tan != null && r.payout_3tan === f) eqFuku++;
    }
    return { n: list.length, eq_3tan: eqTan, both_null: bothNull, mismatch: bad.length, layer_null_db_value: nullLayerOnly, eq_3fuku: eqFuku, missing_in_db: missing, mismatch_examples: bad.slice(0, 10) };
  };
  const a = {
    main_random100: aEval(aMainS, (id) => RR.get(id), "payout_trio", "payout_trifecta"),
    main_all: aEval(M, (id) => RR.get(id), "payout_trio", "payout_trifecta"),
    archive_random100: aEval(aArcS, (id) => KR.get(id), "payout_3tan", "payout_3fuku"),
    archive_all: aEval(A, (id) => KR.get(id), "payout_3tan", "payout_3fuku"),
    layer_null_payout: { main: M.filter((r) => r.payout_3tan == null).length, archive: A.filter((r) => r.payout_3tan == null).length },
  };

  // (b) 本体: F・出遅れ・欠の艇。コースは DB の実進入（無ければ layer の course_by_boat）
  const bRes = { checked: 0, ok: 0, violations: [], no_course: 0 };
  for (const s of stBad) {
    const r = byId.get(s.race_id); if (!r) continue;
    const d = RR.get(s.race_id);
    const c = d?.[`actual_course_${s.boat_number}`] ?? r.course_by_boat?.[s.boat_number - 1];
    if (!c) { bRes.no_course++; if ((r.st_by_course || []).some((v) => v != null && s.start_timing != null && Math.abs(v - Number(s.start_timing)) < 1e-9 && v < 0)) bRes.violations.push({ race_id: s.race_id, boat: s.boat_number, why: "コース不明で負の ST" }); continue; }
    bRes.checked++;
    const v = r.st_by_course?.[c - 1];
    if (v == null) bRes.ok++; else bRes.violations.push({ race_id: s.race_id, boat: s.boat_number, course: c, st: v, flag: { f: s.is_flying, l: s.is_late_start, m: s.finish_mark } });
  }
  // 長期（標本 3,000 レース）
  const bArc = { checked: 0, ok: 0, violations: [] };
  for (const [rid, boats] of KB) {
    const r = byId.get(rid);
    for (const b of boats) {
      if (!(b.is_flying || b.is_late_start || ["F", "L0", "L1"].includes(b.finish_raw))) continue;
      const c = b.course ?? r.course_by_boat?.[b.boat_number - 1]; if (!c || c < 1 || c > 6) continue;
      bArc.checked++;
      if (r.st_by_course?.[c - 1] == null) bArc.ok++; else bArc.violations.push({ race_id: rid, boat: b.boat_number, course: c, st: r.st_by_course[c - 1] });
    }
  }
  const negST = rows.filter((r) => (r.st_by_course || []).some((v) => v != null && v < 0)).length;

  // (c)
  const cMain = M.filter((r) => { const d = RR.get(r.race_id); return cancelled.has(r.race_id) || !d || d.rank1 == null || d.is_cancelled || d.is_no_race || d.race_status === "no_race"; })
    .map((r) => ({ race_id: r.race_id, rr: RR.get(r.race_id) ? { rank1: RR.get(r.race_id).rank1, is_cancelled: RR.get(r.race_id).is_cancelled, is_no_race: RR.get(r.race_id).is_no_race, race_status: RR.get(r.race_id).race_status } : null, cancelled: cancelled.has(r.race_id) }));
  const cArc = A.filter((r) => { const d = KR.get(r.race_id); return !d || !d.has_result; }).map((r) => r.race_id);
  const statusCounts = {}; for (const r of M) { const s = RR.get(r.race_id)?.race_status ?? "null"; statusCounts[s] = (statusCounts[s] || 0) + 1; }

  // (d) 本体: course_by_boat と DB の actual_course を艇ごとに照合
  const d = { main: { rows: 0, db_all_null: 0, db_all_null_layer_filled: 0, layer_eq_db: 0, layer_null_db_value: 0, layer_value_db_null: 0, layer_ne_db: 0, examples: [] },
    archive_sample: { rows: 0, layer_eq_db: 0, layer_null_db_null: 0, layer_value_db_null: 0, layer_ne_db: 0, examples: [] } };
  for (const r of M) {
    const x = RR.get(r.race_id); if (!x) continue;
    d.main.rows++;
    const db = [1, 2, 3, 4, 5, 6].map((b) => { const v = x[`actual_course_${b}`]; return v == null || v < 1 || v > 6 ? null : Number(v); });
    if (db.every((v) => v == null)) { d.main.db_all_null++; if ((r.course_by_boat || []).some((v) => v != null)) { d.main.db_all_null_layer_filled++; d.main.examples.push({ race_id: r.race_id, layer: r.course_by_boat, db }); } }
    for (let b = 0; b < 6; b++) {
      const l = r.course_by_boat?.[b] ?? null, v = db[b];
      if (l === v) d.main.layer_eq_db++; else if (l == null) d.main.layer_null_db_value++; else if (v == null) { d.main.layer_value_db_null++; if (d.main.examples.length < 10) d.main.examples.push({ race_id: r.race_id, boat: b + 1, layer: l, db: null }); } else { d.main.layer_ne_db++; if (d.main.examples.length < 10) d.main.examples.push({ race_id: r.race_id, boat: b + 1, layer: l, db: v }); }
    }
  }
  const layerNullRows = M.filter((r) => (r.course_by_boat || []).some((v) => v == null));
  d.main.layer_rows_with_null = layerNullRows.length;
  d.main.layer_rows_with_null_by_month = layerNullRows.reduce((o, r) => ((o[r.race_date.slice(0, 7)] = (o[r.race_date.slice(0, 7)] || 0) + 1), o), {});
  for (const [rid, boats] of KB) {
    const r = byId.get(rid); d.archive_sample.rows++;
    for (const b of boats) {
      const l = r.course_by_boat?.[b.boat_number - 1] ?? null, v = b.course == null || b.course < 1 || b.course > 6 ? null : Number(b.course);
      if (l === v) { if (l == null) d.archive_sample.layer_null_db_null++; else d.archive_sample.layer_eq_db++; } else if (v == null) { d.archive_sample.layer_value_db_null++; d.archive_sample.examples.length < 10 && d.archive_sample.examples.push({ race_id: rid, boat: b.boat_number, layer: l, db: v }); } else { d.archive_sample.layer_ne_db++; d.archive_sample.examples.length < 10 && d.archive_sample.examples.push({ race_id: rid, boat: b.boat_number, layer: l, db: v }); }
    }
  }

  // (e) 本体: 1〜3着の艇が返還（refund_boats・finish_mark F/L/欠・is_flying・is_late_start）
  const bad = new Map(); for (const s of stBad) (bad.get(s.race_id) || bad.set(s.race_id, new Set()).get(s.race_id)).add(s.boat_number);
  const e = { main: { rows: 0, violations: [], rank_ne_db: 0, rank_ne_examples: [], races_with_refund_in_pool_period: 0 }, archive_sample: { rows: 0, violations: [] } };
  for (const r of M) {
    const x = RR.get(r.race_id); if (!x) continue; e.main.rows++;
    let rb = []; try { rb = Array.isArray(x.refund_boats) ? x.refund_boats : JSON.parse(x.refund_boats || "[]"); } catch { rb = []; }
    if (rb.length) e.main.races_with_refund_in_pool_period++;
    const top = [r.rank1, r.rank2, r.rank3];
    const hit = top.filter((b) => rb.map(Number).includes(b) || bad.get(r.race_id)?.has(b));
    if (hit.length) e.main.violations.push({ race_id: r.race_id, top, refund_boats: rb, flagged: [...(bad.get(r.race_id) || [])] });
    if (x.rank1 !== r.rank1 || x.rank2 !== r.rank2 || x.rank3 !== r.rank3) { e.main.rank_ne_db++; e.main.rank_ne_examples.length < 10 && e.main.rank_ne_examples.push({ race_id: r.race_id, layer: top, db: [x.rank1, x.rank2, x.rank3] }); }
  }
  for (const [rid, boats] of KB) {
    const r = byId.get(rid); e.archive_sample.rows++;
    const ret = new Set(boats.filter((b) => b.is_flying || b.is_late_start || ["F", "L0", "L1"].includes(b.finish_raw)).map((b) => b.boat_number));
    if ([r.rank1, r.rank2, r.rank3].some((b) => ret.has(b))) e.archive_sample.violations.push({ race_id: rid, top: [r.rank1, r.rank2, r.rank3], returned: [...ret] });
  }
  // 返還を含むレース（1〜3着の外の返還）が行に残っていること（除きすぎていないか）
  e.main.rows_with_refund_outside_top3 = M.filter((r) => bad.has(r.race_id)).length;

  return {
    union: { rows: rows.length, main: M.length, archive: A.length, main_range: [minMain, maxMain],
      same_race_different_row_across_layers: conflict.length, conflict_examples: conflict.slice(0, 10),
      rows_after_cutoff_or_race_day: leak, order_violations: orderBad, layers_n_mismatch: nMismatch },
    a, b: { main: { ...bRes, violations_n: bRes.violations.length, violations: bRes.violations.slice(0, 20), st_bad_boats_in_period: stBad.length },
      archive_sample: { ...bArc, violations_n: bArc.violations.length, violations: bArc.violations.slice(0, 20) }, rows_with_negative_st: negST },
    c: { main_violations: cMain.length, main_examples: cMain.slice(0, 20), archive_violations: cArc.length, archive_examples: cArc.slice(0, 20), main_race_status: statusCounts, cancelled_in_period: cancelled.size },
    d, e: { main: { ...e.main, violations_n: e.main.violations.length, violations: e.main.violations.slice(0, 20) }, archive_sample: { ...e.archive_sample, violations_n: e.archive_sample.violations.length, violations: e.archive_sample.violations.slice(0, 20) } },
  };
}

// ---------- (g)(h) ----------
async function sizeAndTrunc(metas) {
  const ok = metas.filter((m) => m.status === "ok");
  const full = ok.filter((m) => m.race_id.startsWith(FULL_DAY));
  const g = (list) => ({ n: list.length, gzip_median: pct(list.map((m) => m.bytes_gzip), 0.5), gzip_p90: pct(list.map((m) => m.bytes_gzip), 0.9),
    gzip_max: Math.max(...list.map((m) => m.bytes_gzip)), json_max: Math.max(...list.map((m) => m.bytes_json)),
    over_50kb: list.filter((m) => m.bytes_gzip > 50 * 1024).length,
    max_race: list.reduce((a, b) => (b.bytes_gzip > (a?.bytes_gzip ?? -1) ? b : a), null)?.race_id });
  const h = (list) => ({ n: list.length, truncated: list.filter((m) => m.body.n_returned < m.body.n_total).length,
    share: list.length ? list.filter((m) => m.body.n_returned < m.body.n_total).length / list.length : null,
    n_total_median: pct(list.map((m) => m.body.n_total), 0.5), n_total_p90: pct(list.map((m) => m.body.n_total), 0.9),
    n_returned_lt_2000: list.filter((m) => m.body.n_returned < 2000).length,
    n_returned_lt_200: list.filter((m) => m.body.n_returned < 200).length });
  // 実際の転送量（Accept-Encoding: gzip のまま受けた大きさ）。gzip の大きい順に5レース
  const wire = [];
  for (const m of [...ok].sort((x, y) => y.bytes_gzip - x.bytes_gzip).slice(0, 5)) {
    const { execFileSync } = await import("child_process");
    const out = execFileSync("curl", ["-s", "-o", "/dev/null", "-H", "Accept-Encoding: gzip", "-w", "%{size_download} %{content_type}", API + m.race_id]).toString();
    const enc = execFileSync("curl", ["-s", "-D", "-", "-o", "/dev/null", "-H", "Accept-Encoding: gzip", API + m.race_id]).toString().match(/content-encoding:\s*(\S+)/i)?.[1] ?? null;
    wire.push({ race_id: m.race_id, bytes_gzip_local: m.bytes_gzip, size_download: Number(out.split(" ")[0]), content_encoding: enc });
  }
  // snapshot の n_layer（全レース）: 2,000件を超える割合（n_total と一致しないことがある数。参考）
  const snaps = await all(() => supabase.from("analogy_v16_snapshots").select("race_id,n_layer,status").eq("stage", "racecard")
    .gte("race_id", S0).lte("race_id", S1 + "-99").order("race_id"), "snaps");
  const sOk = snaps.filter((s) => s.status === "ok");
  const statusMix = {}; for (const m of metas) { const s = m.status ?? m.http ?? "error"; statusMix[s] = (statusMix[s] || 0) + 1; }
  const nTotalVsLayer = ok.map((m) => ({ id: m.race_id, nt: m.body.n_total, nl: sOk.find((s) => s.race_id === m.race_id)?.n_layer })).filter((x) => x.nl != null);
  return {
    fetched: metas.length, status_mix: statusMix,
    g: { sample_all: g(ok), full_day: g(full), wire },
    h: { sample_all: h(ok), full_day: h(full),
      snapshots_n_layer: { n: sOk.length, over_2000: sOk.filter((s) => s.n_layer > 2000).length, share: sOk.filter((s) => s.n_layer > 2000).length / sOk.length },
      n_total_ne_n_layer: nTotalVsLayer.filter((x) => x.nt !== x.nl).length, n_total_vs_layer_n: nTotalVsLayer.length },
  };
}

const started = new Date().toISOString();
const i = await firstDate();
const metas = await sampleLayers();
const gh = await sizeAndTrunc(metas);
const f = await d6(metas);
const ae = await rowChecks(metas);
// 次回の (f) 用: レースごとの run_id と応答（status を除く）の sha256。次の実行で同じ run_id なら同じ値になるはず
const digests = Object.fromEntries(metas.filter((m) => m.status === "ok").map((m) => [m.race_id,
  { run_id: m.body.run_id, fetched_at: m.fetched_at, sha256: crypto.createHash("sha256").update(canon(m.body)).digest("hex") }]));
const result = { generated_at: started, finished_at: new Date().toISOString(), api: API, sample_days: [S0, S1], full_day: FULL_DAY, seed: 20261016,
  i, ...gh, f, ...ae, digests };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
console.log("wrote", OUT);
