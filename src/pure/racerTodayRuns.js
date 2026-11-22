// 選手ページの「今日の出走」の行を組む（BOA-1691 R2）。取得は racerQueries6.js の getRacerTodayRuns
import { VENUE_NAMES } from "../config/venueRules.js";
import { parseRaceId } from "./raceId.js";

/** race_id（YYYY-MM-DD-VV-RR）から日付・場名・R。形式が違えば null */
export function splitTodayRaceId(raceId) {
  const parsed = parseRaceId(raceId);
  if (!parsed) return null;
  const code = String(parsed.venueCode).padStart(2, "0");
  return { ...parsed, venueName: VENUE_NAMES[code] ?? `会場${parsed.venueCode}` };
}

/**
 * 発走済みの走の札。着順に艇番があれば「n着」。無ければ公式の略:
 * 不成立のレースは「不成立」、返還艇（F・L・欠。refund_boats では3つを分けられない）は「返還」、
 * どちらでもなければ（落・転・妨 等、または未判定の行）「結果」
 */
export function finishLabelOf(result, boatNumber) {
  if (!result) return null;
  if (result.race_status === "no_race") return "不成立";
  const refunded = (result.refund_boats ?? []).map(Number).includes(Number(boatNumber));
  if (refunded) return "返還";
  for (let rank = 1; rank <= 6; rank++) {
    if (Number(result[`rank${rank}`]) === Number(boatNumber)) return `${rank}着`;
  }
  return "結果";
}

/** 当日（today、JST の YYYY-MM-DD）の走だけを race_id の昇順で返す。各行は {raceId, venueName, raceNo, boatNumber, deadline, finish, seriesDay} */
export function buildRacerTodayRuns({ today, entries, races, results, conditions }) {
  const byId = (rows) => new Map((rows ?? []).map((r) => [r.race_id, r]));
  const [raceMap, resultMap, conditionMap] = [byId(races), byId(results), byId(conditions)];
  return (entries ?? [])
    .map((entry) => ({ entry, id: splitTodayRaceId(entry.race_id) }))
    .filter(({ id }) => id && id.date === today)
    .sort((a, b) => a.entry.race_id.localeCompare(b.entry.race_id))
    .map(({ entry, id }) => ({
      raceId: entry.race_id,
      venueName: id.venueName,
      raceNo: id.raceNo,
      boatNumber: Number(entry.boat_number),
      deadline: raceMap.get(entry.race_id)?.start_time?.slice(0, 5) ?? null,
      finish: finishLabelOf(resultMap.get(entry.race_id), entry.boat_number),
      seriesDay: conditionMap.get(entry.race_id)?.series_day ?? null,
    }));
}

/** 見出しの横の「<場> n日目」。日目が無ければ null（出さない） */
export function todayRunsMeetLabel(runs) {
  const first = runs.find((r) => r.seriesDay != null);
  return first ? `${first.venueName} ${first.seriesDay}日目` : null;
}
