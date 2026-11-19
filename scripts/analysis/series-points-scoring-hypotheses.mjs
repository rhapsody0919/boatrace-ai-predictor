// 実行: node --env-file=.env.local scripts/analysis/series-points-scoring-hypotheses.mjs [--from=2026-06-01]
//
// 得点率の配点ルールの候補を、実データで突き合わせる（BOA-458 の手順2・3）。
//
// ## なぜ比較が必要か
//
// 公式の得点率一覧（`race/pointrank`）が出るのは **SG/G1 の4日目以降だけ**で、
// 「予選特選」「予選特賞」のような一般戦・G3固有の番組は SG/G1 に出てこない。
// つまり一般戦の配点は公式データでは照合できない。そこで2つの物差しを使う。
//
//   物差しA（厳密・SG/G1のみ）… `racer_series_points` の公式の得点・得点率と
//     完全一致するか。ここが崩れる候補は即座に却下できる
//   物差しB（間接・全開催）… 予選終了時点の得点率順の上位N人（N=準優の枠数）が、
//     **実際に準優に乗った選手**とどれだけ一致するか。一般戦の準優は得点率順
//     だけで決まらないことがあるため完全一致は期待できないが、配点が実際の規則に
//     近いほど一致が増える。候補間の**相対比較**に使う
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { supabase, VENUE_NAMES } from "../lib/supabaseClient.js";
import { buildMeets, fetchAllByRaceId } from "../lib/meetBoundaries.js";
import {
  normalizeStage,
  isExcludedStage,
  countsForSeriesScore,
  semifinalRaceIdsOf,
} from "../../src/pure/seriesPoints.js";
import {
  pastPrelimRace,
  HYPOTHESES,
  SUBSETS,
  rankOf,
  SHIPPED_CUT,
  CUTS,
} from "./seriesPointsHypotheses.mjs";

const fromArg = process.argv.find((a) => a.startsWith("--from="));
const FROM = fromArg ? fromArg.slice("--from=".length) : "2026-06-01";

// ---- データ取得 -------------------------------------------------------------
// 出走表28万行を毎回引くと3分かかる。候補を足して比べ直す使い方をするので、
// `--cache` で一時ディレクトリに置いた取得結果を再利用できるようにしてある
const CACHE = process.argv.includes("--cache")
  ? path.join(os.tmpdir(), "boatai-series-points-hypotheses.json")
  : null;

async function load() {
  if (CACHE && fs.existsSync(CACHE)) {
    console.log(`キャッシュから読み込み: ${CACHE}`);
    return JSON.parse(fs.readFileSync(CACHE, "utf8"));
  }
  console.log("取得中…（出走表が28万行あるので数分かかる）");
  const conds = await fetchAllByRaceId(
    supabase,
    "race_conditions",
    "race_id, race_stage, series_day, is_final_day",
  );
  const entries = await fetchAllByRaceId(
    supabase,
    "race_entries",
    "race_id, boat_number, racer_id, player_name",
  );
  const results = await fetchAllByRaceId(
    supabase,
    "race_results",
    "race_id, rank1, rank2, rank3, rank4, rank5, rank6",
  );
  // 本番STの記録。欠場（走っていない）と失格・落水（走ったが着順が付かない）を
  // 区別するために要る（BOA-489）
  const starts = await fetchAllByRaceId(
    supabase,
    "race_start_timings",
    "race_id, boat_number, finish_mark",
  );
  const { data: official, error } = await supabase
    .from("racer_series_points")
    .select(
      "venue_code, meet_start_date, racer_id, rank, score_rate, total_points, penalty_points, remarks",
    );
  if (error) throw new Error(`racer_series_points: ${error.message}`);
  const payload = { conds, entries, results, starts, official: official ?? [] };
  if (CACHE) fs.writeFileSync(CACHE, JSON.stringify(payload));
  return payload;
}

const { conds, entries, results, starts, official } = await load();

const resultById = new Map(results.map((r) => [r.race_id, r]));
// 欠場の判定（BOA-489）。出荷コードの `getMeetScoreboard` と同じ組み立て:
// STが1行も無いレースは取得漏れの可能性があるので全艇を出走扱いに倒す
// 欠場艇にも行がある（finish_mark='欠'）ので、それは出走に数えない（getMeetScoreboard と同じ）
const startedKeys = new Set(
  (starts ?? [])
    .filter((r) => r.finish_mark !== "欠")
    .map((r) => `${r.race_id}|${r.boat_number}`),
);
const racesWithSt = new Set((starts ?? []).map((r) => r.race_id));
function didStart(raceId, boatNumber) {
  if (!racesWithSt.has(raceId)) return true;
  return startedKeys.has(`${raceId}|${boatNumber}`);
}
const entriesByRace = new Map();
for (const e of entries) {
  if (!entriesByRace.has(e.race_id)) entriesByRace.set(e.race_id, []);
  entriesByRace.get(e.race_id).push(e);
}

const allMeets = buildMeets(conds);
const meets = allMeets.filter(
  (m) => m.dates.at(-1) >= FROM && m.prelimEndRaceId !== null,
);
console.log(
  `節: ${meets.length}（${FROM} 以降に終わり、予選の締めが特定できたもの）  出走表: ${entries.length}行`,
);

/** 1レース分の出走表を、選手別の得点・走数の集計（byRacer）へ足す */
function addRaceScores(byRacer, raceId, result, table) {
  for (const e of entriesByRace.get(raceId) ?? []) {
    const cur = byRacer.get(e.racer_id) ?? {
      racerId: e.racer_id,
      playerName: e.player_name,
      points: 0,
      runs: 0,
    };
    const rank = rankOf(result, e.boat_number);
    // 欠場（着順に載らず、本番STの記録も無い）は走数にも入れない。
    // 失格・落水（走ったが着順が付かない）は0点だが分母には入れる
    if (rank === null && !didStart(raceId, e.boat_number)) continue;
    cur.runs += 1;
    if (rank !== null) cur.points += table[rank] ?? 0;
    byRacer.set(e.racer_id, cur);
  }
}

/** 候補ごとに節内の選手別の得点・走数を出す */
function scoreMeet(meet, hypothesis, cut = SHIPPED_CUT) {
  const byRacer = new Map();
  for (const row of meet.rows) {
    const stage = row.race_stage ?? "";
    if (isExcludedStage(stage)) continue;
    if (!cut.keep(meet, row)) continue;

    const result = resultById.get(row.race_id);
    // 結果がまだ無いレースは分母に入れない（`computeSeriesScore` と同じ）
    if (!result || result.rank1 === null || result.rank1 === undefined) continue;
    const table = hypothesis.table(normalizeStage(stage));
    addRaceScores(byRacer, row.race_id, result, table);
  }
  return [...byRacer.values()]
    .filter((r) => r.runs > 0)
    .map((r) => ({ ...r, rate: r.points / r.runs }))
    .sort((a, b) => b.rate - a.rate);
}

/** 節で実際に準優に乗った選手と、枠数 */
function semifinalOf(meet) {
  // 出荷コードと同じ判定を使う（「準優進出戦」を準優に数えない）
  const ids = semifinalRaceIdsOf(meet.rows);
  const racers = new Set();
  for (const id of ids) {
    for (const e of entriesByRace.get(id) ?? []) racers.add(e.racer_id);
  }
  return { slots: ids.length * 6, racers, raceCount: ids.length };
}

/**
 * 節の最終日に出走が無い選手（途中帰郷の推定）。
 *
 * **この推定は外れることがある**。実測では離脱と判定した629名のうち39名
 * （31節）が実際には準優に乗っており、その分は構造的に当てられない
 * （候補から外れるのに正解集合には入る）。物差しBの絶対値は0.8pt程度
 * これで目減りするが、全候補に同じ条件がかかるので相対比較には使える。
 */
function withdrawnOf(meet) {
  const lastDay = meet.dates.at(-1);
  const ran = new Set();
  const all = new Set();
  for (const row of meet.rows) {
    for (const e of entriesByRace.get(row.race_id) ?? []) {
      all.add(e.racer_id);
      if (row.race_id.startsWith(lastDay)) ran.add(e.racer_id);
    }
  }
  return new Set([...all].filter((id) => !ran.has(id)));
}

// ---- 物差しA: 公式データとの完全一致（SG/G1のみ） ---------------------------
const officialByMeet = new Map();
for (const row of official ?? []) {
  const key = `${row.venue_code}|${row.meet_start_date}`;
  if (!officialByMeet.has(key)) officialByMeet.set(key, []);
  officialByMeet.get(key).push(row);
}

console.log("\n=== 物差しA: 公式の得点率一覧との一致（SG/G1のみ） ===");
for (const hypothesis of HYPOTHESES) {
  const lines = [];
  for (const [key, rows] of officialByMeet) {
    const [venueCode, meetStart] = key.split("|");
    const meet = allMeets.find(
      (m) =>
        m.venueCode === Number(venueCode) && m.dates[0] === meetStart,
    );
    if (!meet) continue;
    const scored = new Map(scoreMeet(meet, hypothesis).map((r) => [r.racerId, r]));
    let match = 0;
    let checked = 0;
    let skippedPenalty = 0;
    for (const o of rows) {
      // 公式が得点率を出していない選手（賞典除外・途中帰郷）は比較対象外
      if (o.score_rate === null || o.total_points === null) continue;
      // **減点がある選手は対象外**。公式は `(着順点 − 減点) / 走数` を出しており
      // （多摩川G1の実測: 岩瀬 38点・減点10・6走 → 4.67）、当社は減点を持って
      // いないため配点の比較にならない。減点そのものは別課題として切り出す
      if (o.penalty_points) {
        skippedPenalty += 1;
        continue;
      }
      const mine = scored.get(o.racer_id);
      if (!mine) continue;
      checked += 1;
      if (
        mine.points === o.total_points &&
        Math.abs(mine.rate - Number(o.score_rate)) < 0.005
      ) {
        match += 1;
      }
    }
    lines.push(
      `${VENUE_NAMES[Number(venueCode)] ?? venueCode}${meetStart} ${match}/${checked}` +
        (skippedPenalty ? `（減点あり${skippedPenalty}名を除外）` : ""),
    );
  }
  console.log(`  ${hypothesis.key.padEnd(18)} ${lines.join("  ")}`);
}

// ---- 物差しB: 準優進出者との一致（全開催） ----------------------------------
console.log(
  "\n=== 物差しB: 予選終了時点の得点率上位N人 vs 実際の準優進出者 ===",
);
console.log(
  "  （N=準優の枠数。一般戦の準優は得点率順だけで決まらないため完全一致は期待できない。候補間の相対比較に使う）",
);

const summary = new Map();
for (const hypothesis of HYPOTHESES) summary.set(hypothesis.key, new Map());

let usableMeets = 0;
for (const meet of meets) {
  const sf = semifinalOf(meet);
  if (sf.raceCount === 0 || sf.racers.size === 0) continue;
  // 枠数と実際の進出者数が食い違う節（欠場の繰り上がり等）は除く
  if (sf.racers.size !== sf.slots) continue;
  const withdrawn = withdrawnOf(meet);
  usableMeets += 1;

  // この節の予選期間内に出た種別（部分集合の判定に使う）
  const prelimStages = meet.rows
    .filter((r) =>
      countsForSeriesScore(r.race_stage ?? "", r.race_id, meet.prelimEndRaceId),
    )
    .map((r) => normalizeStage(r.race_stage ?? ""));
  const subsetKeys = SUBSETS.filter((s) =>
    prelimStages.some((st) => s.has(st)),
  ).map((s) => s.key);

  for (const hypothesis of HYPOTHESES) {
    const ranked = scoreMeet(meet, hypothesis).filter(
      (r) => !withdrawn.has(r.racerId),
    );
    const topN = new Set(ranked.slice(0, sf.slots).map((r) => r.racerId));
    let hit = 0;
    for (const id of topN) if (sf.racers.has(id)) hit += 1;
    const bucket = summary.get(hypothesis.key);
    for (const key of subsetKeys) {
      const cur = bucket.get(key) ?? { meets: 0, hit: 0, total: 0, exact: 0 };
      cur.meets += 1;
      cur.hit += hit;
      cur.total += sf.slots;
      if (hit === sf.slots) cur.exact += 1;
      bucket.set(key, cur);
    }
  }
}
console.log(`  対象の節: ${usableMeets}\n`);
for (const s of SUBSETS) {
  const any = HYPOTHESES.some((h) => summary.get(h.key).get(s.key));
  if (!any) continue;
  console.log(`  ▼ ${s.label}`);
  console.log(
    ["    候補", "節", "一致/枠", "一致率", "全枠一致の節"].join("\t"),
  );
  for (const hypothesis of HYPOTHESES) {
    const v = summary.get(hypothesis.key).get(s.key);
    if (!v) continue;
    console.log(
      "    " +
        [
          hypothesis.key,
          v.meets,
          `${v.hit}/${v.total}`,
          `${((v.hit / v.total) * 100).toFixed(2)}%`,
          `${v.exact} (${((v.exact / v.meets) * 100).toFixed(1)}%)`,
        ].join("\t"),
    );
  }
  console.log("");
}

console.log("\n=== 候補の説明 ===");
for (const h of HYPOTHESES) console.log(`  ${h.key.padEnd(18)} ${h.label}`);

// ---- 算入範囲（予選の締め）の比較 -------------------------------------------
// 配点は上で選んだ候補に固定し、切り方だけを変えて比べる
const BEST = HYPOTHESES.find((h) => h.key === "H4-+senbatsu");

console.log("\n\n=== 算入範囲の候補: 公式の得点率一覧との一致（SG/G1のみ） ===");
for (const cut of CUTS) {
  const lines = [];
  for (const [key, rows] of officialByMeet) {
    const [venueCode, meetStart] = key.split("|");
    const meet = allMeets.find(
      (m) => m.venueCode === Number(venueCode) && m.dates[0] === meetStart,
    );
    if (!meet) continue;
    const scored = new Map(
      scoreMeet(meet, BEST, cut).map((r) => [r.racerId, r]),
    );
    let match = 0;
    let checked = 0;
    for (const o of rows) {
      if (o.score_rate === null || o.total_points === null) continue;
      if (o.penalty_points) continue;
      const mine = scored.get(o.racer_id);
      if (!mine) continue;
      checked += 1;
      if (
        mine.points === o.total_points &&
        Math.abs(mine.rate - Number(o.score_rate)) < 0.005
      )
        match += 1;
    }
    lines.push(
      `${VENUE_NAMES[Number(venueCode)] ?? venueCode}${meetStart} ${match}/${checked}`,
    );
  }
  console.log(`  ${cut.key.padEnd(30)} ${lines.join("  ")}`);
}

console.log("\n=== 算入範囲の候補: 準優進出者との一致 ===");
const cutSummary = new Map(CUTS.map((c) => [c.key, new Map()]));
for (const meet of meets) {
  const sf = semifinalOf(meet);
  if (sf.raceCount === 0 || sf.racers.size !== sf.slots) continue;
  const withdrawn = withdrawnOf(meet);
  // 「予選」ラベルの最終レースより後に、その日のうちに残っているレースが
  // あるか（＝C0とC1で差が出る節か）
  const hasTailRaces =
    meet.prelimEndRaceId !== null &&
    meet.rows.some(
      (r) =>
        !isExcludedStage(r.race_stage ?? "") &&
        pastPrelimRace(r.race_id, meet.prelimEndRaceId) &&
        r.race_id.slice(0, 10) === meet.prelimEndRaceId.slice(0, 10),
    );
  for (const cut of CUTS) {
    const ranked = scoreMeet(meet, BEST, cut).filter(
      (r) => !withdrawn.has(r.racerId),
    );
    const topN = new Set(ranked.slice(0, sf.slots).map((r) => r.racerId));
    let hit = 0;
    for (const id of topN) if (sf.racers.has(id)) hit += 1;
    for (const key of hasTailRaces ? ["all", "tail"] : ["all"]) {
      const b = cutSummary.get(cut.key);
      const cur = b.get(key) ?? { meets: 0, hit: 0, total: 0, exact: 0 };
      cur.meets += 1;
      cur.hit += hit;
      cur.total += sf.slots;
      if (hit === sf.slots) cur.exact += 1;
      b.set(key, cur);
    }
  }
}
for (const [key, label] of [
  ["all", "全節"],
  ["tail", "最終予選日に「予選」ラベル外のレースが残る節（C0とC1で差が出る節）"],
]) {
  console.log(`  ▼ ${label}`);
  console.log(
    ["    候補", "節", "一致/枠", "一致率", "全枠一致の節"].join("\t"),
  );
  for (const cut of CUTS) {
    const v = cutSummary.get(cut.key).get(key);
    if (!v) continue;
    console.log(
      "    " +
        [
          cut.key,
          v.meets,
          `${v.hit}/${v.total}`,
          `${((v.hit / v.total) * 100).toFixed(2)}%`,
          `${v.exact} (${((v.exact / v.meets) * 100).toFixed(1)}%)`,
        ].join("\t"),
    );
  }
  console.log("");
}
for (const c of CUTS) console.log(`  ${c.key.padEnd(30)} ${c.label}`);
