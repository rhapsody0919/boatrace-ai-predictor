/**
 * 予定表（scrape_slots）まわりの時刻計算（純粋関数。実行環境のタイムゾーンに依存しない）
 *
 * 期限は保存せず、races.start_time（JST）と offset_min から都度計算する
 * （docs/design/scraping-vercel-consolidation/plan.md §3.1）。DB側の claim_scrape_slots
 * （マイグレーション075）の `(race_date + start_time) AT TIME ZONE 'Asia/Tokyo' + offset_min分` と同じ計算。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?/;

/** Date を JST の YYYY-MM-DD にする */
export function toJstDateString(date) {
  return new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** その日（JST）の 00:00 の瞬間 */
export function jstStartOfDay(date) {
  return new Date(`${toJstDateString(date)}T00:00:00+09:00`);
}

/** JSTの時刻を「その日の0時からの分」で返す（0〜1439） */
export function jstMinutesOfDay(date) {
  const j = new Date(date.getTime() + JST_OFFSET_MS);
  return j.getUTCHours() * 60 + j.getUTCMinutes();
}

/**
 * レースの発走の瞬間。races.race_date（YYYY-MM-DD）と races.start_time（HH:MM または HH:MM:SS、JST）から作る。
 * 不正な形式は例外にする（「対象なし」に化けさせない）。
 */
export function raceStartInstant(raceDate, startTime) {
  if (typeof raceDate !== "string" || !DATE_RE.test(raceDate)) {
    throw new Error(`race_date の形式が不正です: ${String(raceDate)}`);
  }
  const m = typeof startTime === "string" ? TIME_RE.exec(startTime) : null;
  if (!m) {
    throw new Error(`start_time の形式が不正です: ${String(startTime)}`);
  }
  const [, hh, mm, ss = "00"] = m;
  const d = new Date(`${raceDate}T${hh}:${mm}:${ss}+09:00`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`発走時刻を解釈できません: ${raceDate} ${startTime}`);
  }
  return d;
}

/** スロットの期限（発走の offsetMin 分後。負なら発走前） */
export function slotDeadline(raceDate, startTime, offsetMin) {
  return new Date(
    raceStartInstant(raceDate, startTime).getTime() + offsetMin * MINUTE_MS,
  );
}

/** 期限+許容幅（これを過ぎた未完了は expired） */
export function slotWindowEnd(deadline, graceMin) {
  return new Date(deadline.getTime() + graceMin * MINUTE_MS);
}

/** 今から seconds 秒後 */
export function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}
