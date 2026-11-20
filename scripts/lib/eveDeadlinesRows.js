/**
 * 前夜の締切予定（eveDeadlinesJob.js）の純な部分: 書く行・優勝戦の判定・raceindex の振り分け・通知・戻り値。
 * DB にも公式にも触れない（読み書きと取得は eveDeadlinesJob.js）
 */
import {
  isFinalRaceName,
  isLastDayLabel,
  parseRaceIndex,
  raceIndexProblems,
} from "./raceIndexParser.js";

/** 最終日の会場で、レース名を取る R（優勝戦は12Rとは限らない。下関 2026-11-04 は11R、男女W優勝戦は2つ） */
export const FINAL_CANDIDATE_RACES = [12, 11, 10];

/** DB の time（"15:45:00"）・解析の "15:45" を分の単位にそろえる */
export const hhmm = (t) => (typeof t === "string" ? t.slice(0, 5) : null);

/**
 * 優勝戦か。最終日でなければ false。最終日の候補（12・11・10R）でない R も false（優勝戦は10R より前に無い前提）。
 * 候補で名前が取れていなければ NULL（未確認）。日の札が分からなければ NULL
 */
export function eveIsFinal(dayLabel, raceNumber, raceName) {
  return dayLabel == null
    ? null
    : !isLastDayLabel(dayLabel) || !FINAL_CANDIDATE_RACES.includes(raceNumber)
      ? false
      : raceName == null
        ? null
        : isFinalRaceName(raceName);
}

/** eve_race_deadlines の1行 */
export function eveRow({
  id,
  date,
  v,
  r,
  dayLabel,
  raceName,
  isFinal,
  old,
  nowIso,
  changed,
}) {
  return {
    race_id: id,
    race_date: date,
    venue_code: v.venueCode,
    race_number: r.raceNumber,
    deadline: `${r.deadline}:00`,
    day_label: dayLabel,
    race_name: raceName,
    is_final: isFinal,
    first_fetched_at: old?.first_fetched_at ?? nowIso,
    updated_at: nowIso,
    deadline_changes: (old?.deadline_changes ?? 0) + (changed ? 1 : 0),
  };
}

/** 既存の行と値が同じか（同じなら書かない） */
export function isSameEveRow(old, changed, row) {
  return (
    old &&
    !changed &&
    old.day_label === row.day_label &&
    old.race_name === row.race_name &&
    old.is_final === row.is_final
  );
}

/** 1会場の raceindex を解析する。解析できなければ {reason}、できれば {parsed} */
export function parseVenueIndex(html) {
  let parsed;
  try {
    parsed = parseRaceIndex(html);
  } catch (e) {
    return { reason: `parse: ${e.message}` };
  }
  return { parsed };
}

/** 解析できた1会場を、開催なし・並びの異常・race_series に無い会場に振り分けて out に足す */
export function acceptVenueIndex(
  out,
  { venueCode, parsed, isKnown, expected },
) {
  if (!isKnown && parsed.races.length === 0) return; // 開催なし
  const problems = raceIndexProblems(parsed.races);
  if (problems.length) {
    // 並びがおかしい結果は書かない（解析の誤りを前夜の投稿に出さない）。開催の分かっている会場は失敗（incomplete）、
    // race_series に無い会場は次の起動で取らないので、失敗に数えず通知だけにする
    const reason = `parse_anomaly: ${problems[0]}`;
    if (isKnown) out.failed.push({ venueCode, reason });
    else out.unexpectedAnomalies.push({ venueCode, reason });
    return;
  }
  if (!expected.includes(venueCode)) out.unexpected.push(venueCode);
  out.venues.push({ venueCode, ...parsed });
}

/** 通知（race_series に無い会場・締切の変更・最後の起動で取れなかった会場） */
export function eveAlerts({
  date,
  rows,
  changedIds,
  finalRound,
  failed,
  notAttempted,
  unexpected,
  unexpectedAnomalies,
}) {
  const alerts = [];
  const until = new Date(`${date}T12:00:00+09:00`).toISOString();
  if (unexpected.length || unexpectedAnomalies.length)
    alerts.push({
      key: `unexpected:${date}`,
      text: `race_series に節が無い会場で翌日（${date}）のレースがあった: 会場 ${[...unexpected.map(String), ...unexpectedAnomalies.map((u) => `${u.venueCode}（${u.reason}、書いていない）`)].join("・")}。race_series の欠けの疑い`,
      until,
    });
  const byId = new Map(rows.map((r) => [r.race_id, r]));
  // 変わったレースごとに key を分ける（同じ key は monitor が renotifyHours の間抑えるので、2件目以降が出なくなる）
  for (const id of changedIds)
    alerts.push({
      key: `changed:${id}`,
      text: `前夜の取得の間で締切が変わった: ${id} → ${hhmm(byId.get(id).deadline)}`,
      until,
    });
  if (finalRound && (failed.length || notAttempted.length))
    alerts.push({
      key: `failed:${date}`,
      text: `前夜の最後の起動で翌日（${date}）の締切が取れなかった会場: ${[...failed.map((f) => `${f.venueCode}（${f.reason}）`), ...notAttempted.map((c) => `${c}（未着手）`)].join("、")}`,
      until,
    });
  return alerts;
}

/** runEveDeadlinesJob の戻り値（節も raceindex のレースも無ければ error） */
export function eveJobResult({
  date,
  known,
  venues,
  report,
  finalRound,
  failed,
  notAttempted,
  namesMissing,
}) {
  const rowsParsed = venues.reduce((a, v) => a + v.races.length, 0);
  if (known.length === 0 && rowsParsed === 0) {
    return {
      outcome: "error",
      error: `翌日（${date}）の節が race_series に無く、24場の raceindex にもレースが無かった`,
      report,
    };
  }
  return {
    rowsWritten: report.rowsWritten,
    rowsParsed,
    rowsExpected: known.length,
    report,
    body: report,
    // 最後の起動（finalRunAfterJst 以後）より前は済みにしない（4回とも取る）。最後でも取れなかった会場・名前があれば済みにしない
    incomplete:
      !finalRound ||
      failed.length > 0 ||
      notAttempted.length > 0 ||
      namesMissing.length > 0,
  };
}
