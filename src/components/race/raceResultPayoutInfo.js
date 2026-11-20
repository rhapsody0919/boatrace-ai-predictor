/**
 * RaceResult の配当の行・スタートの情報・表彰台の判定を組み立てる純な関数（RaceResult.jsx から字のまま移した。越えの単位を割るため）
 */

import { startFormationRows } from "./startFormation";

import {
  PAYOUT_BET_TYPES,
  PAYOUT_STATUS,
  RACE_OUTCOME,
  describePartialVoid,
  getRefundBoats,
} from "../../utils/raceOutcome";
// 単勝・複勝の人気（BOA-534）。公式の払戻（race_payouts）は3連単〜拡連複にだけ人気が付き、単勝・複勝には
// 付かない（公式の結果ページにも出ない）。そこで締切時オッズ（race_odds_final、BOA-496）から順位を出す。
// - 単勝: オッズの小さい順（2連単・3連単で、締切時オッズの小さい順が公式の人気と40/40件一致）
// - 複勝: 上限の小さい順、同じ上限なら下限の小さい順。公式は複勝の人気を出さないため、同じ幅のあるオッズの
//   拡連複で公式の人気と比べた（9/29 の40レース・120件）: 上限→下限 114件一致、下限→上限 100件一致。
//   上限は「相手が最も票の少ない艇」のときの値で、自分の票数に対して単調になりやすい
// - 公式は丸める前の票数で順位を付けるため、同じオッズの艇どうしの順位はオッズからは決まらない。
//   同じオッズの艇がいるときは「4〜5人気」のように幅で返す（{ from, to }）。票なし（0.0）・欠場（キーなし）は
//   順位を付けない
function popularityFromFinalOdds(map, boat, isRange) {
  const valid = (v) =>
    v != null && (isRange ? v.low > 0 : typeof v === "number" && v > 0);
  const mine = map?.[String(boat)];
  if (!valid(mine)) return null;
  const sortKey = (v) => (isRange ? [v.high, v.low] : [v, 0]);
  const [a0, a1] = sortKey(mine);
  const others = Object.entries(map)
    .filter(([key, v]) => key !== String(boat) && valid(v))
    .map(([, v]) => sortKey(v));
  const better = others.filter(([b0, b1]) => b0 < a0 || (b0 === a0 && b1 < a1));
  const tied = others.filter(([b0, b1]) => b0 === a0 && b1 === a1);
  const from = better.length + 1;
  return { from, to: from + tied.length };
}

// 払戻の行のうち、単勝・複勝で公式の人気が無い行に、締切時オッズから出した人気を補う。
// 払戻のある行（paid）だけ。不成立・特払・金額なしの行、締切時オッズが無いレースでは付けない
function withFinalOddsPopularity(rows, finalOdds) {
  if (!rows || !finalOdds) return rows;
  const sources = {
    win: { map: finalOdds.win, isRange: false },
    place: { map: finalOdds.place, isRange: true },
  };
  return rows.map((row) => {
    const source = sources[row.typeKey];
    if (
      !source?.map ||
      row.status !== PAYOUT_STATUS.PAID ||
      row.popularity != null ||
      row.boats.length !== 1
    ) {
      return row;
    }
    const popularity = popularityFromFinalOdds(
      source.map,
      row.boats[0],
      source.isRange,
    );
    if (popularity == null) return row;
    return {
      ...row,
      popularity: popularity.from,
      popularityTo: popularity.to > popularity.from ? popularity.to : null,
      popularityFromFinalOdds: true,
    };
  });
}

// 払戻明細（payoutRows）が届いていない（RPC未適用・過去データ・直接クエリのフォールバック・
// 軽量版の取得直後）ときの払戻表。旧 payout_* 列の payouts を払戻明細と同じ行の形に直す。
// 旧列では不成立の勝式が NULL になる（078）ため、成立状態が分かっているときだけ補う:
// - 不成立: 7勝式すべて「不成立（返還）」
// - 一部返還: 旧列に無い勝式を「不成立（返還）」（BOA-543 の「黙って消える」を直接クエリ経路でも起こさない）
// 成立状態が分からない（unknown）・通常のときは、今までどおり旧列にある勝式だけを出す
function legacyPayoutRows(payouts, outcome) {
  const meta = new Map(PAYOUT_BET_TYPES.map((b) => [b.typeKey, b]));
  const paid = (typeKey, seq, entry) =>
    entry && typeof entry.amount === "number"
      ? {
          ...meta.get(typeKey),
          seq,
          boats: entry.boats ?? (entry.boat != null ? [entry.boat] : []),
          amount: entry.amount,
          status: PAYOUT_STATUS.PAID,
          popularity: entry.popularity ?? null,
        }
      : null;
  const noRace = (typeKey) => ({
    ...meta.get(typeKey),
    seq: 1,
    boats: [],
    amount: null,
    status: PAYOUT_STATUS.NO_RACE,
    popularity: null,
  });
  if (outcome === RACE_OUTCOME.NO_RACE) {
    return PAYOUT_BET_TYPES.map((b) => noRace(b.typeKey));
  }
  // 英語の正しい賭式名はTrifecta=着順通り(3連単)/Trio=順不同(3連複)。旧列由来の payouts の
  // キーは sanrentan=3連単・sanrenpuku=3連複（buildRaceResult() のコメント参照）
  const byType = {
    win: [paid("win", 1, payouts?.win)],
    place: (payouts?.place ?? []).map((e, i) => paid("place", i + 1, e)),
    trifecta: [paid("trifecta", 1, payouts?.sanrentan)],
    trio: [paid("trio", 1, payouts?.sanrenpuku)],
    exacta: [paid("exacta", 1, payouts?.exacta)],
    quinella: [paid("quinella", 1, payouts?.quinella)],
    wide: (payouts?.wide ?? []).map((e, i) => paid("wide", i + 1, e)),
  };
  const hasAnyPaid = Object.values(byType).some((rows) => rows.some(Boolean));
  if (!hasAnyPaid) return null;
  return PAYOUT_BET_TYPES.flatMap((b) => {
    const rows = byType[b.typeKey].filter(Boolean);
    if (rows.length > 0) return rows;
    return outcome === RACE_OUTCOME.PARTIAL_REFUND ? [noRace(b.typeKey)] : [];
  });
}

// スタート情報から表・注記に要る値を求める（純関数）
export function deriveStartTimingInfo(startTimings) {
  const startTimingByBoat = new Map(
    (startTimings ?? []).map((st) => [st.boatNumber, st]),
  );
  const validStartTimings = (startTimings ?? []).filter(
    (st) => st.startTiming != null,
  );
  // 進入コース順に並べた艇番（公式の「スタート情報」の並び。BOA-625）。
  // 進入が1艇も入っていない（2026-09-20 以前の一部・取得前）ときは空
  const courseOrder = (startTimings ?? [])
    .filter((st) => st.entryCourse != null)
    .sort((a, b) => a.entryCourse - b.entryCourse)
    .map((st) => st.boatNumber);
  // フライングは異常値のため「最速」判定からは除外する（update-top-start-stats.jsと同じ扱い。BOA-559）
  const nonFlyingStartTimings = validStartTimings.filter((st) => !st.isFlying);
  // スタート隊形（コース順）の行（BOA-811）。進入が1艇も分からないレースは null（絵を出さない）
  const formationRows = startFormationRows(startTimings);
  // 「最速」は比べる相手がいるときだけ付ける。不成立レースで F 以外が1艇だけのとき、
  // その1艇に「最速」が付いていた（BOA-586）
  const fastestStartTiming =
    nonFlyingStartTimings.length >= 2
      ? Math.min(...nonFlyingStartTimings.map((st) => st.startTiming))
      : null;
  return {
    startTimingByBoat,
    validStartTimings,
    courseOrder,
    formationRows,
    fastestStartTiming,
  };
}

// 振り返りの決着（BOA-635）: 結果表の着順（返還艇を外したもの）の1〜3着。同着などで1・2・3着が
// 1艇ずつそろわなければ決着の行を出さない
export function podiumDecision(rows) {
  const podium = [1, 2, 3].map((p) => rows.filter((r) => r.position === p));
  return podium.every((xs) => xs.length === 1)
    ? podium.map((xs) => xs[0].boat)
    : null;
}

// 払戻の節に要る値（払戻の行・一部不成立の注記・人気の注記）を求める
export function derivePayoutInfo({
  result,
  outcome,
  startTimings,
  boatsInRace,
  finalOdds,
}) {
  // 払戻は払戻明細（race_payouts、payoutRows）を正とする。届いていないときだけ旧 payout_* 列から
  // 同じ行の形を組み立てる（legacyPayoutRows）
  const payoutRowsToShow = withFinalOddsPopularity(
    result.payoutRows ?? legacyPayoutRows(result.payouts, outcome),
    finalOdds,
  );
  // 完走した艇の数は、着欄の記号が取れているときだけ数える（取れていない過去分は null）
  const finishers = (startTimings ?? []).some((st) => st.finishMark != null)
    ? startTimings.filter((st) => st.finishRank != null).length
    : null;
  const partialVoid =
    outcome === RACE_OUTCOME.PARTIAL_REFUND
      ? describePartialVoid({
          boatsInRace: boatsInRace.length,
          refundBoats: getRefundBoats(result),
          finishers,
          payoutRows: payoutRowsToShow,
        })
      : null;
  const hasFinalOddsPopularity = (payoutRowsToShow ?? []).some(
    (row) => row.popularityFromFinalOdds,
  );
  return { payoutRowsToShow, partialVoid, hasFinalOddsPopularity };
}
