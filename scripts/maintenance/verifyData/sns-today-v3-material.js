// verify-sns-today-v3.js の材料の組み立て（越えの単位を分けるため移した。verify ではない）
export const DATE = "2037-11-05";
export const id = (venue, r) =>
  `${DATE}-${String(venue).padStart(2, "0")}-${String(r).padStart(2, "0")}`;

/**
 * 材料の組み立て。venues: { code: { grade, title, kind, start, end, stage: {R: 段}, day: {R: 日目}, final: {R: bool}, times: {R: "HH:MM"}, cancelled } }
 * 選手は艇ごとに racer_id = code*1000 + R*10 + 艇番。率は stats で上書き（既定は足切りに届かない走数）
 */
export function material({
  venues,
  stats = [],
  absent = [],
  exhibition = [],
  cancelledBefore = [],
}) {
  const races = [];
  const conditions = [];
  const entries = [];
  const series = [];
  for (const [codeText, v] of Object.entries(venues)) {
    const code = Number(codeText);
    series.push(materialSeries(code, v));
    for (let r = 1; r <= 12; r += 1)
      materialRace(code, v, r, absent, { races, conditions, entries });
  }
  return {
    date: DATE,
    races,
    conditions,
    entries,
    exhibition: exhibition.map((k) => {
      const [race_id, b] = k.split(":");
      return { race_id, boat_number: Number(b) };
    }),
    series,
    stats,
    cancelledBefore,
  };
}
function materialSeries(code, v) {
  return {
    venue_code: code,
    start_date: v.start ?? "2037-11-02",
    end_date: v.end ?? "2037-11-07",
    title: v.title ?? `一般戦${code}`,
    grade: v.grade === "ippan" || !v.grade ? "ippan" : v.grade,
    kind: v.kind ?? "ippan",
  };
}

function materialRace(code, v, r, absent, { races, conditions, entries }) {
  const raceId = id(code, r);
  races.push({
    race_id: raceId,
    venue_code: code,
    race_number: r,
    start_time: `${v.times?.[r] ?? `${String(8 + r).padStart(2, "0")}:${String(code).padStart(2, "0")}`}:00`,
    race_grade: v.grade ?? "ippan",
    cancellation_status: v.cancelled ? "confirmed" : null,
  });
  conditions.push({
    race_id: raceId,
    race_stage: v.stage?.[r] ?? "予選",
    series_day: v.day?.[r] ?? null,
    is_final_day: v.final?.[r] ?? null,
    race_title: v.title ?? null,
  });
  for (let b = 1; b <= 6; b += 1)
    entries.push({
      race_id: raceId,
      boat_number: b,
      racer_id: code * 1000 + r * 10 + b,
      player_name: `選手\u3000${code}-${r}-${b}`,
      grade: b === 1 ? "A1" : "B1",
      is_absent: absent.includes(`${raceId}:${b}`),
    });
}
