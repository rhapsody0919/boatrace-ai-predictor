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
import { internalApiHeaders } from "../../../api/_lib/internalApiHeaders.js";
import {
  ROOT,
  supabase,
  shuffle,
  q,
  all,
  rowChecks,
} from "./poolContractRowChecks.mjs";

const { readObject, objectPath, BUCKET } = await import(path.join(ROOT, "api/_lib/analogyV16.js"));
const WORK = process.env.PCC_WORK || path.join(ROOT, "data/analysis/past-rate-check/work/pool-contract");
const OUT = process.env.PCC_OUT || path.join(ROOT, "data/analysis/past-rate-check/pool-contract-check.json");
const API = "https://www.boat-ai.jp/api/analogy/layer/";

fs.mkdirSync(WORK, { recursive: true });

const dayRange = (a, b) => { const o = []; for (let d = new Date(a + "T00:00:00Z"); d <= new Date(b + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) o.push(d.toISOString().slice(0, 10)); return o; };
const [S0, S1] = (process.env.PCC_SAMPLE_DAYS || "2026-10-06..2026-10-15").split("..");
const FULL_DAY = process.env.PCC_FULL_DAY || "2026-10-15";

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] : null; };

/** API から layer を取る。ok なら WORK に保存。大きさ（JSON・gzip）を測る */
async function fetchLayer(rid) {
  for (let t = 0; ; t++) {
    try {
      // 合言葉（BOA-1110 段階1）。node --env-file=.env.local で INTERNAL_API_KEY を読む。無ければ付けない
      const res = await fetch(API + rid, { headers: internalApiHeaders("analysis") });
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
const canon = (j) => { const { status, ...rest } = j; return JSON.stringify(rest); };
// Storage の実体（status を除く）の JSON
const canonStorage = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => k !== "status")));
// run_id・status を除いて比べる
const stripRunStatus = ({ run_id, status, ...o }) => JSON.stringify(o);

/** PCC_PRIOR の過去の取得結果から status ok の物を読む */
function loadPrior() {
  return (process.env.PCC_PRIOR || "").split(",").filter(Boolean).flatMap((f) => {
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    const st = fs.statSync(f);
    // 取得時刻はファイルの更新時刻（1ファイル1レースのとき正確。配列のファイルは書き出しの時刻＝全件の取得後）
    return (Array.isArray(j) ? j : [j]).filter((x) => x.status === "ok").map((x) => ({ body: x, file: f, mtime: st.mtime.toISOString() }));
  });
}

const deadlineOf = (race) => (race?.start_time ? new Date(`${race.race_date}T${race.start_time}+09:00`).toISOString() : null);
const eqStorage = (body, storage) => (body && storage ? canon(body) === canonStorage(storage) : null);

/** 過去の取得結果1件を、今の API・snapshot・Storage の実体と比べる */
async function priorVsNowOne({ body: p, file: _file, mtime: _mtime }) {
  const race = (await q(() => supabase.from("races").select("race_date,start_time").eq("race_id", p.race_id), "race"))[0];
  const deadline = deadlineOf(race);
  const snap = (await q(() => supabase.from("analogy_v16_snapshots").select("run_id,computed_at")
    .eq("race_id", p.race_id).eq("stage", "racecard"), "snap"))[0];
  const now = await fetchLayer(p.race_id);
  const storage = snap ? await readObject(objectPath(p.race_id, snap.run_id, "layer", p.race_id)) : null;
  return {
    race_id: p.race_id, prior_file: path.basename(_file), prior_fetched_at: _mtime, deadline,
    prior_before_deadline: deadline ? _mtime < deadline : null,
    run_prior: p.run_id, run_now: now.body?.run_id ?? now.status, run_snapshot: snap?.run_id ?? null,
    same_run: p.run_id === now.body?.run_id,
    prior_eq_now: now.body ? canon(p) === canon(now.body) : null,
    now_eq_storage: eqStorage(now.body, storage),
    n_rows: p.rows?.length,
  };
}

/** 今回の標本でも、API の応答と Storage の実体を直接比べる（最大30レース） */
async function apiVsStorageDirect(metas) {
  const direct = [];
  for (const m of metas.filter((x) => x.status === "ok").slice(0, 30)) {
    const st = await readObject(objectPath(m.race_id, m.body.run_id, "layer", m.race_id));
    direct.push({ race_id: m.race_id, eq: !!st && canon(m.body) === canonStorage(st) });
  }
  return direct;
}

/** Storage の list の1ページ（読み取り）。応答をそのまま返す */
const storageListPage = (url, key, prefix, offset) => fetch(`${url}/storage/v1/object/list/${BUCKET}`, { method: "POST",
  headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({ prefix, limit: 1000, offset }) });

async function storageList(url, key, prefix) {
  const r = await storageListPage(url, key, prefix, 0);
  if (!r.ok) throw new Error(`list ${prefix}: HTTP ${r.status}`);
  return r.json();
}

/** 1つの run の layer のファイル一覧（1000件ずつ） */
async function layerFilesOfRun(url, key, day, run) {
  const files = [];
  for (let off = 0; ; off += 1000) {
    const r = await storageListPage(url, key, `${day}/${run}/layer/`, off);
    const d = await r.json();
    files.push(...d);
    if (d.length < 1000) break;
  }
  return files;
}

/** ファイル名（レース）ごとに、それを置いている run の一覧 */
async function runsByRace(url, key, day, runs) {
  const byRace = {};
  for (const run of runs) {
    const files = await layerFilesOfRun(url, key, day, run);
    for (const f of files) (byRace[f.name] ||= []).push(run);
  }
  return byRace;
}

/** 作り直されたレース: 古い run と新しい run の layer の行が同じか（run_id が変わっても行が変わらないか） */
async function rebuiltEquality(dup) {
  let rowsEq = 0, restEq = 0; const changed = [];
  for (const [name, rs] of dup) {
    const rid = name.replace(".json.gz", "");
    const [x, y] = await Promise.all(rs.slice(0, 2).map((run) => readObject(objectPath(rid, run, "layer", rid))));
    if (JSON.stringify(x.rows) === JSON.stringify(y.rows)) rowsEq++; else changed.push(rid);
    if (stripRunStatus(x) === stripRunStatus(y)) restEq++;
  }
  return { rowsEq, restEq, changed };
}

/** その日の racecard の snapshot を run_id ごとに数える */
async function snapshotRunCounts(day) {
  const snaps = await all(() => supabase.from("analogy_v16_snapshots").select("race_id,run_id,computed_at").eq("stage", "racecard")
    .gte("race_id", day).lt("race_id", day + "-99"), "snap runs");
  return snaps.reduce((o, x) => ((o[x.run_id] = (o[x.run_id] || 0) + 1), o), {});
}

/** 同じレースの layer が複数の run_id に置かれていないか（1日分） */
async function storageRunsOfDay(url, key, day) {
  const runs = (await storageList(url, key, `${day}/`)).map((o) => o.name).filter((n) => !n.startsWith("exh-"));
  const byRace = await runsByRace(url, key, day, runs);
  const dup = Object.entries(byRace).filter(([, v]) => v.length > 1);
  const { rowsEq, restEq, changed } = await rebuiltEquality(dup);
  const snapRuns = await snapshotRunCounts(day);
  console.log("(f) storage", day, runs.length, Object.keys(byRace).length, dup.length);
  return { day, runs: runs.length, run_ids: runs, races_with_layer: Object.keys(byRace).length, races_in_2plus_runs: dup.length,
    rebuilt_rows_equal: rowsEq, rebuilt_all_but_run_id_equal: restEq, rebuilt_rows_changed: changed, snapshot_runs: snapRuns };
}

async function d6(metas) {
  const prior = loadPrior();
  const res = [];
  for (const x of prior) res.push(await priorVsNowOne(x));
  const direct = await apiVsStorageDirect(metas);
  // 同じレースの layer が複数の run_id に置かれていないか（Storage の一覧。読み取り）
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL).replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_KEY;
  const multi = [];
  for (const day of dayRange(S0, S1)) multi.push(await storageRunsOfDay(url, key, day));
  return { prior_vs_now: res, api_vs_storage: { n: direct.length, equal: direct.filter((d) => d.eq).length, diffs: direct.filter((d) => !d.eq) },
    storage_runs: multi };
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
