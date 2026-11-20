/** 節の機力の Shorts の締切の照合（純粋関数）。push-setsu-kiryoku-short.js から移した（字は同じ） */
/** final_deadline の R の番号（"11R" → 11）。無ければ null */
export const raceNumberOf = (deadline) =>
  deadline?.race ? Number(String(deadline.race).replace(/R$/, "")) : null;
/** レース名が優勝戦か（「男子優勝戦」等も含む。「準優勝戦」でない） */
export const isFinalStage = (stage) =>
  typeof stage === "string" && /優勝戦/.test(stage) && !/準優勝戦|進出/.test(stage);

/**
 * 当日の final_gap の締切（任意、BOA-1282）が DB の優勝戦と同じか（純粋関数）。違えば理由、同じか締切が無ければ null。
 * R は race_id の末尾、時刻は races.start_time（分の単位）。前夜の型は出走表がまだ無いので照らさない（hq が eve_race_deadlines から入れる）
 */
export function finalDeadlineMismatch(deadline, final) {
  if (deadline == null) return null;
  const race = `${Number(String(final.race_id).slice(-2))}R`;
  const time = typeof final.start_time === "string" ? final.start_time.slice(0, 5) : null;
  if (deadline.race !== race || deadline.time !== time)
    return `final_deadline（${deadline.race} ${deadline.time}）が DB の優勝戦（${race} ${time ?? "締切なし"}）と違う`;
  return null;
}

/** border の3人の焼き込んだ締切を当日の races と照合する。全員一致なら null、違えば理由 */
export function borderDeadlineMismatch(racers, rows) {
  const times = new Map(rows.map((r) => [
    `${Number(String(r.race_id).slice(-2))}R`,
    typeof r.start_time === "string" ? r.start_time.slice(0, 5) : null,
  ]));
  const reasons = racers.flatMap((r) => {
    const time = times.get(r.race);
    return r.deadline === time ? [] : [
      `${r.race} の焼き込んだ締切（${r.deadline}）が DB（${time ?? (times.has(r.race) ? "締切なし" : "行なし")}）と違う`,
    ];
  });
  return reasons.length ? reasons.join("・") : null;
}

/**
 * 前夜の final_gap の締切が、前夜に取った表の優勝戦の行（is_final=true、男女W優勝戦なら2行）のどれかと同じか（純粋関数）。
 * 違えば理由、同じなら null
 */
export function eveDeadlineMismatch(deadline, finals) {
  if (deadline == null) return null;
  const rows = (finals ?? []).map((f) => ({
    race: `${Number(String(f.race_id).slice(-2))}R`,
    time: typeof f.deadline === "string" ? f.deadline.slice(0, 5) : null,
  }));
  if (rows.length === 0)
    return "前夜の締切の表に、その日の優勝戦の行（is_final）が無い";
  if (rows.some((r) => r.race === deadline.race && r.time === deadline.time))
    return null;
  return `final_deadline（${deadline.race} ${deadline.time}）が前夜の表の優勝戦（${rows.map((r) => `${r.race} ${r.time}`).join("・")}）と違う`;
}
