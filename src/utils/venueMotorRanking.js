/**
 * 会場のモーターの順位と並べ替え（純関数、BOA-428）。
 *
 * レース詳細の6艇表（会場内順位）と、分析ツールの「モーターランキング」タブで共有する。
 * 順位は `competitionRank`（同じ値は同じ順位、次の順位は飛ぶ: 1, 2, 2, 4）。
 */
import { competitionRank } from "./competitionRank.js";

/**
 * 会場サイトのモーター成績（`venue_motor_stats`）を出さない会場。
 * 浜名湖（6）・宮島（17）は会場サイトに明示的な著作権条項がある（ADR-0067:21）。
 * 取得はしているが、BOA-428 の表示には使わない（2026-10-02 ユーザー判断。取得の停止は BOA-681）。
 * 戸田（2）・平和島（4）は会場サイトにページが無く、行そのものが無い
 */
export const VENUE_SITE_STATS_HIDDEN = [6, 17];

/** 並べ替えられる列と、その向き（参考UIと同じく、押しても向きは変わらない） */
export const MOTOR_SORT_KEYS = {
  motorNumber: { ascending: true },
  top2Rate: { ascending: false },
  championshipCount: { ascending: false },
  pretestTime: { ascending: true },
};

const hasValue = (v) => v !== null && v !== undefined && !Number.isNaN(v);

/**
 * 値のある行だけで順位を付ける。値の無い行は Map に入らない
 * @param {Array<object>} rows
 * @param {string} key 比べる列
 * @param {{ascending?: boolean}} [options]
 * @returns {Map<number, {rank: number, tied: number}>} motorNumber → 順位
 */
export function rankBy(rows, key, { ascending = false } = {}) {
  const valued = rows.filter((r) => hasValue(r[key]));
  const values = valued.map((r) => Number(r[key]));
  return new Map(
    valued.map((r) => [
      r.motorNumber,
      competitionRank(values, Number(r[key]), { ascending }),
    ]),
  );
}

/**
 * 並べ替えて、各行に順位を付ける。
 * - 並べている列の値が無い行は末尾（その中は機番の昇順）、順位は null（画面は「-」）
 * - 機番で並べたときは、機番に順位が無いので2連率の順位を出す
 * @param {Array<{motorNumber: number}>} rows
 * @param {keyof MOTOR_SORT_KEYS} sortKey
 * @returns {Array<object & {rank: number|null, tied: number}>}
 */
export function sortMotorRows(rows, sortKey) {
  const config = MOTOR_SORT_KEYS[sortKey];
  if (!config) throw new Error(`並べ替えられない列: ${sortKey}`);
  const rankKey = sortKey === "motorNumber" ? "top2Rate" : sortKey;
  const ranks = rankBy(rows, rankKey, MOTOR_SORT_KEYS[rankKey]);
  const sign = config.ascending ? 1 : -1;
  return [...rows]
    .sort((a, b) => {
      const av = hasValue(a[sortKey]);
      const bv = hasValue(b[sortKey]);
      if (av !== bv) return av ? -1 : 1;
      if (av && Number(a[sortKey]) !== Number(b[sortKey])) {
        return (Number(a[sortKey]) - Number(b[sortKey])) * sign;
      }
      return a.motorNumber - b.motorNumber;
    })
    .map((r) => {
      const hit = ranks.get(r.motorNumber);
      return { ...r, rank: hit?.rank ?? null, tied: hit?.tied ?? 0 };
    });
}

/**
 * 2連率が1位のモーターの機番（同率1位は全部、UI統一ルール R1）。値のある行が無い、または
 * 全部が同じ値なら空（差が無いものは強調しない）。
 * レース詳細UI統一の `bestOf`（#1135）がマージされたら、そちらに置き換える
 * @param {Array<{motorNumber: number, top2Rate: number|null}>} rows
 * @returns {Set<number>}
 */
export function topRateMotors(rows) {
  const valued = rows.filter((r) => hasValue(r.top2Rate));
  if (valued.length === 0) return new Set();
  const values = valued.map((r) => Number(r.top2Rate));
  const max = Math.max(...values);
  if (Math.min(...values) === max) return new Set();
  return new Set(
    valued.filter((r) => Number(r.top2Rate) === max).map((r) => r.motorNumber),
  );
}

/**
 * 2連率の表示。会場サイトによって小数第2位まである（51.43）ので、その桁は残す。
 * 1桁に丸めると、別の値が同じ「51.4」に見え、順位が違う理由が読めなくなる
 * @param {number|null} v
 * @returns {string|null}
 */
export function formatMotorRate(v) {
  if (!hasValue(v)) return null;
  const n = Number(v);
  return Number.isInteger(Math.round(n * 100) / 10)
    ? n.toFixed(1)
    : n.toFixed(2);
}

/** YYYY-MM-DD → 「2026/9/30」（出典・注記の取得日の表記。BOA-428 で2画面そろえる） */
export function formatSlashDate(date) {
  const [y, m, d] = String(date).split("-").map(Number);
  return `${y}/${m}/${d}`;
}
