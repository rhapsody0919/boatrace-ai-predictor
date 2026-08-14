/**
 * PredictionPanel - AI予想結果セクション
 * App.jsx と RaceDetail.jsx で共通利用
 *
 * AI予想モデル大規模改修（2026-08-13）: 3モデル切替（standard/safeBet/upsetFocus）を廃止し、
 * unifiedモデル1本に統合。AiAnalysisSectionは複勝予想パネル/展開予測パネル/イン崩れ指数
 * バッジの3ブロック構成（FR1/FR2/FR3）。
 * 3連単参考情報（FR4、TrifectaReferenceCard）はUX上のフィードバックにより2026-08-14に表示を廃止。
 * バックエンド生成（generate-unified-trifecta-reference.js/bet_recommendations）自体は
 * 将来のモデル評価用途で残置している
 *
 * 2026-08-14追記: AiAnalysisSection（複勝予想パネル/展開予測パネル/イン崩れバッジ）は
 * 「これから何が起きそうか」を示す未来志向のUIのため、結果確定済みレースには表示しない
 * （結果と矛盾する見え方になるため）。過去レースの予想根拠検証は「データで振り返る」
 * （RaceReview、モデル非依存で常時正しく振る舞う）と、レース結果パネル（RaceResult、
 * 複勝的中/展開予測的中の検証）が担う。unifiedモデルのデータが無い日付でAIデータ分析欄が
 * 空白のまま表示される問題も、未確定レースに限定することで実質的に解消される
 *
 * 2026-08-14再追記: 複勝予想は当初データ出走表（DataRaceTable）の行として表示していたが、
 * 客観的な生データ（勝率・モーター等）の行と、AIの結論（複勝予想）の行が同じ見た目で
 * 並んでいると「AIの予想であること」が埋もれてしまうという指摘を受け、展開予測・イン崩れ
 * 指数と同じ独立パネル（PlaceRecommendationPanel）に分離した
 */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { useRaceData } from "../../hooks/useRaceData";
import { SocialShareButtons } from "../SocialShareButtons";
import { generatePredictionShareText } from "../../utils/share";
import { getVenueGuidePath } from "../../utils/venueUtils";
import VolatilityDisplay from "./VolatilityDisplay";
import FirstMarkAnimation from "./FirstMarkAnimation";
import TurnPatternList from "./TurnPatternList";
import PlaceRecommendationPanel from "./PlaceRecommendationPanel";
import OutcomePatternPreview from "./OutcomePatternPreview";
import PredictionLoadingOverlay from "./PredictionLoadingOverlay";
import DataRaceTable from "./DataRaceTable";
import AiAnalysisSection from "./AiAnalysisSection";
import { getRaceId } from "../../utils/raceId";

function PredictionPanel({ prediction, selectedRace, isAnalyzing, date }) {
  const { t } = useTranslation();
  // フックはearly returnより前で無条件に呼ぶ必要があるため、selectedRace未確定時は空オブジェクトを渡す
  const { venueCode, venueName } = useRaceData(selectedRace || {});
  const analysisRaceId = selectedRace ? getRaceId(selectedRace) : null;

  if (!prediction && !isAnalyzing) return null;

  // null check を一箇所に集約：ここで selectedRace の存在を確認
  // 以降のコードでは selectedRace が null でないことを前提とする
  if (!selectedRace) return null;

  // 日付（明示的に渡されるか、raceIdから抽出）
  const raceDate =
    date ||
    (() => {
      const raceId = selectedRace?.id || "";
      const parts = raceId.split("-").slice(0, 3);
      return parts.length === 3 ? parts.join("-") : "";
    })();

  // 公式サイトリンクURL
  const officialUrl =
    venueCode && raceDate
      ? `https://www.boatrace.jp/owpc/pc/race/racelist?rno=${selectedRace.raceNumber}&jcd=${String(venueCode).padStart(2, "0")}&hd=${raceDate.replace(/-/g, "")}`
      : null;

  // 結果確定済みレースでは未来志向のAIデータ分析（展開予測/イン崩れ）を表示しない。
  // 過去レースの検証は「データで振り返る」（RaceReview）が担う
  const isFinished = Boolean(prediction?.result?.finished);

  // ローディング中
  if (isAnalyzing) {
    return <PredictionLoadingOverlay />;
  }

  // エラー
  if (prediction.error) {
    return (
      <div
        className="prediction-error"
        style={{
          padding: "2rem",
          background: "#fff3cd",
          borderRadius: "12px",
          border: "2px solid #ffc107",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>
          &#x26A0;&#xFE0F;
        </div>
        <h3 style={{ color: "#856404", marginBottom: "1rem" }}>
          {t("panel.noData")}
        </h3>
        <p style={{ color: "#856404" }}>{prediction.errorMessage}</p>
      </div>
    );
  }

  return (
    <>
      {/* 公式サイトリンク */}
      {officialUrl && (
        <div
          style={{
            marginTop: "1rem",
            marginBottom: "1.5rem",
            padding: "0.75rem 1rem",
            background: "#e3f2fd",
            borderRadius: "8px",
            borderLeft: "4px solid #2196f3",
          }}
        >
          <span style={{ marginRight: "0.5rem" }}>&#x1F517;</span>
          <a
            href={officialUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "#0ea5e9",
              textDecoration: "none",
              fontWeight: "500",
            }}
          >
            {t("panel.officialLink")}
          </a>
          <span
            style={{
              marginLeft: "0.5rem",
              fontSize: "0.9rem",
              color: "#475569",
            }}
          >
            {t("panel.newTab")}
          </span>
        </div>
      )}

      {/* データ出走表（主役）: 出走6選手×客観的な生データの一覧マトリクス。
          複勝予想（AIの結論）は2026-08-14〜このテーブルの行から独立させ、
          AiAnalysisSection側のPlaceRecommendationPanelに移した */}
      <DataRaceTable
        raceId={analysisRaceId}
        prediction={prediction}
        venueCode={venueCode}
      />

      {/* AIデータ分析（折りたたみ）: 複勝予想/展開予測パネル/イン崩れ指数バッジの3ブロック。
          未来志向のUIのため結果確定済みレースでは表示しない（データで振り返るが代わりに担う） */}
      {!isFinished && (
        <AiAnalysisSection topPick={prediction.topPick} confidence={null}>
          <AnimatePresence mode="wait">
            <motion.div
              className="prediction-result"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
            >
              {/* ブロック1: 複勝予想パネル（FR1/FR5） */}
              {prediction.allPlayers && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                >
                  <PlaceRecommendationPanel
                    raceId={analysisRaceId}
                    players={prediction.allPlayers}
                  />
                </motion.div>
              )}

              {/* ブロック2: 展開予測パネル（FR2、的中率80.0%） */}
              {prediction.turnPrediction && prediction.allPlayers && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                >
                  <p className="ai-analysis-block-badge">
                    📈 {t("animation.accuracyBadge")}
                  </p>
                  <TurnPatternList
                    patterns={prediction.turnPrediction.patterns}
                  />
                  <FirstMarkAnimation
                    patterns={prediction.turnPrediction.patterns}
                    technique={prediction.turnPrediction.technique}
                    probability={prediction.turnPrediction.probability}
                    winnerCourse={prediction.turnPrediction.winnerCourse}
                    distribution={prediction.turnPrediction.distribution}
                    boatStrengths={prediction.turnPrediction.boatStrengths}
                    players={prediction.allPlayers?.map((p) => ({
                      number: p.number,
                      name: p.name,
                    }))}
                    selectedPatternIndex={0}
                    venue={
                      venueCode
                        ? t(`venues.${venueCode}`, venueName)
                        : venueName
                    }
                    raceNumber={selectedRace?.raceNumber}
                  />
                </motion.div>
              )}

              {/* ブロック3: イン崩れ指数バッジ（FR3） */}
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
        </AiAnalysisSection>
      )}

      {/* SNSシェアボタン */}
      <div className="social-share-wrapper">
        <SocialShareButtons
          shareUrl="https://www.boat-ai.jp/"
          title={generatePredictionShareText(
            {
              venue: venueName || t("panel.unknownVenue"),
              raceNo: selectedRace?.raceNumber || "?",
              date: raceDate,
              prediction: {
                topPick: prediction.topPick?.number,
                top3: prediction.top3 || [],
              },
            },
            "unified",
          )}
          hashtags={["ボートレース", "AI予想", "BoatAI"]}
          size={40}
        />
      </div>

      {/* 会場攻略ガイドリンク */}
      {venueCode && getVenueGuidePath(venueCode) && (
        <div className="venue-guide-link">
          <Link to={getVenueGuidePath(venueCode)}>
            <span className="venue-guide-icon">&#x1F4D6;</span>
            <div className="venue-guide-content">
              <span className="venue-guide-title">
                {t("panel.venueGuideLink", {
                  venue: venueCode
                    ? t(`venues.${venueCode}`, venueName)
                    : venueName,
                })}
              </span>
              <span className="venue-guide-desc">
                {t("panel.venueGuideDesc")}
              </span>
            </div>
            <span className="venue-guide-arrow">&rarr;</span>
          </Link>
        </div>
      )}
    </>
  );
}

export default PredictionPanel;
