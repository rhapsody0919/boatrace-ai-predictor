/**
 * /today の X 投稿の版（digestRevision）と、載せる候補のレースの状態（pickRaceStatus）。
 * 計画（auto-plan、scripts/lib/snsTodayPlanner.js）と送る直前の検査（api/_lib/snsClaimCheck.js の readCurrent）で同じ関数を使う。
 * api/_lib/snsTodayDigest.js から字のまま移した（api/ 側は再 export）
 */

export const TODAY_SCREEN_KEY = "today";

/** @param {{day: object|null, rows: object[]}} digest createDigestSource の値 */
export async function digestRevision({ day, rows }) {
  if (!day?.generated_at) throw new Error("digest_not_generated");
  const text = JSON.stringify({ generated_at: day.generated_at, rows });
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/**
 * 載せる候補のレースの状態（2026-10-15 オーナー承認: 欠場・中止・締切を確かめられないレースは載せない）。
 * 計画（auto-plan）と送る直前の検査（readCurrent）で同じ関数を使う。reason が null の候補だけ載せられる
 * @param {(path: string) => Promise<any[]>} db PostgREST の読み取り（service_role）。失敗は投げる
 * @param {{race_id: string, boat_number: number}[]} picks
 */
export async function pickRaceStatus(db, picks) {
  const ids = [...new Set(picks.map((p) => p.race_id))];
  if (!ids.length) return [];
  const list = encodeURIComponent(`(${ids.map((id) => `"${id}"`).join(",")})`);
  const [races, entries, exhibition] = await Promise.all([
    db(
      `races?race_id=in.${list}&select=race_id,start_time,cancellation_status`,
    ),
    db(`race_entries?race_id=in.${list}&select=race_id,boat_number,is_absent`),
    db(
      `exhibition_data?race_id=in.${list}&select=race_id,boat_number,is_absent`,
    ),
  ]);
  return picks.map((p) => {
    const race = races.find((r) => r.race_id === p.race_id);
    const absent = [...entries, ...exhibition].some(
      (e) =>
        e.race_id === p.race_id &&
        e.boat_number === p.boat_number &&
        e.is_absent === true,
    );
    const reason = !race
      ? "race_not_found"
      : race.cancellation_status != null
        ? "cancelled"
        : !race.start_time
          ? "deadline_unknown"
          : absent
            ? "absent"
            : null;
    return { race_id: p.race_id, boat_number: p.boat_number, reason };
  });
}
