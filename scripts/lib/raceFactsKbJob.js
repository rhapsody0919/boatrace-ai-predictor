/**
 * kb 層の facts の行（race_facts・run_facts の era='kb'）を、kb_archive_* から半月ずつ組み立てて書く流れ（ADR-0113 決定3）。
 * 読み書きは呼び手が渡す（CLI: scripts/maintenance/race-facts-backfill.js）。ここは順番・グレードの当て方・消す行の決め方だけ。
 *
 * - グレードは 190 と同じ: 特別な節の補正（racerCareerDb.js の loadJudgeInputs が返す overrides）を先に、無ければ
 *   kb_archive_venue_days.race_grade（ADR-0104 決定4）。種別（series_kind）は今は NULL（後の段で race_series から当てる）
 * - 窓の中に facts の kb の行があって、組み立て直した行に無い物は消す（レースが消えた・作り直した後の孤立した行。db-draft §0）。
 *   消える行が窓の既存の行の2割を超えたら、allowMassDelete が無い限り書かずに止める（racerCareerCore.js と同じ線）
 * - 窓に kb のレースが1つも無い半月は飛ばす（年末年始の休み）。全部で0レースなら throw（kb_archive が空か範囲の誤り）
 */
import { buildKbRaceFact, buildKbRunFacts } from "./raceFactsKb.js";
import { MAX_STALE_RATIO } from "./racerCareerCore.js";

/** 窓の既存の行のキーのうち、組み立てた行に無い物 */
export function staleKeysOf(existingKeys, builtKeys) {
  const built = new Set(builtKeys);
  return existingKeys.filter((k) => !built.has(k));
}

/** 1つの窓の行を組み立てる（純関数） */
export function buildWindowRows({ races, boats, venueDays }, overrideGrades) {
  const dayById = new Map(venueDays.map((d) => [d.venue_day_id, d]));
  const boatsByRace = new Map();
  for (const b of boats) {
    if (!boatsByRace.has(b.race_id)) boatsByRace.set(b.race_id, []);
    boatsByRace.get(b.race_id).push(b);
  }
  const raceRows = [];
  const runRows = [];
  for (const race of races) {
    const day = dayById.get(race.venue_day_id) ?? null;
    const grade = overrideGrades.get(race.race_id) ?? day?.race_grade ?? null;
    const raceBoats = boatsByRace.get(race.race_id) ?? [];
    raceRows.push(buildKbRaceFact(race, day, { grade, seriesKind: null, boats: raceBoats }));
    runRows.push(...buildKbRunFacts(race, raceBoats));
  }
  const raceIds = new Set(races.map((r) => r.race_id));
  const orphan = boats.find((b) => !raceIds.has(b.race_id));
  if (orphan) throw new Error(`kb_archive_boats にレースの無い艇がある: ${orphan.race_id}`);
  return { raceRows, runRows };
}

/**
 * @param {{
 *   ranges: Array<{from: string, to: string}>,
 *   overrides: { raceIds: string[], grades: string[] },
 *   fetchWindow: (range: {from: string, to: string}) => Promise<{races: object[], boats: object[], venueDays: object[]}>,
 *   fetchExistingKeys: (range: {from: string, to: string}) => Promise<{race: string[], run: string[]}>,
 *   writeWindow: (plan: {range: object, raceRows: object[], runRows: object[], staleRace: string[], staleRun: string[]}) => Promise<{written: number}>,
 *   allowMassDelete?: boolean,
 *   log?: (line: string) => void,
 * }} deps
 */
export async function runKbFacts({
  ranges,
  overrides,
  fetchWindow,
  fetchExistingKeys,
  writeWindow,
  allowMassDelete = false,
  log = console.log,
}) {
  if (overrides.raceIds.length !== overrides.grades.length) {
    throw new Error("グレードの補正のレースとグレードの数が違う");
  }
  const overrideGrades = new Map(overrides.raceIds.map((id, i) => [id, overrides.grades[i]]));
  const totals = { races: 0, runs: 0, written: 0, staleRace: 0, staleRun: 0, windows: 0 };
  for (const range of ranges) {
    const window = await fetchWindow(range);
    if (window.races.length === 0) {
      log(`${range.from}〜${range.to}: kb のレースなし（飛ばす）`);
      continue;
    }
    const { raceRows, runRows } = buildWindowRows(window, overrideGrades);
    const existing = await fetchExistingKeys(range);
    const staleRace = staleKeysOf(existing.race, raceRows.map((r) => r.race_id));
    const staleRun = staleKeysOf(existing.run, runRows.map((r) => `${r.race_id}|${r.boat_number}`));
    const before = existing.race.length + existing.run.length;
    const stale = staleRace.length + staleRun.length;
    if (!allowMassDelete && before > 0 && stale / before > MAX_STALE_RATIO) {
      throw new Error(
        `${range.from}〜${range.to}: 消える行が既存の ${stale}/${before} で ${MAX_STALE_RATIO * 100}% を超える。書かずに止める（規則を変えたときだけ --allow-mass-delete）`,
      );
    }
    const { written } = await writeWindow({ range, raceRows, runRows, staleRace, staleRun });
    totals.races += raceRows.length;
    totals.runs += runRows.length;
    totals.written += written;
    totals.staleRace += staleRace.length;
    totals.staleRun += staleRun.length;
    totals.windows += 1;
    log(`${range.from}〜${range.to}: レース ${raceRows.length}・艇 ${runRows.length}・書く ${written}・消す ${stale}`);
  }
  if (totals.races === 0) throw new Error("kb のレースが0だった（kb_archive が空か、範囲の指定の誤り）");
  return totals;
}
