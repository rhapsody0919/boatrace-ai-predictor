// races の締切の ISO。auto-plan（scripts/lib/snsAutoPlanRunner.js）と送る直前の読み直し（api/_lib/snsClaimCheckReaders.js）が同じ関数を使う。api/ から字のまま移した（api/ 側は再 export）

/** races の締切（発走の時刻、JST）を ISO にする。承認（auto-plan）と送る直前で同じ文字列になるよう、ここだけで作る */
export function deadlineIso(race) {
  if (!race?.race_date || !race?.start_time) return null;
  return new Date(`${race.race_date}T${race.start_time}+09:00`).toISOString();
}
