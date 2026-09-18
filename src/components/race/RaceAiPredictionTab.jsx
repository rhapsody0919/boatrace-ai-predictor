/**
 * RaceAiPredictionTab - 「AI予想」独立タブ（BOA-346）
 *
 * 日和には無い龍神レーダー独自のAI予想機能を、既存の折りたたみ表示
 * （旧AiAnalysisSection、BOA-168）から独立タブへ格上げしたもの。
 * - 未確定レース: 展開予測カード（TurnPatternList）/イン崩れ指数バッジ
 *   （VolatilityDisplay）/出現パターン（OutcomePatternPreview）の3ブロックを表示
 * - 確定済みレース: 旧RaceResult.jsxが持っていた「答え合わせ」ロジック
 *   （イン崩れ指数の的中/不的中判定、展開予測の実測精度）をそのまま移設して表示
 *
 * 旧AiAnalysisSectionは「折りたたみ」であることに価値があったが、独立タブへの
 * 昇格によりタブ選択自体が開閉の役割を兼ねるため、アコーディオンの重複UIは
 * 廃止した（本命サマリー表示もOutcomePatternPreview内で艇番が分かるため省略）。
 */
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import VolatilityDisplay from "./VolatilityDisplay";
import TurnPatternList from "./TurnPatternList";
import PredictionCard from "./PredictionCard";
import OutcomePatternPreview from "./OutcomePatternPreview";
import { getVolatilityLevel } from "../../utils/volatilityLevel";

function RaceAiPredictionTab({ prediction, venueCode, venueName, raceId }) {
  const { t } = useTranslation();
  const result = prediction?.result;
  const finished = Boolean(result?.finished);

  const turnPatterns = prediction?.turnPrediction?.patterns;
  const hasTurnPrediction =
    Array.isArray(turnPatterns) && turnPatterns.length > 0;

  if (finished) {
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

    if (!showVolatilityOutcome && !hasTurnPrediction) {
      return (
        <div className="race-tabs-empty">
          <p>{t("aiPredictionTab.unavailableTitle")}</p>
        </div>
      );
    }

    return (
      <div className="race-ai-prediction-tab">
        {/* イン崩れ指数は「このレースは荒れやすい/堅い」という確率的な傾向予測であり、
            複勝予想・展開予測のような単発レースの二値的中判定にはなじまない
            （1レースが堅く決まっても「高リスク」判定が誤りだったとは言えない）。
            2026-08-14: 従来ここに表示していた単発レースの的中/不的中判定を削除。
            精度検証は集計ベース（BOA-177、着手待ち）に委ねる方針で統一した。
            2026-08-29: 判定なしの事実併記(予測レベル→実際の結果)を追加。
            2026-08-30: 分かりにくいとの指摘を受け、予測・結果を同じ語彙（堅い⇄崩れやすい）で
            並べ対応関係を明確化。パーセンタイル数値も併記（数値を隠す方がむしろ「高い/低い」
            の2値ラベルだけを見て的中/不的中と誤読されやすいとの判断、天気予報の降水確率と同じ
            考え方）。単発レースの正誤は判断できない旨の注記と精度分析ページへの導線を追加
            （2026-09-16、BOA-346でRaceResult.jsxから本タブへ移設） */}
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

  // 未確定レース: 「これから何が起きそうか」を示す未来志向の3ブロック
  if (!hasTurnPrediction && prediction?.volatilityPercentile == null) {
    return (
      <div className="race-tabs-empty">
        <p>{t("aiPredictionTab.unavailableTitle")}</p>
        <p className="race-tabs-empty-body">
          {t("aiPredictionTab.unavailableBody")}
        </p>
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        className="prediction-result"
        initial={{ opacity: 0, x: 10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2 }}
      >
        {/* ブロック1: 展開予測カード（FR2）。実測精度（動的）+ 今回の上位候補ランキング。
            以前はここにアニメーション（FirstMarkAnimation）も併記していたが、
            同じpatternsデータから異なる問い（複数シナリオの勝者候補 vs 単一
            シナリオの全着順）に答える2つの表示が数値レベルで食い違い、
            ユーザーから「よくわからないUX」との指摘を受けたため撤去した
            （2026-08-14。将来的に別の演出を検討する） */}
        {prediction.turnPrediction && prediction.allPlayers && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            <PredictionCard
              title={`🌊 ${t("turnPatternList.title")}`}
              statKey="turn"
              hintKey="turnPrediction"
            >
              <TurnPatternList patterns={prediction.turnPrediction.patterns} />
            </PredictionCard>
          </motion.div>
        )}

        {/* ブロック2: イン崩れ指数バッジ（FR3） */}
        {prediction.volatilityPercentile != null && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
          >
            <VolatilityDisplay
              percentile={prediction.volatilityPercentile}
              reasons={prediction.volatilityReasons}
              isFallback={prediction.volatilityPercentileIsFallback}
              venueCode={venueCode}
              raceId={raceId}
            />
          </motion.div>
        )}

        {/* 出現パターン */}
        {venueCode && venueName && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.3, ease: "easeOut" }}
          >
            <OutcomePatternPreview
              venueCode={venueCode}
              venueName={venueName}
              prediction={prediction}
            />
          </motion.div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

export default RaceAiPredictionTab;
