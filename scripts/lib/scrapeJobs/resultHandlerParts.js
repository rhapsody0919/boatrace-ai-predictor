/**
 * resultHandlers.js の catch-up（createResultCatchupRun）と Kファイル同期（createKFileSyncRun）の、
 * 同期の部品（DB・取得先・書き込みに触らない集計と組み立て）。
 *
 * await の段を増やさないため、ここには async を置かない（書き込みの順は resultHandlers.js の本体が持つ）。
 */
import { raceStartInstant } from "./time.js";
import { isCancellationConfirmed } from "../cancellationStatus.js";

/** scrape_slots の行の races（配列か1件）から、中止・順延の確定を見る */
const isConfirmedCancel = (row) => {
  const race = Array.isArray(row.races) ? row.races[0] : row.races;
  return isCancellationConfirmed(race?.cancellation_status);
};

/**
 * expired・cancelled_race のスロットの行から、再取得の候補の race_id（重複なし）と、
 * 確定中止のレース（取れればよい追加分。期待件数・未解決に入れない）の集合を作る
 */
export function catchupCandidates(rows) {
  const candidateIds = [...new Set((rows ?? []).map((row) => row.race_id))];
  const confirmedIds = new Set(
    (rows ?? []).filter(isConfirmedCancel).map((row) => row.race_id),
  );
  return { candidateIds, confirmedIds };
}

/**
 * runForRaces の結果の集計。期待件数・0件エラー・未解決は、確定中止でないレースだけで数える。
 * recoveredFromCancellation は、確定中止のレースのうち取り直して結果が取れたもの（2' が確定を外す）
 */
export function summarizeCatchupResults(results, confirmedIds) {
  const outcomes = {};
  for (const r of results) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
  const isObtained = (r) =>
    ["ok", "partial", "skipped_have_data"].includes(r.outcome);
  const primary = results.filter((r) => !confirmedIds.has(r.race_id));
  const obtained = primary.filter(isObtained).length;
  const rowsWritten = results.reduce((sum, r) => sum + (r.rowsWritten ?? 0), 0);
  const unresolved = primary
    .filter((r) => !["ok", "skipped_have_data"].includes(r.outcome))
    .map((r) => ({ race_id: r.race_id, outcome: r.outcome, error: r.error }));
  const recoveredFromCancellation = results
    .filter((r) => confirmedIds.has(r.race_id) && isObtained(r))
    .map((r) => r.race_id);
  return {
    outcomes,
    obtained,
    rowsWritten,
    unresolved,
    recoveredFromCancellation,
  };
}

/**
 * catch-up の読み取り（await は本体が行う。ここでは問い合わせを組んで返すだけ）。
 * 1) 対象日に expired になった結果のスロットと、確定中止で終端された（cancelled_race）スロット
 */
export function expiredResultSlots(client, date) {
  return client
    .from("scrape_slots")
    .select("race_id, races(cancellation_status)")
    .eq("job", "result")
    .eq("race_date", date)
    .or("status.eq.expired,outcome.eq.cancelled_race");
}

/** 2) 対象日の、発走時刻があり中止・順延の確定が付いていないレース（notConfirmed は or() の条件の字） */
export function racesWithoutConfirmedCancellation(client, date, notConfirmed) {
  return client
    .from("races")
    .select("race_id, start_time")
    .eq("race_date", date)
    .not("start_time", "is", null)
    .or(notConfirmed);
}

/** 4) 対象日の結果のスロットのうち、まだ pending・running のもの */
export function openResultSlots(client, date) {
  return client
    .from("scrape_slots")
    .select("race_id")
    .eq("job", "result")
    .eq("race_date", date)
    .in("status", ["pending", "running"]);
}

/** 読み取りの失敗を catch-up の例外にする */
export function catchupFetchError(what, error) {
  return new Error(`結果のcatch-up: ${what}に失敗しました: ${error.message}`);
}

/** 発走から afterMs を超えて結果の無いレースの race_id（中止・順延の確定の取りこぼし） */
export function overdueRaceIds(rows, date, nowMs, afterMs) {
  return (rows ?? [])
    .filter(
      (r) => nowMs - raceStartInstant(date, r.start_time).getTime() > afterMs,
    )
    .map((r) => r.race_id);
}

/** catch-up の run の戻り（report は last_report へ、body は HTTP の応答へ） */
export function catchupResult({
  date,
  mode,
  live,
  races,
  confirmedIds,
  summary,
  confirmed,
  clearedCancellations,
  hitFlags,
  openSlots,
}) {
  const {
    outcomes,
    obtained,
    rowsWritten,
    unresolved,
    recoveredFromCancellation,
  } = summary;
  return {
    rowsWritten: live ? rowsWritten : 0,
    rowsExpected: races.length - confirmedIds.size,
    rowsParsed: obtained,
    incomplete: openSlots > 0,
    report: {
      date,
      mode,
      candidates: races.length,
      retriedConfirmedCancellations: confirmedIds.size,
      recoveredFromCancellation,
      outcomes,
      unresolved,
      confirmedCancellations: confirmed,
      clearedCancellations,
      hitFlags,
      openSlots,
    },
    body: {
      candidates: races.length,
      retriedConfirmedCancellations: confirmedIds.size,
      recoveredFromCancellation: recoveredFromCancellation.length,
      outcomes,
      confirmedCancellations: confirmed,
      clearedCancellations: clearedCancellations?.length ?? null,
      hitFlags,
      openSlots,
    },
  };
}

/** syncKFileForDate の結果を、監視（last_report）に出す項目の列にする */
export function kfileParts(r) {
  return [
    ["進入コース", r.actualCourse],
    ["rank4〜6", r.rank456],
    // 成績コード（マイグレーション116、BOA-553）。監視（last_report）から件数と状態が見えるようにする
    ...(r.officialFinishCode ? [["成績コード", r.officialFinishCode]] : []),
  ];
}

/** その日の項目から、失敗の文（problems）と、Kファイルが未公開（404）だったか（unavailable）を出す */
export function kfileDayProblems(date, parts) {
  const problems = [];
  let unavailable = false;
  for (const [label, part] of parts) {
    if (
      part.status === "kfile_error" ||
      part.status === "pending_check_failed"
    ) {
      problems.push(
        `${date} ${label}: ${part.status}（${part.error ?? "理由不明"}）`,
      );
    } else if (part.status === "no_races_parsed") {
      problems.push(
        `${date} ${label}: Kファイルからレースを抽出できませんでした`,
      );
    } else if (part.status === "column_missing") {
      // 116 は適用済み。列が無いのは、DB の状態が想定と違う（書き込みが止まっている）
      problems.push(`${date} ${label}: 列が見つかりません（column_missing）`);
    } else if (part.status === "kfile_unavailable") {
      unavailable = true;
    }
  }
  return { problems, unavailable };
}

/**
 * 0件エラーの判定の材料: Kファイルをダウンロードできた日（synced・no_races_parsed）を期待に数え、
 * レースを抽出できた日（synced）を解析に数える
 */
export function kfileDayCounts(parts) {
  const downloaded = parts.some(([, p]) =>
    ["synced", "no_races_parsed"].includes(p.status),
  );
  const synced = parts.some(([, p]) => p.status === "synced");
  return { downloaded, synced };
}

/** live のときに rowsWritten へ足す件数（進入コース＋rank4〜6＋成績コード） */
export function kfileUpdatedCount(r) {
  return (
    (r.actualCourse.updated ?? 0) +
    (r.rank456.updated ?? 0) +
    (r.officialFinishCode?.updated ?? 0)
  );
}

/** その日の要約（report.days の1件） */
export function kfileDaySummary(date, r) {
  return {
    date,
    downloads: r.downloads,
    actualCourse: {
      status: r.actualCourse.status,
      updated: r.actualCourse.updated,
    },
    rank456: {
      status: r.rank456.status,
      updated: r.rank456.updated,
      pending: r.rank456.pending,
    },
    ...(r.officialFinishCode
      ? {
          officialFinishCode: {
            status: r.officialFinishCode.status,
            updated: r.officialFinishCode.updated,
            pending: r.officialFinishCode.pending,
          },
        }
      : {}),
  };
}

/** Kファイル同期の run の戻り（失敗の日があれば outcome error） */
export function kfileSyncResult({
  base,
  mode,
  days,
  unpublished,
  problems,
  rowsWritten,
  rowsExpected,
  rowsParsed,
}) {
  const report = { base, mode, days, unpublished, problems };
  if (problems.length > 0) {
    return {
      outcome: "error",
      error:
        `Kファイル同期に失敗した日があります: ${problems.join(" / ")}`.slice(
          0,
          480,
        ),
      rowsWritten,
      report,
    };
  }
  return {
    rowsWritten,
    rowsExpected,
    rowsParsed,
    incomplete: unpublished.length > 0,
    report,
    body: { days: days.length, unpublished },
  };
}
