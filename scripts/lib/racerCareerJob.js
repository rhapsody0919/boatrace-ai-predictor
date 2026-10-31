/**
 * 選手ページ（GS00 案2）の集計の表（マイグレーション 190）の書き手の共通部分。
 *
 *   kb 層:   scripts/maintenance/racer-career-backfill.js --era=kb（1回だけ、オーナーが実行）
 *   main 層: api/cron/racer-career-main.js（毎晩）と、初回の全選手の計算 racer-career-backfill.js --era=main
 *
 * 設計: docs/design/racer-period-stats/plan.md §14、ADR-0104。
 *
 * 方針:
 *   - 数えるのは DB の RPC（compute_racer_career_counts）。ここは判定の材料（優勝戦の種別の原文・グレードの補正）を作り、
 *     返った件数を足し合わせ、upsertChangedRows で書き、消えたセルを消す
 *   - 「差分を足す」はしない。毎回その選手（kb は全選手）の層の全期間を計算し直して置き換える（Cron の重複・未配信に強い）
 *   - 優勝戦の判定は src/pure/raceStageConfig.js の isFinalStage（v2）。kb_archive_races.stage_kind は使わない
 *   - 勝率の着順点・出走の数え方は持たない（src/pure/racerCareerStats.js、BOA-1193 が読み手の側で使う）
 */
import { isFinalStage } from "../../src/pure/raceStageConfig.js";
import { upsertChangedRows } from "./unchangedRows.js";
import {
  KB_FIRST_DATE,
  KB_LAST_DATE,
  MAIN_TABLES_START,
} from "./kbArchiveBoundary.js";

/** 判定の規則の版。isFinalStage の v2・グレードの補正 v2（class_code の読み替え）・着のコードの体系 v1。規則を変えたら上げ、kb を計算し直す */
export const RULE_VERSION = "career-v1(stage-v2,grade-v2,code-v1)";

export const ERAS = Object.freeze({
  kb: { from: KB_FIRST_DATE, last: KB_LAST_DATE },
  main: { from: MAIN_TABLES_START, last: null },
});

/** 着のコードごとの件数の列（190 の表と RPC の戻り値で同じ名前） */
export const COUNT_COLUMNS = Object.freeze([
  "p1",
  "p2",
  "p3",
  "p4",
  "p5",
  "p6",
  "f",
  "l0",
  "l1",
  "k0",
  "k1",
  "s0",
  "s1",
  "s2",
  "code00",
  "other_code",
]);

/** RPC の戻り値の区分 → 表 */
export const CAREER_TABLES = Object.freeze({
  venue: {
    table: "racer_venue_stats",
    keyColumns: ["racer_id", "venue_code", "era", "race_grade", "is_final"],
    counts: true,
  },
  term: {
    table: "racer_term_stats",
    keyColumns: ["racer_id", "term_start", "era", "race_grade", "is_final"],
    counts: true,
  },
  course: {
    table: "racer_course_stats",
    keyColumns: ["racer_id", "course", "term_start", "era"],
    counts: true,
  },
  finals: {
    table: "racer_championships",
    keyColumns: ["race_id", "racer_id"],
    counts: false,
  },
});

/** 消えるセルがこの割合を超えたら止める（元の表の取り違え・部分的な読みで大量に消さない） */
export const MAX_STALE_RATIO = 0.2;

// ---------------------------------------------------------------------------
// 純関数
// ---------------------------------------------------------------------------

/**
 * 種別の原文のうち、優勝戦に当たるものだけを返す（RPC の p_final_stages）。
 * @param {unknown[]} stages
 * @returns {string[]}
 */
export function finalStagesOf(stages) {
  if (!Array.isArray(stages)) throw new Error("種別の一覧が配列ではない");
  return [
    ...new Set(stages.filter((s) => typeof s === "string" && isFinalStage(s))),
  ].sort();
}

const nfkc = (s) => (typeof s === "string" ? s.normalize("NFKC") : "");

/**
 * 同じ開催日に2つの格のレースが混ざる節と、公式が別の格で数えた節（official-data-spec、2026-10-28）。
 *   split:  選手のつながり（同じレースに出た選手を結ぶ）で2つの組に分け、seed のレースを含む組を primary にする。
 *           QC は12人だけがトライアル・順位決定・賞金女王決定に出る。CC は最終日の12Rが SG の優勝戦（11R はレディースCC）
 *   whole:  節の全レースを grade にする
 */
export const SPECIAL_SERIES_RULES = Object.freeze([
  {
    id: "qc",
    match: (t) => t.includes("クイーンズクライマックス") && t.includes("QC"),
    kind: "split",
    primaryGrade: "G1",
    otherGrade: "G3",
    isSeed: (race) => nfkc(race.stage).includes("トライアル"),
  },
  {
    id: "cc",
    match: (t) => t.includes("チャレンジカップ") && t.includes("レディース"),
    kind: "split",
    primaryGrade: "SG",
    otherGrade: "G2",
    isSeed: (race, ctx) =>
      race.race_number === 12 && race.race_id.startsWith(ctx.lastDay),
  },
  {
    id: "karatsu-2024-battle",
    match: (t, day) =>
      t.includes("バトルトーナメント") &&
      day.venue_code === 23 &&
      day.race_date >= "2024-10-12" &&
      day.race_date <= "2024-10-14",
    kind: "whole",
    grade: "G1",
  },
]);

const pad2 = (n) => String(n).padStart(2, "0");
/** 'YYYY-MM-DD-VV'（kb_archive_venue_days.venue_day_id と race_id の先頭と同じ形） */
export const venueDayIdOf = (day) =>
  `${String(day.race_date).slice(0, 10)}-${pad2(day.venue_code)}`;

const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * 開催日の一覧（{venue_code, race_date, title}）から、特別な節を見つけ、連続した日を1つの節にまとめる。
 * @param {Array<{venue_code: number, race_date: string, title: string|null}>} series
 * @returns {Array<{rule: object, venueDays: string[], lastDay: string}>}
 */
export function specialSeriesGroups(series) {
  if (!Array.isArray(series)) throw new Error("開催日の一覧が配列ではない");
  const hits = [];
  for (const day of series) {
    const t = nfkc(day.title);
    const rule = SPECIAL_SERIES_RULES.find((r) =>
      r.match(t, { ...day, race_date: String(day.race_date).slice(0, 10) }),
    );
    if (rule)
      hits.push({
        rule,
        day: { ...day, race_date: String(day.race_date).slice(0, 10) },
        title: t,
      });
  }
  hits.sort(
    (a, b) =>
      a.day.venue_code - b.day.venue_code ||
      a.day.race_date.localeCompare(b.day.race_date),
  );
  const groups = [];
  for (const h of hits) {
    const last = groups.at(-1);
    if (
      last &&
      last.rule === h.rule &&
      last.venueCode === h.day.venue_code &&
      last.title === h.title &&
      addDays(last.lastDate, 1) === h.day.race_date
    ) {
      last.venueDays.push(venueDayIdOf(h.day));
      last.lastDate = h.day.race_date;
    } else {
      groups.push({
        rule: h.rule,
        venueCode: h.day.venue_code,
        title: h.title,
        venueDays: [venueDayIdOf(h.day)],
        lastDate: h.day.race_date,
      });
    }
  }
  return groups.map((g) => ({
    rule: g.rule,
    title: g.title,
    venueDays: g.venueDays,
    lastDay: venueDayIdOf({ race_date: g.lastDate, venue_code: g.venueCode }),
  }));
}

/**
 * 選手のつながりで、seed のレースと同じ組のレースの集合を返す（union-find）。
 * @param {Array<{race_id: string, racer_ids: number[]}>} races
 * @param {(race: object) => boolean} isSeed
 * @returns {{primary: Set<string>, judged: Set<string>, primaryRacers: number, otherRacers: number}}
 */
export function splitByRacerLinks(races, isSeed) {
  const parent = new Map();
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const race of races) {
    for (const id of race.racer_ids) if (!parent.has(id)) parent.set(id, id);
    for (let i = 1; i < race.racer_ids.length; i++)
      union(race.racer_ids[0], race.racer_ids[i]);
  }
  const seedRoots = new Set(
    races
      .filter((r) => isSeed(r) && r.racer_ids.length > 0)
      .map((r) => find(r.racer_ids[0])),
  );
  const primary = new Set();
  const judged = new Set();
  const racersByRoot = new Map();
  for (const id of parent.keys()) {
    const root = find(id);
    racersByRoot.set(root, (racersByRoot.get(root) ?? 0) + 1);
  }
  for (const race of races) {
    if (race.racer_ids.length === 0) continue; // 出た選手が分からない（中止等）。グレードを補正しない
    judged.add(race.race_id);
    if (seedRoots.has(find(race.racer_ids[0]))) primary.add(race.race_id);
  }
  let primaryRacers = 0;
  let otherRacers = 0;
  for (const [root, n] of racersByRoot) {
    if (seedRoots.has(root)) primaryRacers += n;
    else otherRacers += n;
  }
  return { primary, judged, primaryRacers, otherRacers };
}

/**
 * 特別な節のレースごとのグレード（RPC の p_override_race_ids・p_override_grades）。
 * @param {ReturnType<typeof specialSeriesGroups>} groups
 * @param {Array<{race_id: string, race_number: number, stage: string|null, racer_ids: number[]}>} races
 * @returns {{raceIds: string[], grades: string[], report: object[]}}
 */
export function gradeOverridesOf(groups, races) {
  const byDay = new Map();
  for (const race of races) {
    const day = race.race_id.slice(0, 13);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(race);
  }
  const out = new Map();
  const report = [];
  for (const g of groups) {
    const groupRaces = g.venueDays.flatMap((d) => byDay.get(d) ?? []);
    if (groupRaces.length === 0) {
      report.push({ rule: g.rule.id, venueDays: g.venueDays, races: 0 });
      continue;
    }
    if (g.rule.kind === "whole") {
      for (const r of groupRaces) out.set(r.race_id, g.rule.grade);
      report.push({
        rule: g.rule.id,
        venueDays: g.venueDays,
        races: groupRaces.length,
        grade: g.rule.grade,
      });
      continue;
    }
    const split = splitByRacerLinks(groupRaces, (r) =>
      g.rule.isSeed(r, { lastDay: g.lastDay }),
    );
    if (split.primary.size === 0)
      throw new Error(
        `グレードの補正（${g.rule.id}、${g.venueDays[0]}〜）: 基準のレースが見つからない。節の作りが変わった可能性がある`,
      );
    for (const r of groupRaces) {
      if (!split.judged.has(r.race_id)) continue;
      out.set(
        r.race_id,
        split.primary.has(r.race_id) ? g.rule.primaryGrade : g.rule.otherGrade,
      );
    }
    report.push({
      rule: g.rule.id,
      venueDays: g.venueDays,
      races: groupRaces.length,
      primaryRaces: split.primary.size,
      primaryRacers: split.primaryRacers,
      otherRacers: split.otherRacers,
    });
  }
  const raceIds = [...out.keys()].sort();
  return { raceIds, grades: raceIds.map((id) => out.get(id)), report };
}

const keyOf = (row, keyColumns) =>
  keyColumns.map((c) => String(row[c])).join("|");

/**
 * RPC の戻り値（区分ごとの行）を、層の行として足し合わせる（kb は期間を分けて読むので同じキーが何度も来る）。
 * 優勝戦の行（finals）は足さず、同じキーが2回来たら止める（期間の分け方の重なり）。
 * @param {Map<string, Map<string, object>>} acc 区分 → (キー → 行)
 * @param {object} result compute_racer_career_counts の戻り値
 * @param {"kb"|"main"} era
 */
export function mergeCareerResult(acc, result, era) {
  if (!result || typeof result !== "object")
    throw new Error("compute_racer_career_counts の戻り値の形が違う");
  for (const [part, spec] of Object.entries(CAREER_TABLES)) {
    const rows = result[part];
    if (!Array.isArray(rows))
      throw new Error(
        `compute_racer_career_counts の戻り値に ${part} の配列が無い`,
      );
    if (!acc.has(part)) acc.set(part, new Map());
    const map = acc.get(part);
    for (const raw of rows) {
      const row = { ...raw, era };
      const k = keyOf(row, spec.keyColumns);
      const prev = map.get(k);
      if (!spec.counts) {
        if (prev)
          throw new Error(
            `${spec.table} のキーが重なった（${k}）。期間の分け方を確かめる`,
          );
        map.set(k, row);
        continue;
      }
      if (!prev) {
        const init = { ...row };
        for (const c of COUNT_COLUMNS) init[c] = Number(row[c] ?? 0);
        map.set(k, init);
      } else {
        for (const c of COUNT_COLUMNS) prev[c] += Number(row[c] ?? 0);
      }
    }
  }
  return acc;
}

/**
 * 今ある行のうち、新しい計算に無いキー（件数が0になったセル）を返す。
 * @param {object[]} existing
 * @param {object[]} incoming
 * @param {string[]} keyColumns
 */
export function staleRowsOf(existing, incoming, keyColumns) {
  const keep = new Set(incoming.map((r) => keyOf(r, keyColumns)));
  return existing.filter((r) => !keep.has(keyOf(r, keyColumns)));
}

/**
 * 期間を chunkDays 日ごとの [from, to) に分ける（kb は race_id の範囲読み。1回の RPC を 8秒の打ち切りより十分短くする）。
 * 月の頭と16日で切る（同じ節を細かく分けすぎない。数え方は足し算なので節をまたいでもよい）。
 * @returns {Array<{from: string, to: string}>}
 */
export function halfMonthRanges(from, lastInclusive) {
  const out = [];
  let cur = from;
  const end = addDays(lastInclusive, 1);
  while (cur < end) {
    const [y, m, d] = cur.split("-").map(Number);
    const next =
      d < 16
        ? `${y}-${pad2(m)}-16`
        : m === 12
          ? `${y + 1}-01-01`
          : `${y}-${pad2(m + 1)}-01`;
    out.push({ from: cur, to: next < end ? next : end });
    cur = next;
  }
  return out;
}

/** 選手の一覧を size 人ずつに分ける */
export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

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
 */
export function existingChunkSize(rows, otherEraMax = 0) {
  const per = new Map();
  for (const r of rows) per.set(r.racer_id, (per.get(r.racer_id) ?? 0) + 1);
  const max = Math.max(1, ...per.values()) + otherEraMax;
  if (max > 900)
    throw new Error(`1選手の行が2層で ${max} 行になりうる。既存行の読みが1000行の上限で切れる`);
  return Math.max(1, Math.floor(900 / max));
}

/**
 * 層の行を書き、新しい計算に無いセルを消す。racerIds を渡すとその選手だけを置き換える（main の毎晩）。
 * 4表とも、消すセルを先に決めて多すぎないかを見てから書く（途中の表まで書いて止まらない）。
 * @returns {Promise<{written: number, deleted: number, rows: number, perTable: object}>}
 */
export async function writeCareerRows(
  client,
  { era, acc, racerIds = null, dryRun, allowMassDelete = false, upsertBatchRacers = 100 },
) {
  const plans = [];
  for (const [part, spec] of Object.entries(CAREER_TABLES)) {
    const incoming = [...(acc.get(part)?.values() ?? [])];
    const existing = await fetchExistingKeys(client, spec.table, spec.keyColumns, {
      era,
      racerIds,
    });
    const stale = staleRowsOf(existing, incoming, spec.keyColumns);
    if (
      !allowMassDelete &&
      existing.length > 0 &&
      stale.length > Math.max(50, existing.length * MAX_STALE_RATIO)
    )
      throw new Error(
        `${spec.table}（${era}）: 消えるセルが ${stale.length}/${existing.length} 件で多すぎる。元の表の読み取りを確かめる（意図どおりなら --allow-mass-delete）`,
      );
    plans.push({ spec, incoming, stale });
  }

  let written = 0;
  let deleted = 0;
  let rows = 0;
  const perTable = {};
  for (const { spec, incoming, stale } of plans) {
    rows += incoming.length;
    // 既存行の読み取りは選手の数だけ並列に投げるので、選手 upsertBatchRacers 人ずつに分ける
    const byRacer = new Map();
    for (const r of incoming) {
      if (!byRacer.has(r.racer_id)) byRacer.set(r.racer_id, []);
      byRacer.get(r.racer_id).push(r);
    }
    let tableWritten = 0;
    for (const ids of chunk([...byRacer.keys()], upsertBatchRacers)) {
      const batch = ids.flatMap((id) => byRacer.get(id));
      const res = await upsertChangedRows(client, spec.table, batch, {
        onConflict: spec.keyColumns.join(","),
        keyColumns: spec.keyColumns,
        chunkColumn: "racer_id",
        chunkSize: existingChunkSize(batch, OTHER_ERA_MAX_ROWS[spec.table] ?? 0),
        // 1回の読みがちょうど上限で返ったら、切れた既存行のまま書かずに止める
        fullPageRows: PAGE_ROWS,
        failOnFetchError: true,
        label: `${spec.table}（${era}）`,
        dryRun,
        stampUpdatedAt: true,
      });
      if (res.error) throw res.error;
      tableWritten += res.written;
    }
    if (!dryRun) {
      for (const key of stale) {
        let q = client.from(spec.table).delete();
        for (const c of spec.keyColumns) q = q.eq(c, key[c]);
        const { error } = await q;
        if (error)
          throw new Error(`${spec.table} の古いセルの削除に失敗: ${error.message}`);
      }
    }
    written += tableWritten;
    deleted += stale.length;
    perTable[spec.table] = { rows: incoming.length, written: tableWritten, stale: stale.length };
  }
  return { written, deleted, rows, perTable };
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
 * kb 層を全期間で計算し直す（CLI から1回だけ）。
 * @param {{client: object, dryRun: boolean, allowMassDelete?: boolean, log?: (s: string) => void}} opts
 */
export async function runKbEra({
  client,
  dryRun,
  allowMassDelete = false,
  log = console.log,
}) {
  const startedAt = new Date().toISOString();
  const years = [];
  for (
    let y = Number(KB_FIRST_DATE.slice(0, 4));
    y <= Number(KB_LAST_DATE.slice(0, 4));
    y++
  )
    years.push({
      from:
        y === Number(KB_FIRST_DATE.slice(0, 4)) ? KB_FIRST_DATE : `${y}-01-01`,
      to:
        y === Number(KB_LAST_DATE.slice(0, 4))
          ? addDays(KB_LAST_DATE, 1)
          : `${y + 1}-01-01`,
    });
  const fingerprintBefore = await kbFingerprint(client);
  log(`kb_archive の指紋: ${JSON.stringify(fingerprintBefore)}`);
  const inputs = await loadJudgeInputs({ client, era: "kb", ranges: years });
  log(
    `優勝戦の種別 ${inputs.finalStages.length}/${inputs.stageCount}、グレードの補正 ${inputs.overrides.raceIds.length}レース`,
  );
  for (const r of inputs.overrides.report) log(`  補正: ${JSON.stringify(r)}`);

  const acc = new Map();
  const boatsByYear = {};
  let maxRaceDate = null;
  for (const r of halfMonthRanges(KB_FIRST_DATE, KB_LAST_DATE)) {
    const t0 = Date.now();
    const result = await computeCounts(client, {
      era: "kb",
      from: r.from,
      to: r.to,
      racerIds: null,
      inputs,
    });
    mergeCareerResult(acc, result, "kb");
    const y = r.from.slice(0, 4);
    boatsByYear[y] = (boatsByYear[y] ?? 0) + Number(result.boat_rows ?? 0);
    if (
      result.max_race_date &&
      (!maxRaceDate || result.max_race_date > maxRaceDate)
    )
      maxRaceDate = result.max_race_date;
    log(
      `  ${r.from}〜${r.to}: 艇 ${result.boat_rows} 行（${Date.now() - t0}ms）`,
    );
  }
  const sourceRows = Object.values(boatsByYear).reduce((a, b) => a + b, 0);
  if (sourceRows === 0)
    throw new Error(
      "kb の艇が0行だった（kb_archive が空か、範囲の指定の誤り）",
    );

  const fingerprintAfter = await kbFingerprint(client);
  if (!sameKbFingerprint(fingerprintBefore, fingerprintAfter))
    throw new Error(
      `計算の途中で kb_archive が変わった（前 ${JSON.stringify(fingerprintBefore)}、後 ${JSON.stringify(fingerprintAfter)}）。書かずに止める`,
    );
  const writeRes = await writeCareerRows(client, {
    era: "kb",
    acc,
    dryRun,
    allowMassDelete,
  });
  const meta = {
    era: "kb",
    computed_at: startedAt,
    rule_version: RULE_VERSION,
    source_from: KB_FIRST_DATE,
    source_to: maxRaceDate,
    source_rows: sourceRows,
    fingerprint: { ...fingerprintAfter, boats_by_year: boatsByYear },
    report: {
      overrides: inputs.overrides.report,
      final_stages: inputs.finalStages.length,
      tables: writeRes.perTable,
    },
  };
  await writeMeta(client, meta, { dryRun });
  return { meta, writeRes };
}

/**
 * main 層を計算し直す。racerIds が null なら直近（activeFrom 以降）に出た選手。
 * @param {{client: object, today: string, dryRun: boolean, racerIds?: number[]|null, activeDays?: number,
 *   batchSize?: number, shouldStop?: () => boolean, allowMassDelete?: boolean, log?: (s: string) => void}} opts
 */
export async function runMainEra({
  client,
  today,
  dryRun,
  all = false,
  activeDays = 3,
  batchSize = 50,
  shouldStop = () => false,
  allowMassDelete = false,
  log = console.log,
}) {
  const startedAt = new Date().toISOString();
  const to = addDays(today, 1);
  const activeFrom = all ? MAIN_TABLES_START : addDays(today, -activeDays);
  const inputs = await loadJudgeInputs({
    client,
    era: "main",
    ranges: [{ from: MAIN_TABLES_START, to }],
    activeFrom,
  });
  const racerIds = inputs.activeRacerIds;
  log(
    `main: 対象の選手 ${racerIds.length}人（${activeFrom} 以降に出走表に載った）、優勝戦の種別 ${inputs.finalStages.length}/${inputs.stageCount}、グレードの補正 ${inputs.overrides.raceIds.length}レース`,
  );
  if (racerIds.length === 0)
    throw new Error(
      `main: ${activeFrom} 以降に出走表に載った選手が0人（出走表の取り込みが止まっている可能性）`,
    );

  let written = 0;
  let deleted = 0;
  let rows = 0;
  let boatRows = 0;
  let maxRaceDate = null;
  let done = 0;
  for (const ids of chunk(racerIds, batchSize)) {
    if (shouldStop()) break;
    const result = await computeCounts(client, {
      era: "main",
      from: MAIN_TABLES_START,
      to,
      racerIds: ids,
      inputs,
    });
    const acc = mergeCareerResult(new Map(), result, "main");
    const res = await writeCareerRows(client, {
      era: "main",
      acc,
      racerIds: ids,
      dryRun,
      allowMassDelete,
    });
    written += res.written;
    deleted += res.deleted;
    rows += res.rows;
    boatRows += Number(result.boat_rows ?? 0);
    if (
      result.max_race_date &&
      (!maxRaceDate || result.max_race_date > maxRaceDate)
    )
      maxRaceDate = result.max_race_date;
    done += ids.length;
  }
  const complete = done === racerIds.length;
  if (complete) {
    // 全選手を計算し直した時刻（初回の CLI --all）は、毎晩の部分の計算で消さずに持ち越す。
    // 画面は full_computed_at が無い main 層を「未計算」として扱う
    const { data: prevMeta, error: prevErr } = await client
      .from("racer_career_meta")
      .select("report")
      .eq("era", "main")
      .maybeSingle();
    if (prevErr)
      throw new Error(`racer_career_meta の読み取りに失敗: ${prevErr.message}`);
    const fullComputedAt = all
      ? startedAt
      : (prevMeta?.report?.full_computed_at ?? null);
    await writeMeta(
      client,
      {
        era: "main",
        computed_at: startedAt,
        rule_version: RULE_VERSION,
        source_from: MAIN_TABLES_START,
        source_to: maxRaceDate,
        source_rows: boatRows,
        fingerprint: { racers: racerIds.length, all, active_from: activeFrom },
        report: {
          full_computed_at: fullComputedAt,
          overrides: inputs.overrides.report,
          final_stages: inputs.finalStages.length,
        },
      },
      { dryRun },
    );
  }
  return {
    racers: racerIds.length,
    done,
    complete,
    written,
    deleted,
    rows,
    boatRows,
    maxRaceDate,
  };
}

/**
 * main 層の毎晩の実行（api/cron/racer-career-main.js）。共通ラッパ（cronWrapper.js）の run() の契約で返す。
 * @param {{client: object, today: string, dryRun: boolean, shouldStop?: () => boolean, log?: (s: string) => void}} opts
 */
export async function runRacerCareerMainJob({
  client,
  today,
  dryRun,
  shouldStop = () => false,
  log = console.log,
}) {
  if (!client) throw new Error("Supabase のクライアントが無い");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today)))
    throw new Error(`対象日が YYYY-MM-DD ではない: ${today}`);

  const res = await runMainEra({ client, today, dryRun, shouldStop, log });

  // kb 層の指紋の見張り（kb 層がまだ計算されていなければ、知らせるだけで失敗にしない）
  const { data: kbMeta, error } = await client
    .from("racer_career_meta")
    .select("fingerprint, computed_at")
    .eq("era", "kb")
    .maybeSingle();
  if (error)
    throw new Error(`racer_career_meta の読み取りに失敗: ${error.message}`);
  const now = await kbFingerprint(client);
  const kbState = !kbMeta
    ? "not_computed"
    : sameKbFingerprint(kbMeta.fingerprint, now)
      ? "same"
      : "changed";

  const report = {
    racers: res.racers,
    done: res.done,
    rows: res.rows,
    deleted: res.deleted,
    boatRows: res.boatRows,
    maxRaceDate: res.maxRaceDate,
    kb: { state: kbState, now, computedAt: kbMeta?.computed_at ?? null },
  };
  log(`racer_career_main: ${JSON.stringify(report)}`);

  if (kbState === "changed") {
    return {
      outcome: "error",
      error: `kb_archive が kb 層の計算（${kbMeta.computed_at}）の後に変わった（今 ${JSON.stringify(now)}、記録 ${JSON.stringify(kbMeta.fingerprint)}）。racer-career-backfill.js --era=kb を再実行する`,
      rowsWritten: res.written,
      report,
    };
  }
  return {
    outcome: "ok",
    rowsWritten: res.written,
    // 「変更なしで書き込み0件」は正常。集計の行が1行以上あるはずなので rowsExpected は定数 1
    rowsExpected: 1,
    rowsParsed: res.rows,
    // 時間切れで全選手を終えていなければ、補足の起動（01:00 JST）がもう一度処理する
    incomplete: !res.complete,
    report,
  };
}
