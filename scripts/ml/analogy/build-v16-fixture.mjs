/**
 * BOA-271 v16 の画面の開発・受け入れ E2E 用に、朝のバッチの手元の出力（v16_morning.py --out、--upload なし）から
 * API（api/analogy/{facts,similar,scenario}/[raceId].js）の応答を組み立てる。展示後の段は Cron と同じ関数
 * （scripts/lib/analogyV16Exhibition.js）で、export_pool.js の exhibition.csv・conditions.csv の値から作る。
 * 本番の DB・Storage は読まない。
 *
 * 使い方: node scripts/ml/analogy/build-v16-fixture.mjs <バッチの出力の {日付}/{実行ID}> <race_id> <出力先>
 * 出力: {出力先}/{race_id}/facts.json・similar-racecard.json・similar-exhibition.json・scenario-{範囲キー}.json
 *   （status はどれも exhibition_ready。画面の状態の確認は応答の status を書き換えて行う）
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import {
  exhibitionNeighbors,
  todayExhibition,
} from "../../lib/analogyV16Exhibition.js";
import { buildLiveFeatures } from "../../../src/utils/analogyRaceFeatures.js";
import { rerankSimilar } from "../../../src/utils/analogySimilarRerank.js";
import { mergeExhibition } from "../../../api/analogy/similar/[raceId].js";
import { withoutSeriesScoreOnFinal } from "../../../api/analogy/facts/[raceId].js";

const [runDir, raceId, outDir] = process.argv.slice(2);
if (!runDir || !raceId || !outDir) {
  console.error("使い方: node build-v16-fixture.mjs <{日付}/{実行ID}> <race_id> <出力先>");
  process.exit(1);
}
const DATA = process.env.ANALOGY_DATA_DIR ?? "data/ml/analogy";
const read = (kind, name) => {
  const p = path.join(runDir, kind, `${name.replaceAll(":", "_")}.json.gz`);
  return fs.existsSync(p) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(p))) : null;
};
const csvRows = (file) => {
  const [head, ...lines] = fs.readFileSync(path.join(DATA, file), "utf8").trim().split("\n");
  const cols = head.split(",");
  return lines
    .filter((l) => l.startsWith(raceId + ","))
    .map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v === "" ? null : v])));
};

const today = read("today", raceId);
if (!today) throw new Error(`${runDir}/today/${raceId} が無い`);
const out = path.join(outDir, raceId);
fs.mkdirSync(out, { recursive: true });
const write = (name, body) =>
  fs.writeFileSync(path.join(out, `${name.replaceAll(":", "_")}.json`), JSON.stringify(body));

// 展示後の段（Cron の buildRace と同じ流れ）
const exhRows = csvRows("exhibition.csv").map((r) => ({
  ...r,
  boat_number: Number(r.boat_number),
  exhibition_time: r.exhibition_time === null ? null : Number(r.exhibition_time),
  exhibition_course: r.exhibition_course === null ? null : Number(r.exhibition_course),
  start_timing: r.start_timing === null ? null : Number(r.start_timing),
}));
const cond = csvRows("conditions.csv")[0] ?? {};
const condNum = { ...cond, wind_speed: Number(cond.wind_speed), wave_height: Number(cond.wave_height) };
const live = buildLiveFeatures({
  boatNumbers: [1, 2, 3, 4, 5, 6],
  exhibition: exhRows,
  conditions: condNum,
  windOffset: today.wind_offset_deg ?? NaN,
});
const exhibition = todayExhibition(exhRows, live, condNum);
const file = read("similar", raceId);
const display = read("similar-display", raceId);
const todayEx = {
  boats: {
    exh_time: live.map((v) => v.exh_time),
    exh_time_diff: live.map((v) => v.exh_time_diff),
    exh_time_rank: live.map((v) => v.exh_time_rank),
  },
  race: Object.fromEntries(
    ["weather_code", "wind_x", "wind_y", "wind_speed", "wave_height"].map((k) => [k, live[0][k]]),
  ),
};
const reranked = rerankSimilar(file, todayEx);
const simEx = {
  race_id: raceId,
  n_layer: file.n_layer,
  exact: reranked.exact,
  neighbors: exhibitionNeighbors(
    file,
    reranked,
    { race: todayEx.race, exh_time: todayEx.boats.exh_time },
    display,
  ),
};

const base = { status: "exhibition_ready", run_id: "local", pool_cutoff: null };
// facts（api/analogy/facts と同じ組み立て）
const keys = [
  ...new Set(
    Object.values(today.scope_keys).flatMap((k) =>
      ["VC", "NC", "NCR", "VA"].map((s) => k[s]).filter(Boolean),
    ),
  ),
];
const facts = Object.fromEntries(keys.map((k) => [k, withoutSeriesScoreOnFinal(k, read("facts", k))]));
write("facts", { ...base, today, facts, exhibition });
const racecard = read("similar-racecard", raceId);
write("similar-racecard", { ...base, exact: null, similar: racecard });
write("similar-exhibition", { ...base, exact: simEx.exact, similar: mergeExhibition(racecard, simEx) });
for (const scope of Object.values(today.scope_keys["1"])) {
  const scenario = read("scenario", scope);
  if (!scenario) continue;
  write(`scenario-${scope}`, {
    ...base,
    scope,
    scope_keys: today.scope_keys["1"],
    scenario,
    hints: today.hints,
    course_st: today.course_st,
    exhibition,
  });
}
console.log(`✅ ${out}（範囲 ${keys.length}・展示後の800件のうち厳密=${simEx.exact}）`);
