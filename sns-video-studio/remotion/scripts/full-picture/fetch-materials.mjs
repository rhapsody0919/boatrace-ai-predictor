/**
 * 全貌動画の材料 JSON を1つ作る（龍神側。毎日の実行で鍵が要るのはここだけ）。
 * 公開 API（https://www.boat-ai.jp/api/...）の応答を、場面の作り手が使う形でそのまま1つにまとめる。計算はしない
 * （計算は場面ごとの build が画面と同じ関数で行う）。取れなかった材料は missing に記録し、全体は止めない。
 *
 * 使い方: node scripts/full-picture/fetch-materials.mjs <raceId> <出力.json> [--stage racecard|exhibition] [--from-case <dir>]
 *   --from-case: 撮影済みの全貌の case（~/full-picture/cases/{raceId}）の analysis/source から facts・similar・scenario を使う
 *   （試作で、撮影した画面と同じ時点の材料にそろえるため）
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";

export const MATERIALS_VERSION = "full-picture-materials/1";
const BASE = process.env.FULL_PICTURE_API_BASE ?? "https://www.boat-ai.jp";
const VENUES = Array.from({ length: 24 }, (_, i) => i + 1);
/** 材料の無い応答の status（api/_lib/analogyV16.js の resolveStatus・similar の empty_layer） */
export const NO_DATA = ["not_saved", "absent", "empty_layer"];

// Supabase の匿名読み取り（画面と同じ公開キー。書き込みはしない）。画面が API を通さずに読む場面（3 軸・6 機力）の材料
// 環境変数は呼ぶときに読む（daily.mjs は読み込んだ後に .env.local の匿名キーを入れる）
async function sbGet(table, query) {
  const SB_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const SB_KEY = process.env.VITE_SUPABASE_ANON_KEY;
  if (!SB_URL || !SB_KEY) throw new Error("Supabase の URL・匿名キーが無い（VITE_SUPABASE_URL・VITE_SUPABASE_ANON_KEY）");
  const out = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
      signal: AbortSignal.timeout(30000),
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Range: `${from}-${from + 999}` },
    });
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}
async function sbIn(table, select, col, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const list = ids.slice(i, i + 100).map((x) => `"${x}"`).join(",");
    out.push(...(await sbGet(table, `select=${select}&${col}=in.(${encodeURIComponent(list)})`)));
  }
  return out;
}
const daysBefore = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

/**
 * 1号艇の選手の成績の元（選手ページ「会場別成績」730日・「枠番別回収率」180日と同じ表・列）。
 * 画面は見た日から数えるが、ここはレースの日から数え、このレースより前の走だけにする（同じ材料なら同じ値）
 */
async function racerRows(racerId, raceId, date) {
  const entries = await sbGet(
    "race_entries",
    `select=race_id,boat_number&racer_id=eq.${racerId}&and=(race_id.gte.${daysBefore(date, 730)},race_id.lt.${raceId})`,
  );
  const ids = [...new Set(entries.map((e) => e.race_id))];
  const [races, results, st] = await Promise.all([
    sbIn("races", "race_id,venue_code,race_grade", "race_id", ids),
    sbIn("race_results", "race_id,rank1,rank2,rank3,payout_win,payout_place_1,payout_place_2,race_status", "race_id", ids),
    sbIn("race_start_timings", "race_id,boat_number,finish_mark", "race_id", ids),
  ]);
  return { racerId, entries, races, results, st: st.filter((r) => entries.some((e) => e.race_id === r.race_id && e.boat_number === r.boat_number)) };
}

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

/** 撮影済みの case の source（{url, data} の包み）から応答を取り出す */
function fromCase(dir, name) {
  const p = join(dir, "analysis", "source", `${name}.json`);
  if (!existsSync(p)) return null;
  const j = JSON.parse(readFileSync(p, "utf8"));
  return j.data ?? j;
}

/**
 * @param {string} raceId 例 2026-10-19-19-10
 * @param {{stage?: string, caseDir?: string|null}} opts
 */
export async function fetchMaterials(raceId, { stage = "racecard", caseDir = null } = {}) {
  const [y, m, d, venue] = raceId.split("-");
  const date = `${y}-${m}-${d}`;
  const missing = [];
  const api = {};
  const take = async (key, path, caseName = null) => {
    try {
      const seeded = caseDir && caseName ? fromCase(caseDir, caseName) : null;
      const got = seeded ?? (await getJson(path));
      // 材料の無い応答（保存前・対象外・類似レースの層が空）は null にして missing に記録する（契約の形にしない）
      if (NO_DATA.includes(got?.status)) {
        api[key] = null;
        missing.push({ source: key, reason: `応答の status が ${got.status}` });
      } else api[key] = got;
    } catch (e) {
      api[key] = null;
      missing.push({ source: key, reason: e instanceof Error ? e.message : String(e) });
    }
  };
  await take("facts", `/api/analogy/facts/${raceId}?stage=${stage}&include=racers`, "facts");
  await take("similar", `/api/analogy/similar/${raceId}?stage=${stage}`, "similar");
  await take("scenario", `/api/analogy/scenario/${raceId}?stage=${stage}&boats=1`, "scenario");
  // 範囲キー（思考アシストの「級の並びが同じ」「全国」、相手の下段の「会場」）は facts の today.scope_keys["1"]
  const keys = api.facts?.today?.scope_keys?.["1"] ?? {};
  for (const [k, scope] of [["scenarioNC", keys.NC], ["scenarioNCR", keys.NCR], ["scenarioNA", keys.NA], ["scenarioVA", keys.VA]]) {
    if (!scope) {
      missing.push({ source: k, reason: "facts に範囲キーが無い" });
      continue;
    }
    const caseName = k === "scenarioNA" ? "national" : k === "scenarioVA" ? "venue" : null;
    await take(k, `/api/analogy/scenario/${raceId}?stage=${stage}&scope=${encodeURIComponent(scope)}`, caseName);
  }
  // 出走表・気象・同じ日の結果（この日の水面傾向）。同じ会場の分だけ残す
  try {
    // 撮影済みの case の schedule には結果が入っていない版があるので、ここは常に API から取る
    const pred = await getJson(`/api/predictions/${date}`);
    api.races = (pred.races ?? []).filter((r) => String(r.venueCode).padStart(2, "0") === venue);
    if (!api.races.some((r) => r.raceId === raceId)) missing.push({ source: "races", reason: "出走表にこのレースが無い" });
  } catch (e) {
    api.races = null;
    missing.push({ source: "races", reason: e instanceof Error ? e.message : String(e) });
  }
  // 会場の過去90日（コース別1着率・枠番別の連対率）。全国平均は24会場の合計（画面の getNationalAverageOutcomeDistribution と同じ値）
  api.outcome = {};
  for (const v of VENUES) {
    try {
      api.outcome[v] = await getJson(`/api/outcome-distribution?venue_code=${v}`);
    } catch (e) {
      api.outcome[v] = null;
      missing.push({ source: `outcome.${v}`, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  // Supabase（匿名読み取り）
  const db = {};
  const race = api.races?.find((r) => r.raceId === raceId);
  const racer1 = race?.entries?.find((e) => e.number === 1)?.racerId;
  try {
    db.racer1 = racer1 ? await racerRows(racer1, raceId, date) : null;
    if (!racer1) missing.push({ source: "db.racer1", reason: "出走表に1号艇の選手が無い" });
  } catch (e) {
    db.racer1 = null;
    missing.push({ source: "db.racer1", reason: e instanceof Error ? e.message : String(e) });
  }
  // モーター（場面6）: 前検（この節）・会場のモーター成績（このレースの日より前の最新）・今節の展示タイム（6選手、このレースより前）
  try {
    const motors = (race?.entries ?? []).map((e) => e.motorNumber).filter((x) => x != null);
    const meetStart = api.facts?.racers?.meet_start ?? date;
    const racerIds = (race?.entries ?? []).map((e) => e.racerId).filter((x) => x != null);
    const [pretest, stats, meetEntries] = await Promise.all([
      sbGet("motor_pretest_stats", `select=race_date,motor_number,pretest_time,pretest_rank&venue_code=eq.${Number(venue)}&and=(race_date.gte.${daysBefore(meetStart, 1)},race_date.lte.${date})&motor_number=in.(${motors.join(",")})`),
      sbGet("venue_motor_stats", `select=motor_number,scraped_date,race_count,final_count,championship_count,first_place_count,top2_rate&venue_code=eq.${Number(venue)}&scraped_date=lte.${date}&motor_number=in.(${motors.join(",")})&order=scraped_date.desc`),
      sbGet("race_entries", `select=race_id,boat_number,racer_id&racer_id=in.(${racerIds.join(",")})&and=(race_id.gte.${meetStart},race_id.lt.${raceId})`),
    ]);
    const exIds = [...new Set(meetEntries.map((e) => e.race_id))];
    const ex = exIds.length ? await sbIn("exhibition_data", "race_id,boat_number,exhibition_time", "race_id", exIds) : [];
    db.motor = { meetStart, pretest, stats, meetEntries, exhibition: ex.filter((x) => meetEntries.some((e) => e.race_id === x.race_id && e.boat_number === x.boat_number)) };
  } catch (e) {
    db.motor = null;
    missing.push({ source: "db.motor", reason: e instanceof Error ? e.message : String(e) });
  }
  return { schemaVersion: MATERIALS_VERSION, raceId, date, venueCode: Number(venue), stage, api, db, missing };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : null;
  };
  const stage = opt("--stage") ?? "racecard";
  const caseDir = opt("--from-case");
  const [raceId, out] = args;
  if (!raceId || !out) {
    console.error("使い方: node fetch-materials.mjs <raceId> <出力.json> [--stage racecard|exhibition] [--from-case <dir>]");
    process.exit(2);
  }
  const m = await fetchMaterials(raceId, { stage, caseDir });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(m));
  for (const x of m.missing) console.warn(`[取れなかった材料] ${x.source}: ${x.reason}`);
  console.log(`${out}: 取れなかった材料 ${m.missing.length}件`);
}
