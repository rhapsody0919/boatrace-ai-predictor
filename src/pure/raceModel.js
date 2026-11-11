import { parseRaceId } from "./raceId.js";

/**
 * races の行（キーは Supabase の snake_case のまま）
 * @typedef {object} Race
 * @property {string} race_id YYYY-MM-DD-VV-RR
 * @property {number} venue_code 1〜24
 * @property {number} race_number 1〜12
 * @property {string} [race_date] race_id の日付と同じ
 * @property {(null|"tentative"|"confirmed")} [cancellation_status]
 * @property {ReadonlyArray<RaceEntry>} [race_entries] 取得済みのときだけ
 */

/**
 * race_entries の行。racer_id・player_name・率などは null がありうる
 * @typedef {object} RaceEntry
 * @property {string} race_id
 * @property {number} boat_number 1〜6
 * @property {(number|string|null)} [racer_id]
 * @property {(string|null)} [player_name]
 */

// src/utils/raceCancellation.js の3値。pure から utils は import できないので字で持つ
const CANCELLATION_STATUSES = [null, "tentative", "confirmed"];

function assertObject(row, name) {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    throw new TypeError(`${name} の引数がオブジェクトでない: ${String(row)}`);
  }
}

function assertInt(value, min, max, label, raceId) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`race の${label}が${min}〜${max}でない: ${String(value)}（race_id=${raceId}）`);
  }
}

function readRaceId(row) {
  const parsed = parseRaceId(row.race_id);
  if (!parsed) {
    throw new RangeError(`race の race_id が YYYY-MM-DD-VV-RR の形でない: ${String(row.race_id)}`);
  }
  return parsed;
}

/**
 * race_entries の行を検査して凍結した写しを返す
 * @param {object} row
 * @returns {Readonly<RaceEntry>}
 */
export function makeRaceEntry(row) {
  assertObject(row, "makeRaceEntry");
  readRaceId(row);
  assertInt(row.boat_number, 1, 6, "艇番", row.race_id);
  return Object.freeze({ ...row });
}

function makeEntries(rawEntries, raceId, relaxed) {
  const entries = rawEntries.map(makeRaceEntry);
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.boat_number)) {
      throw new RangeError(`race の艇番が重複: ${e.boat_number}（race_id=${raceId}）`);
    }
    seen.add(e.boat_number);
  }
  if (entries.length > 6) {
    throw new RangeError(`race の艇数が7艇以上: ${entries.length}（race_id=${raceId}）`);
  }
  // 空配列は未取得、中止の疑い・確定は艇の数を問わない
  if (!relaxed && entries.length !== 6) {
    throw new RangeError(`race の艇数が6艇でない: ${entries.length}（race_id=${raceId}）`);
  }
  return Object.freeze(entries);
}

/**
 * races の行を検査して凍結した写しを返す
 * @param {object} row
 * @returns {Readonly<Race>}
 */
export function makeRace(row) {
  assertObject(row, "makeRace");
  const parsed = readRaceId(row);
  const raceId = row.race_id;
  assertInt(row.venue_code, 1, 24, "会場コード", raceId);
  assertInt(row.race_number, 1, 12, "レース番号", raceId);
  if (parsed.venueCode !== row.venue_code) {
    throw new RangeError(`race の race_id と会場コードが食い違う: ${row.venue_code}（race_id=${raceId}）`);
  }
  if (parsed.raceNo !== row.race_number) {
    throw new RangeError(`race の race_id とレース番号が食い違う: ${row.race_number}（race_id=${raceId}）`);
  }
  if (row.race_date != null && row.race_date !== parsed.date) {
    throw new RangeError(`race の race_date が race_id の日付と違う: ${String(row.race_date)}（race_id=${raceId}）`);
  }
  const status = row.cancellation_status ?? null;
  if (!CANCELLATION_STATUSES.includes(status)) {
    throw new RangeError(`race の cancellation_status が不明な値: ${String(status)}（race_id=${raceId}）`);
  }
  const out = { ...row };
  if (Array.isArray(row.race_entries)) {
    const relaxed = row.race_entries.length === 0 || status !== null;
    out.race_entries = makeEntries(row.race_entries, raceId, relaxed);
  }
  return Object.freeze(out);
}
