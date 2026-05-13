/**
 * PredictionPanel - AI予想結果セクション
 * App.jsx と RaceDetail.jsx で共通利用
 */
import { Link } from "react-router-dom";
import { useRaceData } from "../../hooks/useRaceData";
import { motion, AnimatePresence } from "framer-motion";
import { SocialShareButtons } from "../SocialShareButtons";
import { generatePredictionShareText } from "../../utils/share";
import { getVenueGuidePath } from "../../utils/venueUtils";
import VolatilityDisplay from "./VolatilityDisplay";
import ModelDescription from "./ModelDescription";
import ModelSwitcher from "./ModelSwitcher";
import FirstMarkAnimation from "./FirstMarkAnimation";
import PredictionFlash from "./PredictionFlash";
import AttackDefenseTable from "./AttackDefenseTable";
import OutcomePatternPreview from "./OutcomePatternPreview";
import PredictionTable from "./PredictionTable";
import PredictionLoadingOverlay from "./PredictionLoadingOverlay";
import BettingValueSection from "./BettingValueSection";

const staggerItem = (delay) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, delay, ease: "easeOut" },
});

function PredictionPanel({
  prediction,
  selectedRace,
  selectedModel,
  onSwitchModel,
  volatility,
  isAnalyzing,
  date,
  showExhibition = false,
}) {
  if (!prediction && !isAnalyzing) return null;

  // null check を一箇所に集約：ここで selectedRace の存在を確認
  // 以降のコードでは selectedRace が null でないことを前提とする
  if (!selectedRace) return null;

  // 会場コード・会場名を useRaceData で一元的に抽出
  // （selectedRace は必ず存在するため、フック側で計算のみに専念）
  const { venueCode, venueName } = useRaceData(selectedRace);

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

  // パターンインデックス（モデルと1マーク展開予測の連動）
  const selectedPatternIndex =
    selectedModel === "safe-bet" ? 0 : selectedModel === "standard" ? 1 : 2;

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
          予想データが利用できません
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
            公式サイトでレース情報を見る
          </a>
          <span
            style={{
              marginLeft: "0.5rem",
              fontSize: "0.9rem",
              color: "#475569",
            }}
          >
            （新しいタブで開きます）
          </span>
        </div>
      )}

      {/* 荒れ度 + モデル説明 + モデル切替 */}
      {prediction.predictions && (
        <>
          <VolatilityDisplay volatility={volatility} />
          <ModelDescription />
          <ModelSwitcher
            selectedModel={selectedModel}
            onSwitchModel={onSwitchModel}
          />
        </>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={selectedModel}
          className="prediction-result"
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          transition={{ duration: 0.2 }}
        >
          {/* AI予想根拠フラッシュ + 買い目表示 */}
          {prediction.turnPrediction && prediction.allPlayers && (
            <motion.div {...staggerItem(0)}>
              <PredictionFlash
                prediction={prediction}
                selectedRace={selectedRace}
                selectedPatternIndex={selectedPatternIndex}
                selectedModel={selectedModel}
              />
            </motion.div>
          )}

          {/* 1マーク展開予測 */}
          {prediction.turnPrediction && (
            <motion.div {...staggerItem(0.1)}>
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
                selectedPatternIndex={selectedPatternIndex}
                venue={selectedRace?.venue}
                raceNumber={selectedRace?.raceNumber}
                selectedModel={selectedModel}
              />
            </motion.div>
          )}

          {/* 配当妙味 */}
          {prediction.predictionOdds && (
            <motion.div {...staggerItem(0.2)}>
              <BettingValueSection
                prediction={prediction}
                selectedModel={selectedModel}
              />
            </motion.div>
          )}

          {/* 超展開データ */}
          {prediction.racerStats && (
            <motion.div {...staggerItem(0.3)}>
              <AttackDefenseTable
                racerStats={prediction.racerStats}
                players={prediction.allPlayers}
              />
            </motion.div>
          )}

          {/* 出現パターン */}
          {venueCode && venueName && (
            <motion.div {...staggerItem(0.4)}>
              <OutcomePatternPreview
                venueCode={venueCode}
                venueName={venueName}
                prediction={prediction}
                selectedModel={selectedModel}
              />
            </motion.div>
          )}

          {/* AIデータ予想テーブル */}
          <motion.div {...staggerItem(0.5)}>
            <PredictionTable
              prediction={prediction}
              showExhibition={showExhibition}
              volatility={volatility}
            />
          </motion.div>

          {/* SNSシェアボタン */}
          <motion.div className="social-share-wrapper" {...staggerItem(0.6)}>
            <SocialShareButtons
              shareUrl="https://www.boat-ai.jp/"
              title={generatePredictionShareText(
                {
                  venue: selectedRace?.venue || "不明",
                  raceNo: selectedRace?.raceNumber || "?",
                  date: raceDate,
                  prediction: {
                    topPick: prediction.top3?.[0] || prediction.topPick?.number,
                    top3: prediction.top3 || [],
                  },
                },
                selectedModel,
              )}
              hashtags={["ボートレース", "AI予想", "BoatAI"]}
              size={40}
            />
          </motion.div>

          {/* 会場攻略ガイドリンク */}
          {venueCode && getVenueGuidePath(venueCode) && (
            <motion.div {...staggerItem(0.7)}>
              <div className="venue-guide-link">
                <Link to={getVenueGuidePath(venueCode)}>
                  <span className="venue-guide-icon">&#x1F4D6;</span>
                  <div className="venue-guide-content">
                    <span className="venue-guide-title">
                      {selectedRace.venue}の攻略ガイドを見る
                    </span>
                    <span className="venue-guide-desc">
                      会場の特徴と狙い目を詳しく解説
                    </span>
                  </div>
                  <span className="venue-guide-arrow">&rarr;</span>
                </Link>
              </div>
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>
    </>
  );
}

export default PredictionPanel;
