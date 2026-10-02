/**
 * レースの成立状態（通常・一部返還・不成立）と、返還艇・的中判定の可否を1箇所で決める（BOA-543）。
 *
 * 正は race_results.race_status と refund_boats（マイグレーション078）。旧フラグ is_no_race は
 * 全行 false で機能していないため読まない。078 の方針どおり「race_status IS DISTINCT FROM
 * 'no_race'」に合わせ、race_status が NULL（078以前の行・RPC未適用で値が届かない）のときは
 * 'unknown' を返し、呼び出し側は今までどおり（通常のレースとして）扱う。
 *
 * 画面（RaceResult / RaceCard / RaceAiPredictionTab / TurnPatternList / HitRaces）と、
 * 後続の BOA-544（的中判定・成績集計）・BOA-545（is_no_race の置き換え）が共有する。
 * DB・DOM・React に依存しない純関数だけを置く（scripts/ からも import する）。
 *
 * `result` は画面の結果オブジェクト（buildRaceResult の戻り: raceStatus / refundBoats /
 * rank1）を受ける。race_results の生の行（race_status / refund_boats）も受ける。
 */

export const RACE_OUTCOME = Object.freeze({
  /** 全勝式が不成立。舟券はすべて返還。着順は決まっていない */
  NO_RACE: "no_race",
  /** 返還艇がある、または一部の勝式が不成立。残りの勝式は通常どおり払われる */
  PARTIAL_REFUND: "partial_refund",
  /** 返還も不成立も無い */
  NORMAL: "normal",
  /** 未判定（race_status が NULL・値が届いていない）。今までどおり通常として扱う */
  UNKNOWN: "unknown",
});

const KNOWN_STATES = new Set([
  RACE_OUTCOME.NO_RACE,
  RACE_OUTCOME.PARTIAL_REFUND,
  RACE_OUTCOME.NORMAL,
]);

/**
 * レースの成立状態を返す。
 * @param {{raceStatus?: string|null, race_status?: string|null}|null|undefined} result
 * @returns {"no_race"|"partial_refund"|"normal"|"unknown"}
 */
export function getRaceOutcomeState(result) {
  const status = result?.raceStatus ?? result?.race_status ?? null;
  return KNOWN_STATES.has(status) ? status : RACE_OUTCOME.UNKNOWN;
}

/** @returns {number[]} 返還艇の艇番（未判定・値が無いときは空配列） */
export function getRefundBoats(result) {
  const boats = result?.refundBoats ?? result?.refund_boats ?? null;
  return Array.isArray(boats)
    ? boats.map(Number).filter((boat) => Number.isInteger(boat))
    : [];
}

/**
 * その艇が返還艇（F・L・欠）か。refund_boats が未判定なら false（今までどおり）。
 * @param {object|null|undefined} result
 * @param {number|string|null|undefined} boat
 */
export function isBoatRefunded(result, boat) {
  const n = Number(boat);
  if (!Number.isInteger(n)) return false;
  return getRefundBoats(result).includes(n);
}

/**
 * 1着を使った的中・外れの判定をしてよいか。
 * 結果が確定していて rank1 があり、不成立でないとき真。未判定（unknown）は今までどおり真。
 * @param {{finished?: boolean, rank1?: number|null}|null|undefined} result
 */
export function isJudgeable(result) {
  if (!result) return false;
  if (result.finished === false) return false;
  if (result.rank1 == null) return false;
  return getRaceOutcomeState(result) !== RACE_OUTCOME.NO_RACE;
}

/**
 * 買い目（艇番の組）の的中を判定してよいか。不成立のレースと、返還艇を含む買い目は対象外。
 * BOA-544 の calculateHits で、返還艇を含む勝式の is_hit を NULL にする判定に使う。
 * @param {object|null|undefined} result
 * @param {Array<number|string>} boats
 */
export function isBetJudgeable(result, boats) {
  if (!isJudgeable(result)) return false;
  return !(boats ?? []).some((boat) => isBoatRefunded(result, boat));
}

export const TURN_JUDGEMENT = Object.freeze({
  HIT: "hit",
  MISS: "miss",
  /** 判定対象外（不成立・結果未確定・予想なし） */
  NOT_JUDGEABLE: "not_judgeable",
});

/**
 * 展開予測（上位パターンの winnerCourse のいずれかが1着と一致すれば的中。実測的中率の定義と同じ）
 * の判定。重複除去前の patterns 全体で判定する（TurnPatternList のコメント参照）。
 *
 * - 不成立: 判定対象外
 * - 一部返還: 1着は決まっているので通常どおり判定する。返還艇の候補は1着になりえないため、
 *   表示の上で「判定対象外」の印を付ける（refundedCourses）
 *
 * @param {Array<{winnerCourse: number}>|null|undefined} patterns
 * @param {object|null|undefined} result
 * @returns {{status: "hit"|"miss"|"not_judgeable", winner: number|null, refundedCourses: number[]}}
 */
export function judgeTurnPrediction(patterns, result) {
  const refundedCourses = Array.isArray(patterns)
    ? [
        ...new Set(
          patterns
            .map((p) => p.winnerCourse)
            .filter((course) => isBoatRefunded(result, course)),
        ),
      ]
    : [];
  if (
    !Array.isArray(patterns) ||
    patterns.length === 0 ||
    !isJudgeable(result)
  ) {
    return {
      status: TURN_JUDGEMENT.NOT_JUDGEABLE,
      winner: null,
      refundedCourses,
    };
  }
  const winner = result.rank1;
  const hit = patterns.some((p) => p.winnerCourse === winner);
  return {
    status: hit ? TURN_JUDGEMENT.HIT : TURN_JUDGEMENT.MISS,
    winner,
    refundedCourses,
  };
}

/**
 * 結果ページの着欄の記号。refund=返還されるか（078: F・L・欠のみ）。
 * 意味は会場公式の出走表の「記号の説明」（宮島 2026-03-19 の出走表PDF）で確認した:
 * Ｆ…フライング返還 / Ｌ…出遅れ返還 / 欠…事前欠場 / 転…転覆失格 / 落…落水失格 /
 * 沈…沈没失格 / 妨…妨害失格 / エ…エンスト失格 / 不…不完走失格 / 失…その他の失格。
 * ＿ は不成立のレースで唯一フライングしなかった艇（着順なし）。
 * key は i18n の result.mark.<key>。
 */
export const FINISH_MARKS = Object.freeze({
  F: { key: "flying", refund: true },
  L: { key: "late", refund: true },
  欠: { key: "absent", refund: true },
  転: { key: "capsized", refund: false },
  落: { key: "fell", refund: false },
  沈: { key: "sank", refund: false },
  妨: { key: "obstruction", refund: false },
  エ: { key: "engineStall", refund: false },
  不: { key: "notFinished", refund: false },
  失: { key: "disqualified", refund: false },
  _: { key: "noPosition", refund: false },
});

const FULL_WIDTH_MARKS = { Ｆ: "F", Ｌ: "L", "＿": "_" };

/** 着欄の記号を正規化する（全角の Ｆ・Ｌ・＿ を半角に）。空・NULL は null */
export function normalizeFinishMark(mark) {
  if (mark == null) return null;
  const s = String(mark).trim();
  if (s === "") return null;
  return FULL_WIDTH_MARKS[s] ?? s;
}

/**
 * 払戻明細（race_payouts.bet_type、079）→ 画面の勝式キー（i18n の result.payoutType.*）と組番の区切り。
 * 並びは公式の結果ページと同じ 3連単・3連複・2連単・2連複・拡連複・単勝・複勝（BOA-558 の5、ユーザー判断）。
 * 以前は単勝・複勝を先頭にしたモックの並びだった。
 * race_results の payout_trio=3連単・payout_trifecta=3連複 の逆転は持ち込まない
 */
export const PAYOUT_BET_TYPES = Object.freeze([
  { betType: "3tan", typeKey: "trifecta", separator: "-" },
  { betType: "3fuku", typeKey: "trio", separator: "=" },
  { betType: "2tan", typeKey: "exacta", separator: "-" },
  { betType: "2fuku", typeKey: "quinella", separator: "=" },
  { betType: "wide", typeKey: "wide", separator: "=" },
  { betType: "win", typeKey: "win", separator: "" },
  { betType: "place", typeKey: "place", separator: "" },
]);

export const PAYOUT_STATUS = Object.freeze({
  PAID: "paid",
  SPECIAL: "special",
  NO_AMOUNT: "no_amount",
  NO_RACE: "no_race",
});

/** 最高配当の強調に使える払戻か（通常と特払だけ。不成立・金額なしは含めない） */
export function isPayoutAmountCountable(row) {
  return (
    (row?.status === PAYOUT_STATUS.PAID ||
      row?.status === PAYOUT_STATUS.SPECIAL) &&
    typeof row.amount === "number"
  );
}

/**
 * 正常にスタートした艇の数・完走した艇の数から、不成立になる勝式（race_payouts.bet_type）を返す（BOA-558）。
 *
 * 規程の原文は見つけられなかったため、本番の公式払戻（race_payouts）と着順の記号（race_start_timings）を
 * 突き合わせた実データで決めている（2026-10-02、返還・失格・完走不足のある154レースが全件この表に一致）:
 *   正常スタート4艇以上: なし／3艇: 3連複・拡連複／2艇: 複勝・2連複・拡連複・3連単・3連複／1艇以下: 全勝式
 *   返還が無くても完走が2艇だけのとき: 3連単・3連複／完走1艇以下: 全勝式
 * 表は scripts/maintenance/verify-race-outcome.js で固定している。
 * @param {{normalStarters: number, finishers?: number|null}} counts
 * @returns {Set<string>}
 */
export function expectedVoidBetTypes({ normalStarters, finishers = null }) {
  const all = PAYOUT_BET_TYPES.map((t) => t.betType);
  if (normalStarters <= 1 || (finishers != null && finishers <= 1)) {
    return new Set(all);
  }
  const types = new Set();
  if (normalStarters === 2) {
    ["place", "2fuku", "wide", "3tan", "3fuku"].forEach((b) => types.add(b));
  } else if (normalStarters === 3) {
    ["3fuku", "wide"].forEach((b) => types.add(b));
  }
  if (finishers === 2) ["3tan", "3fuku"].forEach((b) => types.add(b));
  return types;
}

/**
 * 一部の勝式だけ不成立になったレースで、その理由を事実として1行で言えるか判定する（BOA-558）。
 * 実際に不成立になった勝式（払戻明細）が上の表と一致するときだけ返す。一致しなければ、理由を
 * 断定できないので null（画面は何も書かない）。全勝式が不成立（レース不成立）・不成立が無いときも null。
 * @param {{boatsInRace: number, refundBoats: number[], finishers?: number|null,
 *   payoutRows: Array<{betType: string, status: string}>|null|undefined}} args
 * @returns {{kind: "starters"|"finishers", count: number, betTypes: string[]}|null}
 */
export function describePartialVoid({
  boatsInRace,
  refundBoats,
  finishers = null,
  payoutRows,
}) {
  const voided = new Set(
    (payoutRows ?? [])
      .filter((row) => row.status === PAYOUT_STATUS.NO_RACE)
      .map((row) => row.betType),
  );
  if (voided.size === 0 || voided.size === PAYOUT_BET_TYPES.length) return null;
  const ordered = PAYOUT_BET_TYPES.map((t) => t.betType).filter((b) =>
    voided.has(b),
  );
  const same = (expected) =>
    expected.size === voided.size && [...expected].every((b) => voided.has(b));
  const normalStarters = boatsInRace - refundBoats.length;
  if (same(expectedVoidBetTypes({ normalStarters }))) {
    return { kind: "starters", count: normalStarters, betTypes: ordered };
  }
  if (
    finishers != null &&
    same(expectedVoidBetTypes({ normalStarters: 6, finishers }))
  ) {
    return { kind: "finishers", count: finishers, betTypes: ordered };
  }
  return null;
}
