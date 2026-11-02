#!/usr/bin/env node
/**
 * 発売中の単勝（race_odds.odds_win_N）が、締切時の単勝（race_odds_final.win_all）とどれだけ合うかを、窓ごとに数える（BOA-1174）。
 * 読み取りだけ。
 *
 * 数えるもの（窓ごと）:
 *   six        6艇とも単勝の値がある行（公式の「0.0」＝票0は null で保存されるので、欠ける）
 *   w1eq1      1号艇の単勝が 1.0 の行（公式の下限。票が少ないと1番人気の艇は 1.0 に張り付く）
 *   winEq      単勝の1番人気が1艇に決まり、締切時の単勝の1番人気と同じ行
 *   triEq      3連単の合成（1着ごとに 1/オッズ を足す）の1着人気が、締切時の単勝の1番人気と同じ行
 *   compared   締切時の単勝の1番人気が1艇に決まるレースの行（winEq・triEq の分母）
 *
 * 使い方: node --env-file=.env.local scripts/analysis/check-win-odds-vs-final.js 2026-10-2
 *   引数は race_id の前方一致（既定 2026-10-2 = 10/20〜10/29）
 */
import { fetchAll } from "../lib/supabaseClient.js";

const prefix = process.argv[2] ?? "2026-10-2";
const like = `${prefix}%`;
const BOATS = [1, 2, 3, 4, 5, 6];

/** [[艇, オッズ]] から、正の値の最小（1番人気）の艇の一覧 */
function favoritesOf(pairs) {
  const valid = pairs.filter(([, o]) => o > 0);
  if (valid.length === 0) return { boats: [], min: null };
  const min = Math.min(...valid.map(([, o]) => o));
  return { boats: valid.filter(([, o]) => o === min).map(([b]) => b), min };
}

/** 3連単の全通りから、1着ごとの 1/オッズ の和が最も大きい艇 */
function trifectaFavoriteOf(trifectaAll) {
  const sums = new Map();
  for (const [combo, odds] of Object.entries(trifectaAll ?? {})) {
    const o = Number(odds);
    if (!(o > 0)) continue;
    const first = Number(combo.split("-")[0]);
    sums.set(first, (sums.get(first) ?? 0) + 1 / o);
  }
  const top = [...sums.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return top ? top[0] : null;
}

async function main() {
  const [odds, finals] = await Promise.all([
    fetchAll(
      "race_odds",
      "race_id,window_min,odds_win_1,odds_win_2,odds_win_3,odds_win_4,odds_win_5,odds_win_6,trifecta_all",
      (q) => q.like("race_id", like).order("race_id").order("window_min"),
    ),
    fetchAll("race_odds_final", "race_id,win_all", (q) =>
      q.like("race_id", like).order("race_id"),
    ),
  ]);

  const finalFavorite = new Map();
  const finalStats = { n: 0, six: 0, w1eq1: 0, uniqueFavorite: 0 };
  for (const row of finals) {
    const pairs = Object.entries(row.win_all ?? {}).map(([b, o]) => [
      Number(b),
      Number(o),
    ]);
    finalStats.n++;
    if (pairs.filter(([, o]) => o > 0).length === 6) finalStats.six++;
    if (Number(row.win_all?.["1"]) === 1) finalStats.w1eq1++;
    const fav = favoritesOf(pairs);
    if (fav.boats.length === 1) {
      finalStats.uniqueFavorite++;
      finalFavorite.set(row.race_id, fav.boats[0]);
    }
  }

  const byWindow = {};
  for (const row of odds) {
    const w = (byWindow[row.window_min] ??= {
      n: 0,
      six: 0,
      w1eq1: 0,
      compared: 0,
      winEq: 0,
      triEq: 0,
    });
    w.n++;
    const pairs = BOATS.map((b) => [b, Number(row[`odds_win_${b}`] ?? 0)]);
    if (pairs.every(([, o]) => o > 0)) w.six++;
    if (Number(row.odds_win_1) === 1) w.w1eq1++;
    const target = finalFavorite.get(row.race_id);
    if (target === undefined) continue;
    w.compared++;
    const fav = favoritesOf(pairs);
    if (fav.boats.length === 1 && fav.boats[0] === target) w.winEq++;
    if (trifectaFavoriteOf(row.trifecta_all) === target) w.triEq++;
  }

  console.log(`race_id LIKE '${like}'`);
  console.log("締切時（race_odds_final）", finalStats);
  console.table(byWindow);
}

main().catch((error) => {
  console.error(`集計に失敗しました: ${error.message}`);
  process.exit(1);
});
