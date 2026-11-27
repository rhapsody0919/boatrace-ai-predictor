/**
 * 今日出走する選手の中での位置（出走表の全国勝率・2連率の意味づけ、オーナー 2026-11-28 が物差しを「今日の出走者」に決めた）。
 *
 * 審査（共有ノート m2-meaning/step5-card-c-design.md）:
 * - data-scientist: 位置は色を付けない。1%刻みは見かけの精度なので「上位N割・下位N割」の段。
 *   母集団が200人未満（朝の取り込みの途中など）は出さない（目安、根拠なし）。値が無い・0 の選手は外す
 * - system-architect: 新しい取得は要らない。ページがその日の全レース（/api/predictions）を既に持つ
 * - 当地勝率は会場ごとの物差しなので位置を付けず、本人の全国勝率との差を色なしで出す（0.00 は当地の出走なし）
 */

export const DAY_RANK_MIN_RACERS = 200;

const valueOf = (raw) => {
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : null;
};

/**
 * その日の全レースの出走者を、選手ごとに1つの値にまとめる（同じ日に2走する選手を2回数えない）
 * @param {{players?: {racerId?: number|null, [field: string]: unknown}[]}[]} races
 * @param {string} field players の項目（winRate・global2Rate）
 * @returns {number[]}
 */
export function collectDayEntrantValues(races, field) {
  const byRacer = new Map();
  for (const race of races ?? []) {
    for (const p of race?.players ?? []) {
      if (p?.racerId == null) continue;
      const v = valueOf(p[field]);
      if (v !== null) byRacer.set(p.racerId, v);
    }
  }
  return [...byRacer.values()];
}

/**
 * 値 x の、その日の出走者の中での位置。上半分は「上位N割」、下半分は「下位N割」（1位も「上位1割」）。
 * 同じ値は同じ位置（自分以上・自分以下の人の割合で決める）
 * @returns {{side: "top"|"bottom", tenths: number} | null}
 */
export function dayRankOf(values, x) {
  const v = valueOf(x);
  if (v === null || values.length < DAY_RANK_MIN_RACERS) return null;
  const atLeast = values.filter((o) => o >= v).length / values.length;
  if (atLeast <= 0.5) return { side: "top", tenths: Math.max(1, Math.ceil(atLeast * 10)) };
  const atMost = values.filter((o) => o <= v).length / values.length;
  return { side: "bottom", tenths: Math.max(1, Math.ceil(atMost * 10)) };
}

/**
 * 出走表の6艇ぶんの位置をまとめて作る（入口の部品で useMemo する）
 * @returns {{n: number, winRate: Map<number, object>, twoRate: Map<number, object>} | null} 200人未満なら null
 */
export function buildDayRanks(races, players) {
  const win = collectDayEntrantValues(races, "winRate");
  const two = collectDayEntrantValues(races, "global2Rate");
  if (win.length < DAY_RANK_MIN_RACERS) return null;
  const pick = (values, field) =>
    new Map((players ?? []).map((p) => [p.number, dayRankOf(values, p[field])]).filter(([, r]) => r));
  return { n: win.length, winRate: pick(win, "winRate"), twoRate: pick(two, "global2Rate") };
}

/** 当地勝率 − 全国勝率（小数2桁）。当地が 0・値なし（当地の出走なし）なら null */
export function localVsNational(localWinRate, winRate) {
  const local = valueOf(localWinRate);
  const national = valueOf(winRate);
  if (local === null || national === null) return null;
  return Math.round((local - national) * 100) / 100;
}
