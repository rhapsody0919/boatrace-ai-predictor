/**
 * 選手ページの集計の表（racerCareerJob.js）の DB の読み（判定の材料・計算の RPC・今ある行・kb の指紋）と、計算の記録の書き込み。
 * racerCareerJob.js から分けた（大きさの関所）。racerCareerJob.js が同じ名前で export し直す。
 */
import {
  finalStagesOf,
  gradeOverridesOf,
  specialSeriesGroups,
} from "./racerCareerSeries.js";

// ---------------------------------------------------------------------------
// DB の読み書き（client は service_role の Supabase）
// ---------------------------------------------------------------------------

async function rpc(client, fn, args) {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`${fn} の呼び出しに失敗: ${error.message}`);
  if (data === null || data === undefined)
    throw new Error(`${fn} が値を返さなかった`);
  return data;
}

/**
 * 判定の材料（優勝戦の種別・グレードの補正）を作る。
 * @param {{client: object, era: "kb"|"main", ranges: Array<{from: string, to: string}>, activeFrom?: string|null}} opts
 */
export async function loadJudgeInputs({
  client,
  era,
  ranges,
  activeFrom = null,
}) {
  const stages = new Set();
  const series = [];
  const active = new Set();
  for (const r of ranges) {
    const data = await rpc(client, "racer_career_inputs", {
      p_era: era,
      p_from: r.from,
      p_to: r.to,
      p_active_from: activeFrom,
    });
    for (const s of data.stages ?? []) stages.add(s);
    series.push(...(data.series ?? []));
    for (const id of data.active_racer_ids ?? []) active.add(Number(id));
  }
  const groups = specialSeriesGroups(series);
  const venueDays = groups.flatMap((g) => g.venueDays);
  const specialRaces =
    venueDays.length === 0
      ? []
      : await rpc(client, "racer_career_special_races", {
          p_era: era,
          p_venue_days: venueDays,
        });
  const overrides = gradeOverridesOf(groups, specialRaces);
  return {
    finalStages: finalStagesOf([...stages]),
    stageCount: stages.size,
    overrides,
    activeRacerIds: [...active].sort((a, b) => a - b),
  };
}

/** 1回分の計算（書かない） */
export async function computeCounts(
  client,
  { era, from, to, racerIds, inputs },
) {
  return rpc(client, "compute_racer_career_counts", {
    p_era: era,
    p_from: from,
    p_to: to,
    p_racer_ids: racerIds,
    p_final_stages: inputs.finalStages,
    p_override_race_ids: inputs.overrides.raceIds,
    p_override_grades: inputs.overrides.grades,
  });
}

const PAGE = 1000;

/** 層（と選手）の今ある行のキーを、ページを分けて全部読む（1000行で黙って切れないように） */
export async function fetchExistingKeys(
  client,
  table,
  keyColumns,
  { era, racerIds = null },
) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    let q = client.from(table).select(keyColumns.join(",")).eq("era", era);
    if (racerIds) q = q.in("racer_id", racerIds);
    for (const c of keyColumns) q = q.order(c, { ascending: true });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error)
      throw new Error(`${table} の既存行の読み取りに失敗: ${error.message}`);
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

/** 計算の記録（racer_career_meta）を書く */
export async function writeMeta(client, meta, { dryRun }) {
  if (dryRun) return;
  const { error } = await client
    .from("racer_career_meta")
    .upsert(
      { ...meta, updated_at: new Date().toISOString() },
      { onConflict: "era" },
    );
  if (error)
    throw new Error(`racer_career_meta の書き込みに失敗: ${error.message}`);
}

/** kb_archive の指紋（開催日の数・レースの数・最大の日付）。安い数え方だけを使う */
export async function kbFingerprint(client) {
  const count = async (table) => {
    const { count: n, error } = await client
      .from(table)
      .select("*", { count: "exact", head: true });
    if (error)
      throw new Error(`${table} の件数の読み取りに失敗: ${error.message}`);
    return n;
  };
  const { data, error } = await client
    .from("kb_archive_venue_days")
    .select("race_date")
    .order("race_date", { ascending: false })
    .limit(1);
  if (error)
    throw new Error(
      `kb_archive_venue_days の最大の日付の読み取りに失敗: ${error.message}`,
    );
  return {
    venue_days: await count("kb_archive_venue_days"),
    races: await count("kb_archive_races"),
    max_race_date: data?.[0]?.race_date ?? null,
  };
}

/** 2つの kb の指紋が同じか（boats_by_year 等の付け足しは見ない） */
export const sameKbFingerprint = (a, b) =>
  !!a &&
  !!b &&
  a.venue_days === b.venue_days &&
  a.races === b.races &&
  String(a.max_race_date) === String(b.max_race_date);

/**
 * もう一方の層の、1選手あたりの行数の上限（既存行の読み取りは2層とも読むため）。
 * kb の実測の最大（system-architect の再審査、2026-10-31）: 場別 132・期別 106・進入コース別 90。
 * 優勝戦の出走は kb の最大を同じ程度と置いた。main は1年で kb の数分の1なので、同じ値を上限に使う
 */
export const OTHER_ERA_MAX_ROWS = Object.freeze({
  racer_venue_stats: 132,
  racer_term_stats: 106,
  racer_course_stats: 90,
  racer_championships: 132,
});

/** PostgREST の1回の読みの上限 */
export const PAGE_ROWS = 1000;

/**
 * 既存行の読み取り（fetchExistingRows）の1回の選手数。この層の新しい行の1選手の最大と、もう一方の層の上限の和で、
 * 900行に収まる人数にする。1選手だけで収まらなければ止める
 * @param {object[]} rows この層の新しい行
 * @param {number} otherEraMax もう一方の層の1選手の上限
 * @param {object[]} [existingRows] この層の今ある行のキー（racer_id を持つ）
 */
export function existingChunkSize(rows, otherEraMax = 0, existingRows = []) {
  // この層は「新しい行」と「今ある行（消える前のセルを含む）」の多い方を見る
  const count = (list) => {
    const per = new Map();
    for (const r of list) per.set(r.racer_id, (per.get(r.racer_id) ?? 0) + 1);
    return per;
  };
  const fresh = count(rows);
  const old = count(existingRows);
  const ids = new Set([...fresh.keys(), ...old.keys()]);
  const perRacer = [...ids].map((id) => Math.max(fresh.get(id) ?? 0, old.get(id) ?? 0));
  const max = Math.max(1, ...perRacer) + otherEraMax;
  if (max > 900)
    throw new Error(`1選手の行が2層で ${max} 行になりうる。既存行の読みが1000行の上限で切れる`);
  return Math.max(1, Math.floor(900 / max));
}
