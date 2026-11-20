import { upsertChangedRows } from "./unchangedRows.js";
import { halfMonthRanges, kbYearRanges } from "./racerCareerSeries.js";
import {
  computeCounts,
  existingChunkSize,
  fetchExistingKeys,
  kbFingerprint,
  loadJudgeInputs,
  OTHER_ERA_MAX_ROWS,
  PAGE_ROWS,
  sameKbFingerprint,
  writeMeta,
} from "./racerCareerDb.js";
import { KB_FIRST_DATE, KB_LAST_DATE } from "./kbArchiveBoundary.js";

/** 判定の規則の版。優勝戦は isFinalStage の v2＋2つの名前（kb2）・グレードの補正 v2（class_code の読み替え）・着のコードの体系 v1。規則を変えたら上げ、kb を計算し直す */
export const RULE_VERSION = "career-v2(stage-v2+kb2,grade-v2,code-v1)";

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

/** 選手の一覧を size 人ずつに分ける */
export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * 層の行を書き、新しい計算に無いセルを消す。racerIds を渡すとその選手だけを置き換える（main の毎晩）。
 * 4表とも、消すセルを先に決めて多すぎないかを見てから書く（大量に消す判定で途中の表まで書いて止まらない）。
 * 書き込みの途中の失敗（通信・読みの上限）では表の間がそろわないまま残る。次の計算し直し（main は次の晩、kb は CLI の再実行）でそろう。
 * @returns {Promise<{written: number, deleted: number, rows: number, perTable: object}>}
 */
export async function writeCareerRows(
  client,
  { era, acc, racerIds = null, dryRun, allowMassDelete = false, upsertBatchRacers = 100 },
) {
  const plans = await planCareerWrites(client, { era, acc, racerIds, allowMassDelete });

  let written = 0;
  let deleted = 0;
  let rows = 0;
  const perTable = {};
  for (const { spec, incoming, stale, existing } of plans) {
    rows += incoming.length;
    const tableWritten = await upsertCareerTable(client, {
      spec,
      incoming,
      existing,
      era,
      dryRun,
      upsertBatchRacers,
    });
    if (!dryRun) await deleteStaleCells(client, spec, stale);
    written += tableWritten;
    deleted += stale.length;
    perTable[spec.table] = { rows: incoming.length, written: tableWritten, stale: stale.length };
  }
  return { written, deleted, rows, perTable };
}

/** 4表の今ある行と消えるセルを先に読み、消えるセルが多すぎる表があれば書く前に止める */
async function planCareerWrites(client, { era, acc, racerIds, allowMassDelete }) {
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
    plans.push({ spec, incoming, stale, existing });
  }
  return plans;
}

/** 1表の新しい行を、選手 upsertBatchRacers 人ずつ書く（既存行の読み取りは選手の数だけ並列に投げるため）。書いた行数を返す */
async function upsertCareerTable(client, { spec, incoming, existing, era, dryRun, upsertBatchRacers }) {
  const byRacer = new Map();
  for (const r of incoming) {
    if (!byRacer.has(r.racer_id)) byRacer.set(r.racer_id, []);
    byRacer.get(r.racer_id).push(r);
  }
  let tableWritten = 0;
  for (const ids of chunk([...byRacer.keys()], upsertBatchRacers)) {
    const batch = ids.flatMap((id) => byRacer.get(id));
    const idSet = new Set(ids);
    const res = await upsertChangedRows(client, spec.table, batch, {
      onConflict: spec.keyColumns.join(","),
      keyColumns: spec.keyColumns,
      chunkColumn: "racer_id",
      chunkSize: existingChunkSize(
        batch,
        OTHER_ERA_MAX_ROWS[spec.table] ?? 0,
        existing.filter((r) => idSet.has(r.racer_id)),
      ),
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
  return tableWritten;
}

/** 新しい計算に無いセルを1つずつ消す */
async function deleteStaleCells(client, spec, stale) {
  for (const key of stale) {
    let q = client.from(spec.table).delete();
    for (const c of spec.keyColumns) q = q.eq(c, key[c]);
    const { error } = await q;
    if (error)
      throw new Error(`${spec.table} の古いセルの削除に失敗: ${error.message}`);
  }
}

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
  const years = kbYearRanges();
  const fingerprintBefore = await kbFingerprint(client);
  log(`kb_archive の指紋: ${JSON.stringify(fingerprintBefore)}`);
  const inputs = await loadJudgeInputs({ client, era: "kb", ranges: years });
  log(
    `優勝戦の種別 ${inputs.finalStages.length}/${inputs.stageCount}、グレードの補正 ${inputs.overrides.raceIds.length}レース`,
  );
  for (const r of inputs.overrides.report) log(`  補正: ${JSON.stringify(r)}`);
  assertSeedsFound(inputs.overrides.report);

  const { acc, boatsByYear, maxRaceDate } = await computeKbCounts(client, inputs, log);
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

/** kb は終わった節だけなので、基準のレースが見つからない節があれば止める */
function assertSeedsFound(report) {
  const missingSeed = report.filter((r) => r.seedMissing);
  if (missingSeed.length > 0)
    throw new Error(
      `グレードの補正: 基準のレースが見つからない節がある（${missingSeed.map((r) => `${r.rule} ${r.venueDays[0]}〜`).join("、")}）。節の作りが変わった可能性がある`,
    );
}

/** 2つの日付の遅い方（next が無ければ cur） */
const laterRaceDate = (cur, next) =>
  next && (!cur || next > cur) ? next : cur;

/** kb の全期間を半月ずつ数えて足し合わせる */
async function computeKbCounts(client, inputs, log) {
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
    maxRaceDate = laterRaceDate(maxRaceDate, result.max_race_date);
    log(
      `  ${r.from}〜${r.to}: 艇 ${result.boat_rows} 行（${Date.now() - t0}ms）`,
    );
  }
  return { acc, boatsByYear, maxRaceDate };
}

export { laterRaceDate };
