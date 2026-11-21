/**
 * scrape-exhibition-data.js の部品。公式ページの解析結果から展示の行を組み立て、
 * レースごとの outcome を決める（DB の読み書きは upsertExhibitionRows だけ。順・文は元のまま）。
 */
import { VENUE_NAMES } from "./supabaseClient.js";
import { buildExhibitionRows } from "./preRaceRows.js";
import { PRE_RACE_OPTIONAL_COLUMN_GROUPS } from "./preRaceSchema.js";
import { upsertChangedRows } from "./unchangedRows.js";
import { computeExhibitionDigest } from "./scrapeJobs/preRaceDigest.js";

const BOA221_COLUMNS = [
  "tilt",
  "propeller_change",
  "parts_changed",
  "adjustment_weight",
];
const BOA289_COLUMNS = [
  "today_weight",
  "prev_race_no",
  "prev_entry_course",
  "prev_start_timing",
  "prev_finish_rank",
];

/**
 * 直前情報の解析結果（parseBeforeInfoDocument の page）を、旧実装と同じ形の展示データに写す。
 * 展示タイム・展示STのどちらも無いページは data=null（reason に理由）
 */
export function toLegacyExhibition(page, tbodiesCount = 0) {
  if (page.tables_count < 2) {
    return { data: null, reason: `tables_lt_2 (found ${page.tables_count})` };
  }
  if (page.boats.length === 0) {
    return { data: null, reason: `no_boats (tbodies=${tbodiesCount})` };
  }
  const data = page.boats.map((b) => {
    const entry = {
      boatNumber: b.boat_number,
      exhibitionTime: b.exhibition_time,
      startTiming: null,
      tilt: b.tilt,
      propellerChange: b.propeller_text,
      partsChanged: b.parts_changed.length > 0 ? b.parts_changed : null,
      adjustmentWeight: b.adjustment_weight,
      todayWeight: b.weight_kg,
      prevRaceNo: b.prev_race_no,
      prevEntryCourse: b.prev_entry_course,
      prevStartTiming: b.prev_start_timing,
      prevFinishRank: b.prev_finish_rank,
      exhibitionCourse: b.exhibition_course,
      startFlag: b.start_flag,
      prevFinishMark: b.prev_finish_mark,
      isAbsent: b.is_absent,
    };
    // 旧実装と同じく、STの数値が読めた艇だけに、展示STとフライング有無を持たせる
    if (b.start_timing !== null) {
      entry.startTiming = b.start_timing;
      entry.isFlying = b.start_flag === "F";
    }
    return entry;
  });
  if (!data.some((e) => e.exhibitionTime !== null || e.startTiming !== null)) {
    return { data: null, reason: `no_values (boats=${data.length})` };
  }
  return { data, reason: null };
}

/** exhibition_data へ、値の変わった行と新しい行だけを書く（dryRun は書かない） */
export function upsertExhibitionRows(client, rows, { dryRun = false } = {}) {
  return upsertChangedRows(client, "exhibition_data", rows, {
    onConflict: "race_id,boat_number",
    keyColumns: ["race_id", "boat_number"],
    label: "exhibition_data",
    dryRun,
    stampUpdatedAt: true,
    optionalColumnGroups: {
      "マイグレーション056（BOA-221）": BOA221_COLUMNS,
      "マイグレーション059（BOA-289）": BOA289_COLUMNS,
      ...PRE_RACE_OPTIONAL_COLUMN_GROUPS.exhibition,
    },
  });
}

// ---------------------------------------------------------------------------
// scrapeAndUpsertRaces（run の経路）の部品
// ---------------------------------------------------------------------------

/** 対象レースを会場ごとにまとめる（会場の順は targets の出現順） */
export function groupTargetsByVenue(targets) {
  const byVenue = new Map();
  for (const r of targets) {
    if (!byVenue.has(r.venue_code)) byVenue.set(r.venue_code, []);
    byVenue.get(r.venue_code).push(r);
  }
  return byVenue;
}

/**
 * 1会場の取得結果を allRows（展示の行）と weatherFetched（気象の反映対象）に足し、取得できたレース数を返す。
 * 気象は、展示データが未公開でも、ページを取得できたレースは対象
 */
export function absorbVenueResults(
  results,
  { venueCode, extended, allRows, weatherFetched },
) {
  const venueName = VENUE_NAMES[venueCode];
  let venueFetched = 0;
  for (const { raceId, startTime, data, reason, conditions, page } of results) {
    const raceNo = raceId.split("-")[4];
    if (conditions) {
      weatherFetched.push({ raceId, venueCode, startTime, conditions });
    }
    if (data) {
      // 展示タイム・展示STのある艇の行を書く（旧実装と同じ）。082適用済みなら、展示進入・F/L・前走の着順の
      // 生表記・欠場（欠場艇の行を含む）も書く（scripts/lib/preRaceRows.js）
      allRows.push(...buildExhibitionRows(raceId, page.boats, { extended }));
      venueFetched++;
    } else {
      console.log(
        `  ⚠️ ${venueName} ${parseInt(raceNo)}R: データなし (${reason})`,
      );
    }
  }
  if (venueFetched > 0) {
    console.log(`  ✅ ${venueName}: ${venueFetched}R 取得`);
  }
  return venueFetched;
}

// ---------------------------------------------------------------------------
// runForRaces（Vercel Cron の予定表スロット）の部品
// ---------------------------------------------------------------------------

export const OUTCOME_BASE = Object.freeze({
  rowsWritten: 0,
  rowsParsed: 0,
  rowsExpected: 1,
  changed: false,
});

/** 展示タイム・展示STまで取得済みのレースを skipped_have_data にする（live と窓の外の補完） */
export function markHaveData(outcomes, data) {
  for (const row of data ?? []) {
    outcomes.set(row.race_id, {
      ...OUTCOME_BASE,
      outcome: "skipped_have_data",
    });
  }
}

/**
 * 取得・解析の結果をレースごとに振り分ける。取得できなかったレースは outcomes に入れ、
 * 行を作れたレースは rowsByRace に、ページを取得できたレースの気象は weatherFetched に入れる
 */
export function classifyFetched(fetched, outcomes, { startOf, extended }) {
  const rowsByRace = new Map();
  const weatherFetched = [];
  for (const { race, detail } of fetched) {
    if (detail.status === "breaker_open") {
      outcomes.set(race.race_id, {
        ...OUTCOME_BASE,
        outcome: "breaker_open",
        retryAt: detail.retryAt,
        error: detail.error,
      });
      continue;
    }
    if (detail.status !== "ok") {
      outcomes.set(race.race_id, {
        ...OUTCOME_BASE,
        outcome: "error",
        error: `直前情報を取得できませんでした: ${detail.error}`,
      });
      continue;
    }
    // 気象は、展示が未公開でも、ページを取得できたレースは対象（従来の run と同じ）
    if (detail.conditions) {
      weatherFetched.push({
        raceId: race.race_id,
        venueCode: race.venue_code,
        startTime: startOf.get(race.race_id) ?? null,
        conditions: detail.conditions,
      });
    }
    // 展示が未公開（detail.data が null）でも、当日体重・調整重量だけは公開されていることがある（BOA-500）。
    // その場合 buildExhibitionRows（extended）が展示前の行を返すので、書いて残す。展示タイム・チルトは
    // 後の窓（-33）で同じ行に埋まる。1行も作れないときだけ no_values（従来どおり再試行）
    const rows = buildExhibitionRows(race.race_id, detail.page.boats, {
      extended,
    });
    if (rows.length === 0) {
      outcomes.set(race.race_id, {
        ...OUTCOME_BASE,
        outcome: "no_values",
        error: `展示データが未公開です（${detail.reason}）`,
      });
      continue;
    }
    rowsByRace.set(race.race_id, rows);
  }
  return { rowsByRace, weatherFetched };
}

const hasWeightRow = (rows) =>
  rows.some((row) => row.today_weight != null || row.adjustment_weight != null);

/** 行を作れた1レースの outcome（書き込みの結果と行の中身で決める） */
export function exhibitionOutcome(rows, { written, write, weightOnly }) {
  const common = {
    ...OUTCOME_BASE,
    rowsParsed: rows.length,
    rowsWritten: written,
    changed: written > 0,
    resultDigest: computeExhibitionDigest(rows),
  };
  if (write?.error) {
    return {
      ...common,
      outcome: "error",
      error: `展示データの書き込みに失敗しました: ${write.error.message}`,
    };
  }
  if (rows.some((row) => row.exhibition_time != null)) {
    return { ...common, outcome: "ok" };
  }
  if (weightOnly && hasWeightRow(rows)) {
    // 体重だけの窓: 展示前に取れるもの（当日体重・調整重量）が取れたので完了。展示タイムは -33 の窓が取る
    return { ...common, outcome: "ok" };
  }
  // 展示タイムが未公開。書いた行（展示STだけ、または展示前の当日体重・調整重量だけ）は残し、
  // 展示タイムが入るまで再試行する
  const hasSt = rows.some((row) => row.start_timing != null);
  return {
    ...common,
    outcome: "partial",
    error: hasSt
      ? "展示タイムが未公開です（展示STのみ）"
      : hasWeightRow(rows)
        ? "展示タイムが未公開です（展示前の当日体重・調整重量のみ）"
        : "展示タイム・当日体重が未公開です（欠場艇の行のみ）",
  };
}

/**
 * 書き込みの結果を outcomes に反映する。shadow（live でない）は書いていないので rowsWritten は 0。
 * 気象も予測の入力（イン崩れ指数の風速・波高）のため、書き込んだレースは changed にする
 */
export function settleOutcomes(
  outcomes,
  rowsByRace,
  { write, live, weightOnly, weather },
) {
  const writtenByRace = new Map();
  if (live && write && write.written > 0) {
    for (const row of write.toWrite) {
      writtenByRace.set(row.race_id, (writtenByRace.get(row.race_id) ?? 0) + 1);
    }
  }
  for (const [raceId, rows] of rowsByRace) {
    outcomes.set(
      raceId,
      exhibitionOutcome(rows, {
        written: writtenByRace.get(raceId) ?? 0,
        write,
        weightOnly,
      }),
    );
  }
  for (const raceId of weather?.changedRaceIds ?? []) {
    const outcome = outcomes.get(raceId);
    if (outcome) outcomes.set(raceId, { ...outcome, changed: true });
  }
}
