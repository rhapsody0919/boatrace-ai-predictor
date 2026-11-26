// 領域: racer。選手の推移の線の下の段（節ごとのモーターの号機と会場内順位。レーン B の after B）の読み

import { supabase } from "./supabaseClient";
import { chunkArray, withCache } from "./core.js";
import { meetMotorBand, racerMeetsOf } from "../pure/racerMeetMotors.js";

// PostgREST が1回に返す行の上限
const PAGE = 1000;

// その選手の走の出走表の行。推移の点は60走までで、1000行に届かない
async function fetchOwnEntries(racerId, raceIds) {
  const pages = await Promise.all(
    chunkArray(raceIds, 150).map((chunk) =>
      supabase
        .from("race_entries")
        .select("race_id, motor_number, motor_2rate")
        .eq("racer_id", racerId)
        .in("race_id", chunk),
    ),
  );
  return new Map(
    pages
      .flatMap(({ data }) => data ?? [])
      .map((e) => [e.race_id, { motorNumber: e.motor_number, motor2Rate: e.motor_2rate == null ? null : Number(e.motor_2rate) }]),
  );
}

// 会場の、節の初日から最終日までの出走表の全ての行のモーター2連率（1日72行、長い節でも1000行の輪で取り切る）
async function fetchMeetPool({ venue, start, end }) {
  const venuePart = String(venue).padStart(2, "0");
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase
      .from("race_entries")
      .select("race_id, boat_number, motor_2rate")
      .like("race_id", `____-__-__-${venuePart}-%`)
      .gte("race_id", start)
      .lte("race_id", `${end}-99`)
      .order("race_id")
      .order("boat_number")
      .range(from, from + PAGE - 1);
    const rows = data ?? [];
    out.push(...rows.map((r) => (r.motor_2rate == null ? null : Number(r.motor_2rate))));
    if (rows.length < PAGE) return out;
  }
}

/**
 * 推移の線の点（その選手の走）の節ごとの号機と会場内順位。失敗は例外のまま（「データなし」にしない）。
 * @param {string|number} racerId
 * @param {string[]} raceIds 推移の線の点の raceId（昇順）
 * @returns {Promise<ReturnType<typeof meetMotorBand>>}
 */
export function getRacerMeetMotors(racerId, raceIds) {
  if (!supabase) throw new Error("Supabase client not initialized");
  if (raceIds.length === 0) return Promise.resolve([]);
  return withCache(`racer-meet-motors-v1-${racerId}-${raceIds[0]}-${raceIds.at(-1)}-${raceIds.length}`, async () => {
    const meets = racerMeetsOf(raceIds);
    const [own, pools] = await Promise.all([fetchOwnEntries(racerId, raceIds), Promise.all(meets.map(fetchMeetPool))]);
    const poolByStart = new Map(meets.map((m, i) => [`${m.venue}-${m.start}`, pools[i]]));
    return meetMotorBand(raceIds, own, (m) => poolByStart.get(`${m.venue}-${m.start}`) ?? []);
  });
}
