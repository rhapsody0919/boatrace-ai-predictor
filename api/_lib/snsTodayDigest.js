/**
 * /today（本日のデータ一覧）の X 投稿（sns-pdca-loop tasks 19b、通り道 A）の版。
 * 材料は人の画面・ボット向け HTML と同じ morning_digest_days・morning_digest_rows（api/_lib/botToday.js の createDigestSource）。
 * 版は「公開された日の行」から決まる。auto-plan が下書きを作るときと、送る直前の検査（readCurrent）で同じ関数を使い、
 * 一覧がやり直された（5:30 の後の 6:30・8:00）ら版が変わり、送る直前に source_changed で止まる
 */
import { ROW_SELECT, createDigestSource } from "./botToday.js";

export const TODAY_SCREEN_KEY = "today";

// 投稿の本文に、各区分の上位の選手名・枠番を載せる（2026-10-15 オーナー指示）。人の画面（/today）は同じ表の同じ列を出している
export const TODAY_ROW_SELECT = `${ROW_SELECT},racer_name,boat_number,sample_size`;

/** 計画（auto-plan）と送る直前の検査で同じ列を読む（版がずれないため）。使い回さず毎回読み直す */
export const createTodayDigestSource = (options = {}) =>
  createDigestSource({ ttlMs: 0, rowSelect: TODAY_ROW_SELECT, ...options });

/** 下書きが /today の投稿か（source_data.digest を持ち、素材のバンドルではない） */
export const isTodayDraft = (draft) =>
  !draft?.bundle_import_id &&
  /^\d{4}-\d{2}-\d{2}$/.test(draft?.source_data?.digest?.date ?? "");

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
