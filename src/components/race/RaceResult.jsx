/**
 * RaceResult - レース結果表示コンポーネント
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import TurnPatternList from "./TurnPatternList";
import { translateTechnique } from "./raceIndicators";
import { getVolatilityLevel } from "../../utils/volatilityLevel";
import { BOAT_COLORS } from "../../utils/colors";
import { supabaseDataService } from "../../services/supabaseDataService";

// スタートのダイナミック演出（全艇が号砲と同時に走り出し、実ST比例の位置×時間で到達）の調整定数。
// 到達位置は0〜0.15秒の固定レンジで正規化する（レースが違っても位置の見た目の意味を揃えるため）。
// 到達までの時間はこのレース内の最遅STを基準（6秒）に相対比例させる（このレースだけの相対値）。
// 周期7秒: 最遅艇が6秒で到達し、そこから1秒静止してループする
const START_ANIM = {
  CYCLE_MS: 7000,
  MAX_ARRIVAL_MS: 6000,
  LINE_PERCENT: 84,
  POSITION_RANGE_PERCENT: 76,
  POSITION_MAX_SECONDS: 0.15,
  OVERSHOOT_RATIO: 0.72,
  STREAK_FADE_IN_RATIO: 0.26,
  IMPACT_FLASH_DELTA: 0.001,
  IMPACT_EXPAND_DELTA: 0.0703,
};

function getFinalPositionPercent(startTiming) {
  const clamped = Math.min(
    Math.max(startTiming, 0),
    START_ANIM.POSITION_MAX_SECONDS,
  );
  return (
    START_ANIM.LINE_PERCENT -
    (clamped / START_ANIM.POSITION_MAX_SECONDS) *
      START_ANIM.POSITION_RANGE_PERCENT
  );
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
  const finalPosition = getFinalPositionPercent(startTiming);
  // 到達オフセットは周期(7秒)全体に対する割合。最遅艇でもMAX_ARRIVAL_MS(6秒)/CYCLE_MS(7秒)を
  // 超えないため、この後の号砲フラッシュ・衝撃波の追加オフセットが必ず1未満に収まる
  const arrivalFraction =
    maxStartTiming > 0
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
            transform: "translate(-50%, -50%) scale(0.7)",
          },
          {
            offset: overshoot,
            left: `${finalPosition}%`,
            transform: "translate(-50%, -50%) scale(1.35)",
          },
          {
            offset: arrivalFraction,
            left: `${finalPosition}%`,
            transform: "translate(-50%, -50%) scale(1)",
          },
          {
            offset: 1,
            left: `${finalPosition}%`,
            transform: "translate(-50%, -50%) scale(1)",
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
        className="rr-st-dot"
        style={{
          left: reducedMotion ? `${finalPosition}%` : "0%",
          background: markerColor,
          outline:
            boatNumber === 1 && !isFlying
              ? "1px solid var(--border-hairline)"
              : "none",
        }}
      />
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

function PayoutRow({
  typeLabel,
  boats,
  separator,
  amount,
  popularity,
  isBest,
  t,
}) {
  return (
    <div className={`rr-payout-row${isBest ? " is-best" : ""}`}>
      <span className="rr-payout-type">{typeLabel}</span>
      <span className="rr-combo">
        {boats.map((boat, index) => (
          <span className="rr-combo-item" key={`${boat}-${index}`}>
            {index > 0 && <span className="sep">{separator}</span>}
            <BoatChip number={boat} />
          </span>
        ))}
      </span>
      <span className="rr-pop">
        {popularity ? t("result.popularity", { rank: popularity }) : ""}
      </span>
      <span className="rr-amount num">¥{amount.toLocaleString()}</span>
    </div>
  );
}

function RaceResult({ prediction, raceId }) {
  const { t } = useTranslation();
  const [startTimings, setStartTimings] = useState(null);
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
    if (!finished || !raceId) {
      setStartTimings(null);
      return undefined;
    }
    let cancelled = false;
    supabaseDataService.getRaceStartTimings(raceId).then((data) => {
      if (!cancelled) setStartTimings(data);
    });
    return () => {
      cancelled = true;
    };
  }, [finished, raceId]);

  if (!prediction || !result || !finished) {
    return null;
  }

  // is_cancelled/is_no_raceは現状どのスクリプトからも書き込まれていない（BOA-238調査時点）。
  // 将来の中止検知バッチ実装に備えて表示だけ先に用意しておくが、常にfalseのため今は使われない
  if (result.isCancelled || result.isNoRace) {
    return (
      <div className="race-result">
        <h4>🏁 {t("result.title")}</h4>
        <div className="result-empty-state">
          <div className="result-empty-icon">🚫</div>
          <p className="result-empty-title">
            {result.isCancelled
              ? t("result.cancelledTitle")
              : t("result.noRaceTitle")}
          </p>
          <p className="result-empty-body">
            {result.isCancelled
              ? t("result.cancelledBody")
              : t("result.noRaceBody")}
          </p>
        </div>
      </div>
    );
  }

  // 的中判定（BOA-174/175/178: unifiedモデルの的中は展開予測的中のみを
  // 対象とする。複勝予想の検証は表示しない方針に統一、ADR 0013参照）
  const turnPatterns = prediction.turnPrediction?.patterns;
  const hasTurnPrediction =
    Array.isArray(turnPatterns) && turnPatterns.length > 0;

  // イン崩れ指数は確率的な傾向予測のため二値的中判定は行わない（下記コメント参照）。
  // 予測レベルと実際の結果を判定なしで併記するのみに留める
  const volatilityLevel = prediction.volatilityPercentileIsFallback
    ? null
    : getVolatilityLevel(prediction.volatilityPercentile);
  const showVolatilityOutcome =
    volatilityLevel === "high" || volatilityLevel === "low";
  const isUpset = result.rank1 !== 1;
  const volatilityPercentileValue = Math.round(
    (prediction.volatilityPercentile ?? 0) * 100,
  );

  const players = prediction.allPlayers ?? [];
  const findPlayer = (boat) => players.find((p) => p.number === boat);

  // 統一結果テーブルの行（着／艇／選手名／ST／タイム）。バックフィルしていない過去データは
  // rank4以降が無いため、その場合は3行のみになる
  const rows = [1, 2, 3, 4, 5, 6]
    .map((position) => ({ position, boat: result[`rank${position}`] }))
    .filter((row) => row.boat);

  const startTimingByBoat = new Map(
    (startTimings ?? []).map((st) => [st.boatNumber, st]),
  );
  const validStartTimings = (startTimings ?? []).filter(
    (st) => st.startTiming != null,
  );
  const maxStartTiming = validStartTimings.length
    ? Math.max(...validStartTimings.map((st) => st.startTiming))
    : 0;
  // フライングは異常値のため「最速」判定からは除外する（update-top-start-stats.jsと同じ扱い）
  const nonFlyingStartTimings = validStartTimings.filter((st) => !st.isFlying);
  const fastestStartTiming = nonFlyingStartTimings.length
    ? Math.min(...nonFlyingStartTimings.map((st) => st.startTiming))
    : null;

  const payouts = result.payouts || {};
  const payoutAmounts = [
    payouts.win?.amount,
    ...(payouts.place || []).map((entry) => entry.amount),
    payouts.sanrenpuku?.amount,
    payouts.sanrentan?.amount,
    payouts.exacta?.amount,
    payouts.quinella?.amount,
    ...(payouts.wide || []).map((entry) => entry.amount),
  ].filter((amount) => typeof amount === "number");
  const maxPayoutAmount = payoutAmounts.length
    ? Math.max(...payoutAmounts)
    : null;

  const rowClassName = (position) => {
    if (position === 1) return "rr-row is-winner";
    if (position === 2) return "rr-row is-second";
    if (position === 3) return "rr-row is-third";
    return "rr-row";
  };

  return (
    <div className="race-result">
      <div className="rr-head">
        <h4>🏁 {t("result.title")}</h4>
        {result.winningTechnique && (
          <span className="rr-tag">
            {t("result.winningTechniqueLabel", {
              technique: translateTechnique(t, result.winningTechnique),
            })}
          </span>
        )}
      </div>

      <div className="rr-table">
        {rows.map(({ position, boat }) => {
          const player = findPlayer(boat);
          const st = startTimingByBoat.get(boat);
          const time = result.raceTimes?.[position - 1];
          const isFastest =
            Boolean(st) &&
            !st.isFlying &&
            fastestStartTiming != null &&
            st.startTiming === fastestStartTiming;

          return (
            <div className={rowClassName(position)} key={position}>
              <span className="rr-pos">{t(`result.rank${position}`)}</span>
              <BoatChip number={boat} />
              <span className="rr-name">
                {player?.name}
                {player?.grade && <small>{player.grade}</small>}
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
                      {st.isFlying ? "F" : ""}
                      {st.startTiming.toFixed(2)}
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
      <p className="rr-note">{t("result.courseNote")}</p>

      {payouts.win && (
        <>
          <div className="rr-section-title">
            {t("result.payoutSectionTitle")}
          </div>
          <div className="rr-payout-table">
            <PayoutRow
              typeLabel={t("result.payoutType.win")}
              boats={payouts.win.boats}
              separator=""
              amount={payouts.win.amount}
              isBest={payouts.win.amount === maxPayoutAmount}
              t={t}
            />
            {payouts.place.map((entry) => (
              <PayoutRow
                key={entry.boat}
                typeLabel={t("result.payoutType.place")}
                boats={[entry.boat]}
                separator=""
                amount={entry.amount}
                isBest={entry.amount === maxPayoutAmount}
                t={t}
              />
            ))}
            {/* 英語の正しい賭式名はTrifecta=着順通り(3連単)/Trio=順不同(3連複)。
                JSのキー名はsanrenpuku(3連複)/sanrentan(3連単)という曖昧さの無い名前にしているため
                表示ラベルのi18nキーとJSキー名が逆対応になる点に注意（buildRaceResult()のコメント参照） */}
            {payouts.sanrenpuku && (
              <PayoutRow
                typeLabel={t("result.payoutType.trio")}
                boats={payouts.sanrenpuku.boats}
                separator="="
                amount={payouts.sanrenpuku.amount}
                popularity={payouts.sanrenpuku.popularity}
                isBest={payouts.sanrenpuku.amount === maxPayoutAmount}
                t={t}
              />
            )}
            {payouts.sanrentan && (
              <PayoutRow
                typeLabel={t("result.payoutType.trifecta")}
                boats={payouts.sanrentan.boats}
                separator="-"
                amount={payouts.sanrentan.amount}
                popularity={payouts.sanrentan.popularity}
                isBest={payouts.sanrentan.amount === maxPayoutAmount}
                t={t}
              />
            )}
            {payouts.exacta && (
              <PayoutRow
                typeLabel={t("result.payoutType.exacta")}
                boats={payouts.exacta.boats}
                separator="-"
                amount={payouts.exacta.amount}
                popularity={payouts.exacta.popularity}
                isBest={payouts.exacta.amount === maxPayoutAmount}
                t={t}
              />
            )}
            {payouts.quinella && (
              <PayoutRow
                typeLabel={t("result.payoutType.quinella")}
                boats={payouts.quinella.boats}
                separator="="
                amount={payouts.quinella.amount}
                popularity={payouts.quinella.popularity}
                isBest={payouts.quinella.amount === maxPayoutAmount}
                t={t}
              />
            )}
            {payouts.wide.map((entry, index) => (
              <PayoutRow
                key={index}
                typeLabel={t("result.payoutType.wide")}
                boats={entry.boats}
                separator="="
                amount={entry.amount}
                popularity={entry.popularity}
                isBest={entry.amount === maxPayoutAmount}
                t={t}
              />
            ))}
          </div>
        </>
      )}

      {/* イン崩れ指数は「このレースは荒れやすい/堅い」という確率的な傾向予測であり、
          複勝予想・展開予測のような単発レースの二値的中判定にはなじまない
          （1レースが堅く決まっても「高リスク」判定が誤りだったとは言えない）。
          2026-08-14: 従来ここに表示していた単発レースの的中/不的中判定を削除。
          精度検証は集計ベース（BOA-177、着手待ち）に委ねる方針で統一した。
          2026-08-29: 判定なしの事実併記(予測レベル→実際の結果)を追加。
          2026-08-30: 分かりにくいとの指摘を受け、予測・結果を同じ語彙（堅い⇄崩れやすい）で
          並べ対応関係を明確化。パーセンタイル数値も併記（数値を隠す方がむしろ「高い/低い」
          の2値ラベルだけを見て的中/不的中と誤読されやすいとの判断、天気予報の降水確率と同じ
          考え方）。単発レースの正誤は判断できない旨の注記と精度分析ページへの導線を追加 */}
      {showVolatilityOutcome && (
        <div className="result-verify-section">
          <h5 className="result-verify-title">
            {t("result.volatilitySectionTitle")}
          </h5>
          <p className="result-volatility-line">
            {t("result.volatilityPredictedWithPercentile", {
              label: t(
                `volatility.level${volatilityLevel === "high" ? "High" : "Low"}`,
              ),
              percentile: volatilityPercentileValue,
            })}
          </p>
          <p className="result-volatility-line">
            {t("result.volatilityOutcomeLabel")}
            {": "}
            <strong>
              {isUpset
                ? t("result.volatilityOutcomeCollapsed")
                : t("result.volatilityOutcomeSolid")}
            </strong>
            {isUpset
              ? t("result.volatilityOutcomeDetailUpset", {
                  winner: result.rank1,
                })
              : t("result.volatilityOutcomeDetailFavorite")}
          </p>
          <p className="result-volatility-caveat">
            {t("result.volatilityCaveat")}{" "}
            <Link to="/accuracy">{t("result.volatilityCaveatLink")}</Link>
          </p>
        </div>
      )}

      {/* 展開予測: 実測的中率（約80%）は「上位予想のいずれかが的中すれば的中」という
          定義のため、単一の断定予想ではなく確率付きランキングとして正直に見せる */}
      {hasTurnPrediction && (
        <div className="result-verify-section">
          <h5 className="result-verify-title">
            {t("result.turnSectionTitle")}
          </h5>
          <TurnPatternList
            patterns={turnPatterns}
            actualWinner={result.rank1}
          />
        </div>
      )}
    </div>
  );
}

export default RaceResult;
