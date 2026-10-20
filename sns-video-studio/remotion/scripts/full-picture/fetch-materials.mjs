/**
 * 全貌動画の材料 JSON を1つ作る（龍神側。毎日の実行で鍵が要るのはここだけ）。
 * 公開 API（https://www.boat-ai.jp/api/...）の応答を、場面の作り手が使う形でそのまま1つにまとめる。計算はしない
 * （計算は場面ごとの build が画面と同じ関数で行う）。取れなかった材料は missing に記録し、全体は止めない。
 *
 * 使い方: node scripts/full-picture/fetch-materials.mjs <raceId> <出力.json> [--stage racecard|exhibition] [--from-case <dir>]
 *   --from-case: 撮影済みの全貌の case（~/full-picture/cases/{raceId}）の analysis/source から facts・similar・scenario を使う
 *   （試作で、撮影した画面と同じ時点の材料にそろえるため）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";

export const MATERIALS_VERSION = "full-picture-materials/1";
const BASE = process.env.FULL_PICTURE_API_BASE ?? "https://www.boat-ai.jp";
const VENUES = Array.from({ length: 24 }, (_, i) => i + 1);

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`);
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
      api[key] = seeded ?? (await getJson(path));
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
  return { schemaVersion: MATERIALS_VERSION, raceId, date, venueCode: Number(venue), stage, api, missing };
}

if (import.meta.url === `file://${process.argv[1]}`) {
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
