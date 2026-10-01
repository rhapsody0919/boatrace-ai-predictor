/**
 * RaceResult - レース結果表示コンポーネント（着順・配当・決まり手のみ）
 *
 * 2026-09-16(BOA-346): 従来ここにあった「答え合わせ」ロジック
 * （イン崩れ指数の的中/不的中判定showVolatilityOutcome/isUpset、展開予測の実測精度）は
 * 「AI予想」タブ（RaceAiPredictionTab.jsx）へ移設した。結果タブは着順・配当・決まり手の
 * みのシンプルな内容に絞る方針（BOA-305〜312フィードバック#7の延長）
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateTechnique } from "./raceIndicators";
import { BOAT_COLORS } from "../../utils/colors";
import { supabaseDataService } from "../../services/supabaseDataService";
import { parseRaceId } from "../../utils/raceId";
import VenueDaySummaryCard from "./VenueDaySummaryCard";
import InlineFetchError from "../InlineFetchError";
import {
  FINISH_MARKS,
  PAYOUT_BET_TYPES,
  PAYOUT_STATUS,
  RACE_OUTCOME,
  getRaceOutcomeState,
  getRefundBoats,
  isBoatRefunded,
  isPayoutAmountCountable,
  normalizeFinishMark,
} from "../../utils/raceOutcome";

// スタートのダイナミック演出（全艇が号砲と同時に走り出し、実ST比例の位置×時間で到達）の調整定数。
// 到達位置は0〜0.30秒（フライングは0〜0.15秒）の固定レンジで正規化する（レースが違っても位置の見た目の意味を揃えるため）。
// 到達までの時間はこのレース内の最遅STを基準（6秒）に相対比例させる（このレースだけの相対値）。
// 周期7秒: 最遅艇が6秒で到達し、そこから1秒静止してループする
const START_ANIM = {
  CYCLE_MS: 7000,
  MAX_ARRIVAL_MS: 6000,
  LINE_PERCENT: 84,
  POSITION_RANGE_PERCENT: 76,
  // 遅い側は0.30まで位置で差をつける（0.15で頭打ちにすると、0.16と0.27が同じ位置に重なっていた。
  // 平均STは0.15前後で、普通のレースでも半分近くの艇が左端に重なる。BOA-559 ファン評価1周目）
  POSITION_MAX_SECONDS: 0.3,
  // フライングは0.15までで位置の差をつける（F0.15で98%）
  FLYING_MAX_SECONDS: 0.15,
  OVERSHOOT_RATIO: 0.72,
  STREAK_FADE_IN_RATIO: 0.26,
  IMPACT_FLASH_DELTA: 0.001,
  IMPACT_EXPAND_DELTA: 0.0703,
  // フライング艇はスタートライン（84%）より先、F0.15 で98%まで（BOA-559）
  FLYING_RANGE_PERCENT: 14,
  // フライング艇は号砲の時点で既にラインを越えているため、最も早く到達させる（周期に対する割合）
  FLYING_ARRIVAL_FRACTION: 0.04,
};

// フライング艇（F）の ST は「号砲より何秒早くラインを越えたか」。遅れた艇と同じ式で置くと、ラインの
// 手前（遅いスタート）に描かれてしまう（浜名湖 9/14 6R の F0.11 が最も遅い艇に見えた。BOA-559）。
// F はラインより先に置く
function getFinalPositionPercent(startTiming, isFlying = false) {
  const max = isFlying
    ? START_ANIM.FLYING_MAX_SECONDS
    : START_ANIM.POSITION_MAX_SECONDS;
  const ratio = Math.min(Math.max(startTiming, 0), max) / max;
  return isFlying
    ? START_ANIM.LINE_PERCENT + ratio * START_ANIM.FLYING_RANGE_PERCENT
    : START_ANIM.LINE_PERCENT - ratio * START_ANIM.POSITION_RANGE_PERCENT;
}

// 選手名は公式の元データで姓と名の間を全角スペースで詰めてある（「丹下」「将」の間に全角スペース3つ）。そのまま出すと
// 375pxで姓だけに切れ、級別も見えなくなるため、空白を1つにまとめる（BOA-559）
function displayName(name) {
  return name ? name.replace(/[\s\u3000]+/g, " ").trim() : name;
}

function BoatChip({ number }) {
  const color = BOAT_COLORS[number] || BOAT_COLORS[1];
  return (
    <span
      className="rr-boat-chip"
      style={{ background: color.bg, color: color.text }}
    >
      {number}
    </span>
  );
}

// 船シルエット（矢尻型、進行方向=右に舳先）のマーカー。号砲(t=0)から自艇の静止位置まで
// 動き、到達タイミングもSTに比例させる。CSSの@keyframesはオフセット・値の両方に変数を
// 使えないため、実測ST値から動的にキーフレームを生成するWeb Animations APIを使う
function StartTimingTrack({
  boatNumber,
  startTiming,
  isFlying,
  maxStartTiming,
  reducedMotion,
}) {
  const dotRef = useRef(null);
  const streakRef = useRef(null);
  const impactRef = useRef(null);
  const color = BOAT_COLORS[boatNumber] || BOAT_COLORS[1];
  const markerColor = isFlying ? "var(--color-error-text)" : color.bg;
  const finalPosition = getFinalPositionPercent(startTiming, isFlying);
  // 到達オフセットは周期(7秒)全体に対する割合。最遅艇でもMAX_ARRIVAL_MS(6秒)/CYCLE_MS(7秒)を
  // 超えないため、この後の号砲フラッシュ・衝撃波の追加オフセットが必ず1未満に収まる
  const arrivalFraction = isFlying
    ? START_ANIM.FLYING_ARRIVAL_FRACTION
    : maxStartTiming > 0
      ? Math.min(startTiming / maxStartTiming, 1) *
        (START_ANIM.MAX_ARRIVAL_MS / START_ANIM.CYCLE_MS)
      : 0;

  useEffect(() => {
    if (reducedMotion) return undefined;
    const dot = dotRef.current;
    const streak = streakRef.current;
    const impact = impactRef.current;
    if (!dot || !streak || !impact) return undefined;

    const overshoot = arrivalFraction * START_ANIM.OVERSHOOT_RATIO;
    const fadeIn = arrivalFraction * START_ANIM.STREAK_FADE_IN_RATIO;
    const flash = Math.min(
      arrivalFraction + START_ANIM.IMPACT_FLASH_DELTA,
      0.999,
    );
    const expand = Math.min(
      arrivalFraction + START_ANIM.IMPACT_EXPAND_DELTA,
      1,
    );
    const baseOptions = {
      duration: START_ANIM.CYCLE_MS,
      iterations: Infinity,
    };

    const animations = [
      dot.animate(
        [
          {
            offset: 0,
            left: "0%",
            transform: "translate(-100%, -50%) scale(0.7)",
          },
          {
            offset: overshoot,
            left: `${finalPosition}%`,
            transform: "translate(-100%, -50%) scale(1.35)",
          },
          {
            offset: arrivalFraction,
            left: `${finalPosition}%`,
            transform: "translate(-100%, -50%) scale(1)",
          },
          {
            offset: 1,
            left: `${finalPosition}%`,
            transform: "translate(-100%, -50%) scale(1)",
          },
        ],
        { ...baseOptions, easing: "cubic-bezier(0.15, 0.85, 0.25, 1)" },
      ),
      streak.animate(
        [
          { offset: 0, width: "0%", opacity: 0 },
          { offset: fadeIn, opacity: 1 },
          { offset: arrivalFraction, width: `${finalPosition}%`, opacity: 0 },
          { offset: 1, width: `${finalPosition}%`, opacity: 0 },
        ],
        { ...baseOptions, easing: "cubic-bezier(0.15, 0.85, 0.25, 1)" },
      ),
      impact.animate(
        [
          {
            offset: 0,
            opacity: 0,
            transform: "translate(-50%, -50%) scale(1)",
          },
          {
            offset: arrivalFraction,
            opacity: 0,
            transform: "translate(-50%, -50%) scale(1)",
          },
          {
            offset: flash,
            opacity: 0.9,
            transform: "translate(-50%, -50%) scale(1)",
          },
          {
            offset: expand,
            opacity: 0,
            transform: "translate(-50%, -50%) scale(6)",
          },
          {
            offset: 1,
            opacity: 0,
            transform: "translate(-50%, -50%) scale(6)",
          },
        ],
        { ...baseOptions, easing: "ease-out" },
      ),
    ];

    return () => animations.forEach((animation) => animation.cancel());
  }, [arrivalFraction, finalPosition, reducedMotion]);

  return (
    <span className="rr-st-track">
      <span className="rr-st-line" />
      <span
        ref={streakRef}
        className="rr-st-streak"
        style={{
          left: 0,
          width: reducedMotion ? `${finalPosition}%` : 0,
          opacity: 0,
          background: markerColor,
        }}
      />
      <span
        ref={dotRef}
        className={`rr-st-dot${boatNumber === 1 && !isFlying ? " is-white" : ""}`}
        style={{ left: reducedMotion ? `${finalPosition}%` : "0%" }}
      >
        {/* 形（clip-path）は子に持たせる。親に付けた輪郭（drop-shadow）が
            clip-path で切り取られないようにするため（1号艇の白が1着行の
            クリーム地・トラックに埋もれていた。BOA-559 ファン評価2周目） */}
        <span className="rr-st-dot-shape" style={{ background: markerColor }} />
      </span>
      <span
        ref={impactRef}
        className="rr-st-impact"
        style={{
          left: `${finalPosition}%`,
          borderColor: markerColor,
          opacity: 0,
        }}
      />
    </span>
  );
}

// 結果表の行を組み立てる（BOA-543）。rank1〜rank6 は公式ページの並び順のままで、
// 返還艇（F・L・欠）や不成立レースの艇も着順の列に入っている（浜名湖 2026-09-14 6R の
// rank=4-1-2 はうち1・2号艇がF）。そのため race_start_timings の finish_rank・finish_mark が
// あるときはそちらで着順を組み立て、着が数字でない艇（F・L・欠・落・転・妨・＿ 等）は
// 着順から外して公式の記号のまま末尾に並べる。
// 不成立（raceStatus='no_race'）は着順が無いので、全艇を枠順に記号で並べる。
// 返還艇（refundBoats）は、着欄が数字でも着順に入れない（繰り上げもしない）。
// finish_mark が1行も無い（取得失敗・2026-09-21より前の大半）ときは rank1〜 を着順として使い、
// 成立状態が分かっていれば返還艇だけを着順から外す。
//
// 行: { key, boat, position(1〜6 | null), mark(正規化した記号 | null), refunded, time }
function buildResultRows(result, startTimings, boatsInRace) {
  const outcome = getRaceOutcomeState(result);
  const isNoRace = outcome === RACE_OUTCOME.NO_RACE;
  // レースタイムは race_time1〜6 が rank1〜6 と同じ並びで入っているため、艇→列の位置で引く
  const rankIndexByBoat = new Map();
  [1, 2, 3, 4, 5, 6].forEach((position) => {
    const boat = result[`rank${position}`];
    if (boat && !rankIndexByBoat.has(boat)) {
      rankIndexByBoat.set(boat, position - 1);
    }
  });
  const timeOf = (boat) =>
    rankIndexByBoat.has(boat)
      ? (result.raceTimes?.[rankIndexByBoat.get(boat)] ?? null)
      : null;
  const unrankedRow = (boat, mark) => ({
    key: `boat-${boat}`,
    boat,
    position: null,
    mark,
    refunded:
      isBoatRefunded(result, boat) || Boolean(FINISH_MARKS[mark]?.refund),
    // 着順の無い艇（返還・失格・不成立）にはレースタイムを出さない（公式と同じ）
    time: null,
  });

  const hasFinishData = (startTimings ?? []).some(
    (st) => st.finishMark != null,
  );
  if (!hasFinishData) {
    if (isNoRace) {
      return boatsInRace.map((boat) => unrankedRow(boat, null));
    }
    const ranked = [1, 2, 3, 4, 5, 6]
      .map((position) => ({ position, boat: result[`rank${position}`] }))
      .filter((row) => row.boat && !isBoatRefunded(result, row.boat))
      .map(({ position, boat }) => ({
        key: `rank-${position}`,
        boat,
        position,
        mark: null,
        refunded: false,
        time: result.raceTimes?.[position - 1] ?? null,
      }));
    const refunded = getRefundBoats(result)
      .filter((boat) => !ranked.some((row) => row.boat === boat))
      .sort((a, b) => a - b)
      .map((boat) => unrankedRow(boat, null));
    return [...ranked, ...refunded];
  }

  const isRanked = (st) =>
    !isNoRace &&
    st.finishRank != null &&
    /^[1-6]$/.test(String(st.finishMark ?? "")) &&
    !isBoatRefunded(result, st.boatNumber);
  const ranked = startTimings
    .filter(isRanked)
    .sort((a, b) => a.finishRank - b.finishRank || a.boatNumber - b.boatNumber)
    .map((st) => ({
      key: `boat-${st.boatNumber}`,
      boat: st.boatNumber,
      position: st.finishRank,
      mark: null,
      refunded: false,
      time: timeOf(st.boatNumber),
    }));
  const unranked = startTimings
    .filter((st) => !isRanked(st))
    .sort((a, b) => a.boatNumber - b.boatNumber)
    .map((st) => {
      const mark = normalizeFinishMark(st.finishMark);
      // 着欄が数字なのに着順に入れない艇（不成立のレース・返還艇。本来は無い）は、数字を
      // 着順のように見せないよう記号を外す（不成立なら「着順なし」、返還なら「返還」のラベル）
      const isNumeric = mark != null && /^[1-6]$/.test(mark);
      return unrankedRow(
        st.boatNumber,
        isNumeric ? (isNoRace ? "_" : null) : mark,
      );
    });
  return [...ranked, ...unranked];
}

// 着欄の記号の短いラベル（「F（フライング・返還）」等）。記号が分からない返還艇は「返還」、
// 不成立で記号の無い艇は「着順なし（不成立）」。意味は src/utils/raceOutcome.js の FINISH_MARKS
function markLabel(t, row, isNoRace) {
  // 「＿」は不成立のレースにしか出ない記号だが、成立状態が届いていない（109未適用）ときに
  // 「（不成立）」と書くと、同じページの的中表示（成立状態を知らない）と食い違う。そのときは
  // 「着順なし」だけにする（ファン評価 第1周 指摘1）
  if (row.mark === "_" && !isNoRace) return t("result.mark.noPositionPlain");
  const info = row.mark ? FINISH_MARKS[row.mark] : null;
  if (info) return t(`result.mark.${info.key}`);
  if (row.refunded) return t("result.mark.refunded");
  if (isNoRace) return t("result.mark.noPosition");
  return null;
}

// 着欄の表示。「＿」（着順なし）は罫線と見分けにくいので「—」にする
function markSymbol(row) {
  if (row.mark === "_" || row.mark == null) return "—";
  return row.mark;
}

// 不成立の理由の1行（「フライング5艇（1・2・3・5・6号艇）で不成立」）。着順なし（＿）以外の
// 全艇が返還の記号（F・L・欠）のときだけ出す。それ以外（失格が混ざる等）は理由を省く
function noRaceReason(t, rows) {
  const others = rows.filter((row) => row.mark !== "_");
  if (
    others.length === 0 ||
    !others.every((row) => FINISH_MARKS[row.mark]?.refund)
  ) {
    return null;
  }
  const groups = new Map();
  others.forEach((row) => {
    if (!groups.has(row.mark)) groups.set(row.mark, []);
    groups.get(row.mark).push(row.boat);
  });
  const separator = t("result.noRace.boatSeparator");
  const list = [...groups.entries()]
    .map(([mark, boats]) =>
      t(`result.noRace.group.${FINISH_MARKS[mark].key}`, {
        count: boats.length,
        boats: boats.join(separator),
      }),
    )
    .join(t("result.noRace.groupSeparator"));
  return t("result.noRace.reason", { list });
}

function PayoutRow({
  typeLabel,
  boats,
  separator,
  amount,
  popularity,
  popularityTo = null,
  popularityMarked = false,
  isBest,
  note = null,
  isVoid = false,
  noAmount = false,
  t,
}) {
  return (
    <div
      className={`rr-payout-row${isBest ? " is-best" : ""}${isVoid ? " is-void" : ""}`}
    >
      <span className="rr-payout-type">{typeLabel}</span>
      <span className="rr-combo">
        {note ? (
          <span className="rr-payout-note">{note}</span>
        ) : (
          boats.map((boat, index) => (
            <span className="rr-combo-item" key={`${boat}-${index}`}>
              {index > 0 && <span className="sep">{separator}</span>}
              <BoatChip number={boat} />
            </span>
          ))
        )}
      </span>
      <span className="rr-pop">
        {popularity
          ? popularityTo
            ? t("result.popularityRange", {
                from: popularity,
                to: popularityTo,
              })
            : t("result.popularity", { rank: popularity })
          : ""}
        {popularity && popularityMarked && (
          <span className="rr-pop-mark" aria-hidden="true">
            ※
          </span>
        )}
      </span>
      <span
        className="rr-amount num"
        title={noAmount ? t("result.payoutNoAmount") : undefined}
      >
        {typeof amount === "number"
          ? `¥${amount.toLocaleString()}`
          : noAmount
            ? "—"
            : ""}
      </span>
    </div>
  );
}

// 払戻明細（race_payouts）の行で払戻表を出す（BOA-543）。不成立は「不成立（返還）」とだけ書き、
// 金額（返還額の¥100）は出さない。特払は組番の位置に「特払」、金額なしは組番だけ。
// 最高配当の強調は、通常の払戻と特払だけで計算する
function PayoutRowsTable({ rows, t }) {
  const amounts = rows.filter(isPayoutAmountCountable).map((row) => row.amount);
  // 最高額が ¥100（元返し）のときは強調しない。一部返還で単勝・2連単がともに ¥100 だった
  // レースで、¥100 の2行が「最高配当」として金色になっていた（BOA-558）
  const maxAmount =
    amounts.length && Math.max(...amounts) > 100 ? Math.max(...amounts) : null;
  return (
    <div className="rr-payout-table">
      {rows.map((row) => {
        const isNoRaceRow = row.status === PAYOUT_STATUS.NO_RACE;
        const isSpecial = row.status === PAYOUT_STATUS.SPECIAL;
        return (
          <PayoutRow
            key={`${row.betType}-${row.seq}`}
            typeLabel={t(`result.payoutType.${row.typeKey}`)}
            boats={row.boats}
            separator={row.separator}
            amount={isNoRaceRow ? null : row.amount}
            popularity={isNoRaceRow ? null : row.popularity}
            popularityTo={isNoRaceRow ? null : (row.popularityTo ?? null)}
            popularityMarked={!isNoRaceRow && !!row.popularityFromFinalOdds}
            isBest={
              isPayoutAmountCountable(row) &&
              maxAmount != null &&
              row.amount === maxAmount
            }
            note={
              isNoRaceRow
                ? t("result.payoutNoRace")
                : isSpecial && row.boats.length === 0
                  ? t("result.payoutSpecial")
                  : null
            }
            isVoid={isNoRaceRow}
            // 公式の払戻に金額が無い行（例: 津 2026-09-27 1R の複勝6）。空欄だとデータの
            // 欠けに見えるので「—」を出す（BOA-558）
            noAmount={row.status === PAYOUT_STATUS.NO_AMOUNT}
            t={t}
          />
        );
      })}
    </div>
  );
}

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

function RaceResult({ prediction, raceId }) {
  // 会場コードと開催日は raceId から導出する（propsを増やさない）
  const parsedRaceId = parseRaceId(raceId);
  const { t } = useTranslation();
  // 取得結果は raceId とセットで持つ（別レースへ移ったとき前レースのデータを混ぜない）。
  // 失敗も state に残し、「データなし」と区別して InlineFetchError を出す（frontend-data-fetch.md）
  const [startTimingState, setStartTimingState] = useState({
    raceId: null,
    data: null,
    failed: false,
  });
  const [reloadKey, setReloadKey] = useState(0);
  // 締切時オッズ（公式、BOA-496）。単勝・複勝の人気を出すためだけに使う（BOA-534）。取れなくても払戻は出す
  const [finalOddsState, setFinalOddsState] = useState({
    raceId: null,
    data: null,
  });
  const reducedMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches),
    [],
  );

  const result = prediction?.result;
  const finished = Boolean(result?.finished);

  // スタート情報は1対多テーブル（race_start_timings）のため、一覧取得のRPCには
  // 含めず結果確定後にレース単位で個別フェッチする（BOA-238）
  useEffect(() => {
    if (!finished || !raceId) return undefined;
    let cancelled = false;
    supabaseDataService
      .getRaceStartTimings(raceId)
      .then((data) => {
        if (!cancelled) setStartTimingState({ raceId, data, failed: false });
      })
      .catch((err) => {
        // 取得失敗時はST列を空欄にし、着順は rank1〜 の表示に倒す（レイアウトは維持）。
        // 失敗したことは state に残して InlineFetchError を出す
        console.error(
          "スタートタイミング取得エラー:",
          err?.message ?? String(err),
        );
        if (!cancelled) {
          setStartTimingState({ raceId, data: null, failed: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [finished, raceId, reloadKey]);

  useEffect(() => {
    if (!finished || !raceId) return undefined;
    let cancelled = false;
    supabaseDataService
      .getRaceFinalOdds(raceId)
      .then((data) => {
        if (!cancelled) setFinalOddsState({ raceId, data });
      })
      .catch((err) => {
        // 単勝・複勝の人気を出さないだけ（公式の払戻と他の券種の人気はそのまま出す）
        console.error("締切時オッズ取得エラー:", err?.message ?? String(err));
        if (!cancelled) setFinalOddsState({ raceId, data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [finished, raceId]);

  const isCurrentRace = startTimingState.raceId === raceId;
  const startTimings = isCurrentRace ? startTimingState.data : null;
  const startTimingFailed = isCurrentRace && startTimingState.failed;

  if (!prediction || !result || !finished) {
    return null;
  }

  // is_cancelled は現状どのスクリプトからも書き込まれていない（BOA-238調査時点）。中止は
  // races.cancellation_status の担当（isRaceCancelled）で、結果の行自体が無い。
  // 不成立は旧フラグ is_no_race（全行 false）ではなく raceStatus で判定する（BOA-543、下の isNoRace）
  if (result.isCancelled) {
    return (
      <div className="race-result">
        <div className="result-empty-state">
          <h4>🏁 {t("result.title")}</h4>
          <div className="result-empty-icon">🚫</div>
          <p className="result-empty-title">{t("result.cancelledTitle")}</p>
          <p className="result-empty-body">{t("result.cancelledBody")}</p>
        </div>
      </div>
    );
  }

  const players = prediction.allPlayers ?? [];
  const findPlayer = (boat) => players.find((p) => p.number === boat);

  const outcome = getRaceOutcomeState(result);
  const isNoRace = outcome === RACE_OUTCOME.NO_RACE;
  const isPartialRefund = outcome === RACE_OUTCOME.PARTIAL_REFUND;
  // スタート情報（着欄の記号）を読み込んでいる間は、rank1〜 の並び（返還艇が混ざる）を
  // 一瞬でも着順として見せないよう、表の代わりにスケルトンを出す（BOA-543）
  // raceId が無いときは取得自体をしない（useEffect が早期 return する）ので、読み込み中にしない
  const isLoadingStartTimings = Boolean(raceId) && !isCurrentRace;

  // 統一結果テーブルの行（着／艇／選手名／ST／タイム）。バックフィルしていない過去データは
  // rank4以降が無いため、その場合は3行のみになる。返還艇の行も数に含める（BOA-543）
  const boatsInRace = players.length
    ? players.map((p) => p.number).sort((a, b) => a - b)
    : [1, 2, 3, 4, 5, 6];
  const rows = buildResultRows(result, startTimings, boatsInRace);
  const noRaceReasonText = isNoRace ? noRaceReason(t, rows) : null;

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
  // フライングは異常値のため「最速」判定・到達タイミングの基準（最遅ST）からは除外する
  // （update-top-start-stats.jsと同じ扱い。BOA-559）
  const nonFlyingStartTimings = validStartTimings.filter((st) => !st.isFlying);
  const maxStartTiming = nonFlyingStartTimings.length
    ? Math.max(...nonFlyingStartTimings.map((st) => st.startTiming))
    : 0;
  const fastestStartTiming = nonFlyingStartTimings.length
    ? Math.min(...nonFlyingStartTimings.map((st) => st.startTiming))
    : null;

  // 払戻は払戻明細（race_payouts、payoutRows）を正とする。届いていないときだけ旧 payout_* 列から
  // 同じ行の形を組み立てる（legacyPayoutRows）
  const payoutRowsToShow = withFinalOddsPopularity(
    result.payoutRows ?? legacyPayoutRows(result.payouts, outcome),
    finalOddsState.raceId === raceId ? finalOddsState.data : null,
  );
  const hasFinalOddsPopularity = (payoutRowsToShow ?? []).some(
    (row) => row.popularityFromFinalOdds,
  );

  const rowClassName = (position) => {
    if (position == null) return "rr-row is-unranked";
    if (position === 1) return "rr-row is-winner";
    if (position === 2) return "rr-row is-second";
    if (position === 3) return "rr-row is-third";
    return "rr-row";
  };

  return (
    <div className="race-result">
      <div className="rr-head">
        <div className="rr-title">
          <h4>🏁 {isNoRace ? t("result.noRace.title") : t("result.title")}</h4>
          {isPartialRefund && (
            <span className="rr-refund-tag">
              {getRefundBoats(result).length > 0
                ? t("result.refundTag")
                : t("result.partialNoRaceTag")}
            </span>
          )}
        </div>
        {!isNoRace && result.winningTechnique && (
          <span className="rr-tag">
            {t("result.winningTechniqueLabel", {
              technique: translateTechnique(t, result.winningTechnique),
            })}
          </span>
        )}
      </div>
      {isNoRace && (
        <p className="rr-outcome-note">
          {noRaceReasonText
            ? t("result.noRace.bodyWithReason", { reason: noRaceReasonText })
            : t("result.noRace.body")}
        </p>
      )}

      {!isLoadingStartTimings && courseOrder.length > 0 && (
        <div className="rr-course-order">
          <span className="rr-course-order-label">
            {t("result.courseOrderLabel")}
          </span>
          {courseOrder.map((boat) => (
            <BoatChip key={boat} number={boat} />
          ))}
        </div>
      )}
      {isLoadingStartTimings ? (
        <div className="rr-table-skeleton" aria-busy="true">
          {boatsInRace.map((boat) => (
            <div className="rr-skeleton-row" key={boat}>
              <span className="rr-skeleton-bar" />
            </div>
          ))}
        </div>
      ) : (
        <div className="rr-table">
          {rows.map((row) => {
            const { key, position, boat, time } = row;
            const player = findPlayer(boat);
            const st = startTimingByBoat.get(boat);
            const isFastest =
              Boolean(st) &&
              !st.isFlying &&
              fastestStartTiming != null &&
              st.startTiming === fastestStartTiming;
            const label = position == null ? markLabel(t, row, isNoRace) : null;

            return (
              <div className={rowClassName(position)} key={key}>
                <span className="rr-pos">
                  {position != null
                    ? t(`result.rank${position}`)
                    : markSymbol(row)}
                </span>
                <BoatChip number={boat} />
                <span className="rr-name">
                  <span className="rr-name-text" translate="no">
                    {displayName(player?.name)}
                    {player?.grade && <small>{player.grade}</small>}
                  </span>
                  {label && <span className="rr-mark-label">{label}</span>}
                  {st?.entryCourse != null && (
                    <span
                      className={`rr-course${st.entryCourse !== boat ? " is-moved" : ""}`}
                    >
                      {t("result.entryCourseLabel", {
                        course: st.entryCourse,
                      })}
                    </span>
                  )}
                </span>
                <span className="rr-st-cell">
                  {st && st.startTiming != null ? (
                    <>
                      <StartTimingTrack
                        boatNumber={boat}
                        startTiming={st.startTiming}
                        isFlying={st.isFlying}
                        maxStartTiming={maxStartTiming}
                        reducedMotion={reducedMotion}
                      />
                      <span className="rr-st-value num">
                        {/* フライングは公式と同じ「F.01」。選手ページ・直近10走とそろえる（BOA-583） */}
                        {st.isFlying
                          ? `F${st.startTiming.toFixed(2).replace(/^0/, "")}`
                          : st.startTiming.toFixed(2)}
                      </span>
                      {isFastest && (
                        <span className="rr-st-fastest-tag">
                          {t("result.fastestStartTag")}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="rr-st-value num">—</span>
                  )}
                </span>
                <span className="rr-time num">{time || "—"}</span>
              </div>
            );
          })}
        </div>
      )}
      {startTimingFailed && (
        <InlineFetchError onRetry={() => setReloadKey((key) => key + 1)} />
      )}
      {/* ST図の読み方。初見では黄線が何か・どちらが早いかが分からない
          （BOA-559 ファン評価3周目） */}
      {validStartTimings.length > 0 && (
        <p className="rr-note rr-st-legend">{t("result.stLegend")}</p>
      )}
      {/* 以前は「進入コースは精度確認中のため表示していない」と出していた（BOA-238 の頃は
          進入の元データが無かった）。今は本番STの進入を出すので、データが無いレースだけ断る（BOA-625） */}
      {!isLoadingStartTimings && !isNoRace && courseOrder.length === 0 && (
        <p className="rr-note">{t("result.courseNoData")}</p>
      )}
      {!isLoadingStartTimings && !isNoRace && rows.length < 6 && (
        <p className="rr-note rr-note-missing-ranks">
          {t("result.missingRanksNote")}
        </p>
      )}

      {payoutRowsToShow && (
        <>
          <div className="rr-section-title">
            {t("result.payoutSectionTitle")}
          </div>
          <PayoutRowsTable rows={payoutRowsToShow} t={t} />
          {/* 単勝・複勝の人気だけは公式の発表でなく締切時オッズから出しているため、その旨を書く */}
          {hasFinalOddsPopularity && (
            <p
              className="rr-note rr-payout-popularity-note"
              data-testid="payout-popularity-note"
            >
              {t("result.popularityFromFinalOddsNote")}
            </p>
          )}
          {/* 「—」の意味は title だけだとスマホで読めないので、表の下にも書く（#1074 ファン評価1周目） */}
          {payoutRowsToShow.some(
            (row) => row.status === PAYOUT_STATUS.NO_AMOUNT,
          ) && (
            <p className="rr-note rr-payout-no-amount-note">
              {t("result.payoutNoAmountNote")}
            </p>
          )}
        </>
      )}

      {/* この日の水面傾向（phase a FR-5 / BOA-222）。払戻の下＝結果タブの最下部。
          払戻が無い過去データでも出すため、払戻の条件ブロックの外に置く */}
      {parsedRaceId && (
        <VenueDaySummaryCard
          venueCode={parsedRaceId.venueCode}
          date={parsedRaceId.date}
          raceId={raceId}
        />
      )}
    </div>
  );
}

export default RaceResult;
