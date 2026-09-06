/**
 * RaceResult - レース結果表示コンポーネント
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import TurnPatternList from "./TurnPatternList";
import { translateTechnique } from "./raceIndicators";
import { getVolatilityLevel } from "../../utils/volatilityLevel";
import { BOAT_COLORS } from "../../utils/colors";
import { supabaseDataService } from "../../services/supabaseDataService";

// スタート情報の水面配置図で使う横軸レンジ（秒）。通常のSTは0.00〜0.20秒程度に収まる
const LANE_DIAGRAM_MAX_SECONDS = 0.2;

function BoatChip({ number }) {
  const color = BOAT_COLORS[number] || BOAT_COLORS[1];
  return (
    <span
      className="result-boat-chip"
      style={{ background: color.bg, color: color.text }}
    >
      {number}
    </span>
  );
}

function PayoutRow({ typeLabel, boats, separator, amount, popularity, t }) {
  return (
    <div className="result-payout-row">
      <span className="result-payout-type">{typeLabel}</span>
      <span className="result-payout-combo">
        {boats.map((boat, index) => (
          <span className="result-payout-combo-item" key={`${boat}-${index}`}>
            {index > 0 && <span className="result-combo-sep">{separator}</span>}
            <BoatChip number={boat} />
          </span>
        ))}
      </span>
      {popularity ? (
        <span className="result-payout-popularity">
          {t("result.popularity", { rank: popularity })}
        </span>
      ) : null}
      <span className="result-payout-amount">¥{amount.toLocaleString()}</span>
    </div>
  );
}

function RaceResult({ prediction, raceId }) {
  const { t } = useTranslation();
  const [startTimings, setStartTimings] = useState(null);

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

  // 4〜6着（バックフィルしていない過去データはrank4以降が無いため、その場合は非表示）
  const lateRanks = [4, 5, 6]
    .map((position) => ({
      position,
      boat: result[`rank${position}`],
      time: result.raceTimes?.[position - 1],
    }))
    .filter((entry) => entry.boat);

  const payouts = result.payouts || {};

  return (
    <div className="race-result">
      <h4>🏁 {t("result.title")}</h4>

      <div className="result-podium">
        <div className="podium-item first">
          <span className="rank">{t("result.rank1")}</span>
          <span className="boat-number">{result.rank1}</span>
        </div>
        <div className="podium-item second">
          <span className="rank">{t("result.rank2")}</span>
          <span className="boat-number">{result.rank2}</span>
        </div>
        <div className="podium-item third">
          <span className="rank">{t("result.rank3")}</span>
          <span className="boat-number">{result.rank3}</span>
        </div>
      </div>

      {lateRanks.length > 0 && (
        <div className="result-late-ranks">
          {lateRanks.map(({ position, boat, time }) => (
            <span className="result-late-rank-item" key={position}>
              <span className="result-late-rank-label">
                {t(`result.rank${position}`)}
              </span>
              <BoatChip number={boat} />
              {time && <span className="result-late-rank-time">{time}</span>}
            </span>
          ))}
        </div>
      )}

      {result.winningTechnique && (
        <div className="result-technique-badge">
          <span>
            {t("result.winningTechniqueLabel", {
              technique: translateTechnique(t, result.winningTechnique),
            })}
          </span>
        </div>
      )}

      {payouts.win && (
        <div className="result-section">
          <h5 className="result-section-title">
            {t("result.payoutSectionTitle")}
          </h5>
          <div className="result-payout-table">
            <PayoutRow
              typeLabel={t("result.payoutType.win")}
              boats={payouts.win.boats}
              separator=""
              amount={payouts.win.amount}
              t={t}
            />
            {payouts.place.map((entry) => (
              <PayoutRow
                key={entry.boat}
                typeLabel={t("result.payoutType.place")}
                boats={[entry.boat]}
                separator=""
                amount={entry.amount}
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
                t={t}
              />
            ))}
          </div>
        </div>
      )}

      {startTimings && startTimings.length > 0 && (
        <div className="result-section">
          <h5 className="result-section-title">
            {t("result.startTimingSectionTitle")}
          </h5>
          <div className="lane-diagram">
            {startTimings.map((st) => (
              <div className="lane-diagram-row" key={st.boatNumber}>
                <BoatChip number={st.boatNumber} />
                <div className="lane-diagram-bar">
                  <span
                    className={`lane-diagram-dot${st.isFlying ? " flying" : ""}`}
                    style={{
                      left: `${Math.min((st.startTiming ?? 0) / LANE_DIAGRAM_MAX_SECONDS, 1) * 100}%`,
                    }}
                  />
                </div>
                <span
                  className={`lane-diagram-value${st.isFlying ? " flying" : ""}`}
                >
                  {st.isFlying ? "F" : ""}
                  {st.startTiming != null ? st.startTiming.toFixed(2) : "-"}
                </span>
                {result.winningTechnique && st.boatNumber === result.rank1 && (
                  <span className="lane-diagram-tag">
                    {translateTechnique(t, result.winningTechnique)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* イン崩れ指数は「このレースは荒れやすい/堅い」という確率的な傾向予測であり、
          複勝予想・展開予測のような単発レースの二値的中判定にはなじまない
          （1レースが堅く決まっても「高リスク」判定が誤りだったとは言えない）。
          2026-08-14: 従来ここに表示していた単発レースの的中/不的中判定を削除。
          精度検証は集計ベース（BOA-177、着手待ち）に委ねる方針で統一した。
          2026-08-29: 判定なしの事実併記（予測レベル→実際の結果）を追加。
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
