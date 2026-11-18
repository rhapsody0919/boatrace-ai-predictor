/**
 * レース情報の集計（update-race-info.js から分けた純粋関数）: 取得の結果を、書く行（中止・締切・条件・出走表）にためる・
 * 1件の結果を作る。DB には触れない（読み書きは update-race-info.js）
 */
import { VENUE_NAMES } from "./venueNames.js";
import { computeCancellationTransition } from "./cancellationStatus.js";
import {
  buildRaceConditionRow,
  buildRaceEntryRows,
  planDeadlineUpdates,
} from "./preRaceRows.js";
import { computeRaceInfoDigest } from "./scrapeJobs/preRaceDigest.js";

export function createAccumulator() {
  return {
    entriesRows: [],
    conditionsRows: [],
    weatherFetched: [],
    racesGradeUpdates: [],
    cancellationUpdates: [],
    // 出走表の締切予定時刻による races.start_time の更新（race_id で重複を除く）
    deadlineUpdates: new Map(),
    // レースごとの、書く行（shadow のダイジェスト用）
    perRace: new Map(),
  };
}

/**
 * 中止・順延の暫定検知（BOA-254 FR1）: data有無に関わらず全レース分計算する。
 * 現在の状態の取得自体に失敗している場合、全レースがcancellationMapに
 * 存在しない=デフォルト値（null/0）にフォールバックしてしまい、既に
 * tentativeへ昇格済みのレースのstreakを誤ってリセットする恐れがあるため、
 * その回はまるごと計算をスキップする（cancellationFetchErrorのログ通り）
 */
function accumulateCancellation(
  acc,
  r,
  { cancellationCheck, cancellationMap, cancellationFetchError },
) {
  if (!cancellationFetchError && cancellationCheck !== "skip") {
    const cancellationCurrent = cancellationMap.get(r.race_id) || {
      cancellation_status: null,
      cancellation_check_streak: 0,
    };
    const cancellationNext = computeCancellationTransition({
      currentStatus: cancellationCurrent.cancellation_status,
      currentStreak: cancellationCurrent.cancellation_check_streak,
      racersFound: cancellationCheck === "found",
    });
    if (cancellationNext.changed) {
      acc.cancellationUpdates.push({
        race_id: r.race_id,
        cancellation_status: cancellationNext.nextStatus,
        cancellation_check_streak: cancellationNext.nextStreak,
      });
    }
  }
}

/** 欠場検出: 出走表で欠場の表示（tbody の is-miss）の艇、または登録番号を読めない艇と、出走表の異常をログに出す */
function warnEntryAnomalies(page, r, venueName) {
  const absentBoats = page.entries
    .filter((e) => e.is_absent || e.racer_id === null)
    .map((e) => e.boat_number);
  if (absentBoats.length > 0) {
    console.warn(
      `  ⚠️ ${venueName} ${r.race_no}R 欠場/代替の可能性: ${absentBoats.map((b) => `${b}号艇`).join(", ")}`,
    );
  }
  for (const anomaly of page.anomalies) {
    console.warn(`  ⚠️ ${venueName} ${r.race_no}R 出走表: ${anomaly}`);
  }
}

/**
 * race_conditions の行を足す（気象・節・レース名のどれかが取れたレース）。
 * 気象の列（と観測時刻）は、書き込みの直前にまとめて作る（flushRaceInfo の buildWeatherRows。展示取得と
 * 同じ規則）。気象を取得できなかったレースは、気象の列を含めず、既存の良い値を消さない
 *
 * 日目（series_day）は、ページの日別タブから読めなかったときだけ、節（race_series）から導いた値で補う
 * （BOA-501）。両方あって食い違うときは、ページ側を採り、食い違いを記録する: 節の途中に中止日があると
 * 公式は同じ日目を振り直すため、導出が1日ぶん進みすぎる（実測 3,064 会場×日で8件。raceSeriesLookup.js）
 */
function accumulateCondition(
  acc,
  perRace,
  r,
  { page, conditions },
  { conditionsExtended, includeWeather, seriesDayByVenue, venueName },
) {
  const fallbackSeriesDay = seriesDayByVenue?.get(r.venue_code) ?? null;
  if (
    page.meta.seriesDay != null &&
    fallbackSeriesDay != null &&
    page.meta.seriesDay !== fallbackSeriesDay
  ) {
    console.warn(
      `  ⚠️ ${venueName} ${r.race_no}R 日目: ページ=${page.meta.seriesDay}日目 / 節からの導出=${fallbackSeriesDay}日目。ページの値を採ります（順延・中止で節の日程がずれた可能性）`,
    );
  }
  const conditionRow = buildRaceConditionRow(r.race_id, page.meta, {
    extended: conditionsExtended,
    fallbackSeriesDay,
  });
  acc.conditionsRows.push(conditionRow);
  perRace.condition = conditionRow;
  if (includeWeather) {
    acc.weatherFetched.push({
      raceId: r.race_id,
      venueCode: r.venue_code,
      startTime: r.start_time,
      conditions,
    });
  }
}

/**
 * 1レース分の取得結果を、書き込む行・更新に変える（DBへは書かない）。
 *
 * @param {ReturnType<typeof createAccumulator>} acc
 * @param {Object} input
 * @param {{race_id: string, venue_code: number, race_no: number, start_time?: Date|null}} input.r
 * @param {{page: Object, conditions?: Object|null}|null} input.data 取得できなければ null
 * @param {"found"|"not_found"|"skip"} input.cancellationCheck 中止・順延の暫定検知に、今回の取得を数えるか。
 *   found=選手が取れた、not_found=ページは取れたが選手が0人、skip=数えない（通信の失敗等。streak を進めない）
 * @param {Map<number, number>|null} [input.seriesDayByVenue] 会場コード → 節から導いた日目（BOA-501）。
 *   ページの日別タブから日目を読めなかったときだけ使う
 */
export function accumulateRaceInfo(
  acc,
  {
    r,
    data,
    cancellationCheck,
    schedule,
    syncDeadlines,
    cancellationMap,
    cancellationFetchError,
    entriesExtended,
    conditionsExtended,
    includeWeather,
    seriesDayByVenue = null,
  },
) {
  accumulateCancellation(acc, r, {
    cancellationCheck,
    cancellationMap,
    cancellationFetchError,
  });

  if (!data) return;
  const { page, conditions } = data;
  const { raceGrade, raceTitle, raceStage } = page.meta;
  const venueName = VENUE_NAMES[r.venue_code];

  warnEntryAnomalies(page, r, venueName);

  // race_entries 行を構築（ai_score系は更新しない）
  const raceEntryRows = buildRaceEntryRows(r.race_id, page.entries, {
    extended: entriesExtended,
  });
  acc.entriesRows.push(...raceEntryRows);
  const perRace = { entries: raceEntryRows, condition: null, raceGrade };
  acc.perRace.set(r.race_id, perRace);

  // 締切予定時刻（同日12レース分）が races.start_time と違うレースは、start_time を更新する（N15）
  if (syncDeadlines) {
    const plan = planDeadlineUpdates(schedule, r.venue_code, page.deadlines);
    for (const update of plan.updates) {
      acc.deadlineUpdates.set(update.race_id, update);
    }
  }

  // race_conditions 行を構築（race_grade は除外、races テーブルで管理）
  // upsertは全カラムを書き込むため、判定条件にseriesDayの有無を含めると
  // 「conditions取得のみ失敗、seriesDayだけ成功」という再ポーリング時に
  // 既存の天候データをnullで上書きしてしまう。元の条件のまま変えない
  // （conditions取得はほぼ常に成功するため、seriesDay単独成功のレアケースを
  // 拾えなくても実害は小さい）
  if (conditions || raceTitle || raceStage) {
    accumulateCondition(acc, perRace, r, data, {
      conditionsExtended,
      includeWeather,
      seriesDayByVenue,
      venueName,
    });
  }

  // race_grade を races テーブルに記録（発走60分前の更新用）
  if (raceGrade) {
    acc.racesGradeUpdates.push({ race_id: r.race_id, race_grade: raceGrade });
  }
}

/** runForRaces の引数の検査（mode・date） */
export function assertRaceInfoRunArgs(mode, date) {
  if (mode !== "live" && mode !== "shadow") {
    throw new Error(`mode は live か shadow にしてください: ${mode}`);
  }
  if (!date) throw new Error("date（YYYY-MM-DD）が必要です");
}

/** runForRaces の取得の結果1件を、accumulateRaceInfo に渡すか、outcomes に失敗を入れる（DBへは書かない） */
export function applyFetchedRaceInfo(
  { race, detail },
  { acc, accOptions, startOf, outcomes, base, parsedRaceIds },
) {
  const r = {
    race_id: race.race_id,
    venue_code: race.venue_code,
    race_no: race.race_number,
    start_time: startOf.get(race.race_id) ?? null,
  };
  const accumulate = (data, cancellationCheck) =>
    accumulateRaceInfo(acc, { r, data, cancellationCheck, ...accOptions });
  if (detail.status === "ok") {
    accumulate(detail, "found");
    parsedRaceIds.push(race.race_id);
  } else if (detail.status === "no_entries") {
    // ページは取れたが選手が0人。中止・順延の暫定検知の連続回数を進める（run と同じ規則）
    accumulate(null, "not_found");
    outcomes.set(race.race_id, {
      ...base,
      outcome: "no_values",
      error: "出走表に選手がいません（中止・未公開の可能性）",
    });
  } else if (detail.status === "breaker_open") {
    outcomes.set(race.race_id, {
      ...base,
      outcome: "breaker_open",
      retryAt: detail.retryAt,
      error: detail.error,
    });
  } else {
    // 通信・HTTPエラー: 中止・順延の暫定検知には数えない（取得先の一時的な失敗を、中止と取り違えない）
    outcomes.set(race.race_id, {
      ...base,
      outcome: "error",
      error: `出走表を取得できませんでした: ${detail.error}`,
    });
  }
}

/** 解析できたレースの outcome（書き込みの失敗があれば error、他は ok） */
export function parsedRaceOutcome(perRace, raceId, { flushed, dryRun, base }) {
  const rowsWritten = dryRun ? 0 : (flushed.written.get(raceId) ?? 0);
  const common = {
    ...base,
    rowsParsed: perRace.entries.length,
    rowsWritten,
    changed: rowsWritten > 0,
    resultDigest: computeRaceInfoDigest(perRace),
  };
  return flushed.errors.length > 0
    ? {
        ...common,
        outcome: "error",
        error: `レース情報の書き込みに失敗しました: ${flushed.errors.join(" / ")}`,
      }
    : { ...common, outcome: "ok" };
}
