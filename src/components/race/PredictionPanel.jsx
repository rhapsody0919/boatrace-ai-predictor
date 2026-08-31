/**
 * PredictionPanel - AI予想結果セクション
 * App.jsx と RaceDetail.jsx で共通利用
 *
 * AI予想モデル大規模改修（2026-08-13）: 3モデル切替（standard/safeBet/upsetFocus）を廃止し、
 * unifiedモデル1本に統合。AiAnalysisSectionは展開予測パネル/イン崩れ指数バッジの2ブロック構成
 * （FR2/FR3）。
 * 3連単参考情報（FR4、TrifectaReferenceCard）はUX上のフィードバックにより2026-08-14に表示を廃止。
 * バックエンド生成（generate-unified-trifecta-reference.js/bet_recommendations）自体は
 * 将来のモデル評価用途で残置している
 *
 * 2026-08-14追記: AiAnalysisSection（展開予測パネル/イン崩れバッジ）は
 * 「これから何が起きそうか」を示す未来志向のUIのため、結果確定済みレースには表示しない
 * （結果と矛盾する見え方になるため）。過去レースの予想根拠検証は「データで振り返る」
 * （RaceReview、モデル非依存で常時正しく振る舞う）と、レース結果パネル（RaceResult、
 * 複勝的中/展開予測的中の検証）が担う。unifiedモデルのデータが無い日付でAIデータ分析欄が
 * 空白のまま表示される問題も、未確定レースに限定することで実質的に解消される
 *
 * 2026-08-14再追記(複勝予想パネル撤去): 複勝予想の「実測回収率」バッジが、1レース1点分の
 * 投資額(100円)で2点(◎○)ぶんの的中を数える実行不可能な計算方式により約1.5倍に水増しされて
 * いたことが判明（実際に両方100円ずつ買った場合の真の回収率は92.4%、BOA-180）。的中率90%
 * 自体は正しい実測値だったが、ユーザー判断により複勝予想UI（本コンポーネント内のパネル・
 * ホームページのレースカード一覧プレビュー）を一式撤去した。データ取得基盤（複勝オッズ
 * スクレイピング等）は将来の再設計に備えて残置している
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { useRaceData } from "../../hooks/useRaceData";
import { SocialShareButtons } from "../SocialShareButtons";
import { generatePredictionShareText } from "../../utils/share";
import { getVenueGuidePath } from "../../utils/venueUtils";
import VolatilityDisplay from "./VolatilityDisplay";
import TurnPatternList from "./TurnPatternList";
import PredictionCard from "./PredictionCard";
import OutcomePatternPreview from "./OutcomePatternPreview";
import PredictionLoadingOverlay from "./PredictionLoadingOverlay";
import DataRaceTable from "./DataRaceTable";
import VenueTendencyPanel from "./VenueTendencyPanel";
import EmbeddedAnalysisSection from "./EmbeddedAnalysisSection";
import MotorConditionChart from "../analysis/MotorConditionChart";
import RacerFormChart from "../analysis/RacerFormChart";
import StPredictabilityChart from "../analysis/StPredictabilityChart";
import ExhibitionTimeTrendChart from "../analysis/ExhibitionTimeTrendChart";
import RacerTechniqueProfileChart from "../analysis/RacerTechniqueProfileChart";
import AiAnalysisSection from "./AiAnalysisSection";
import AiCopyBanner from "./AiCopyBanner";
import AiCopyButton from "./AiCopyButton";
import Toast, { useToast } from "../Toast";
import { getRaceId } from "../../utils/raceId";
import { AI_COPY_PROMPT_TYPES } from "../../utils/aiCopyPrompts";
import { RACE_STATUS } from "../../utils/raceStatus";

function PredictionPanel({
  prediction,
  selectedRace,
  isAnalyzing,
  date,
  status,
}) {
  const { t } = useTranslation();
  // フックはearly returnより前で無条件に呼ぶ必要があるため、selectedRace未確定時は空オブジェクトを渡す
  const { venueCode, venueName } = useRaceData(selectedRace || {});
  const analysisRaceId = selectedRace ? getRaceId(selectedRace) : null;
  // バナー/インライン両方のAiCopyButtonで選択状態とトースト表示を共有する
  // （別々に持つと選択がずれる・トーストが同じ座標に重複表示されるため）
  const [aiCopyPromptType, setAiCopyPromptType] = useState(
    AI_COPY_PROMPT_TYPES.WIN,
  );
  const { toast: aiCopyToast, showToast: showAiCopyToast } = useToast();

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
  // 締切は過ぎたが結果はまだ反映されていない状態（1時間おきのスクレイピングバッチのラグ）。
  // AI分析パネル自体は表示を維持しつつ、案内バナーのみ追加する
  const isAwaitingResult = status === RACE_STATUS.AWAITING_RESULT;

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

      {isAwaitingResult && (
        <div
          style={{
            marginTop: "1rem",
            marginBottom: "1.5rem",
            padding: "0.75rem 1rem",
            background: "var(--color-gray-100)",
            borderRadius: "8px",
            borderLeft: "4px solid var(--color-gray-600)",
            color: "var(--color-gray-700)",
          }}
        >
          {t("panel.awaitingResultBanner")}
        </div>
      )}

      {/* AI用にコピー（BOA-194）: 結果未確定レースのみ、外部AIツールで独自分析したいユーザー向け */}
      {!isFinished && (
        <AiCopyBanner
          raceId={analysisRaceId}
          prediction={prediction}
          race={selectedRace}
          venueCode={venueCode}
          promptType={aiCopyPromptType}
          onPromptTypeChange={setAiCopyPromptType}
          onCopy={showAiCopyToast}
        />
      )}

      {/* データ出走表（主役）: 出走6選手×客観的な生データの一覧マトリクス */}
      <DataRaceTable
        raceId={analysisRaceId}
        prediction={prediction}
        venueCode={venueCode}
      />

      {/* この会場の枠番別傾向（FR-2）: 会場×枠番の過去傾向。選手個人のデータ出走表とは
          主語が異なるため別コンポーネントとして分離する */}
      <VenueTendencyPanel venueCode={venueCode} raceId={analysisRaceId} />

      {/* 分析ツールコンポーネントの埋め込み（FR-3〜9）: デフォルト閉、開いた時だけ
          データ取得する。まずモーター調子でembedded modeのパターンを確立する */}
      {venueCode && analysisRaceId && (
        <EmbeddedAnalysisSection title={t("analysisPage.tabs.motor")}>
          <MotorConditionChart
            embedded
            initialVenueCode={venueCode}
            initialRaceId={analysisRaceId}
          />
        </EmbeddedAnalysisSection>
      )}
      {venueCode && analysisRaceId && (
        <EmbeddedAnalysisSection title={t("analysisPage.tabs.racer")}>
          <RacerFormChart
            embedded
            initialVenueCode={venueCode}
            initialRaceId={analysisRaceId}
          />
        </EmbeddedAnalysisSection>
      )}
      {venueCode && analysisRaceId && (
        <EmbeddedAnalysisSection title={t("analysisPage.tabs.st")}>
          <StPredictabilityChart
            embedded
            initialVenueCode={venueCode}
            initialRaceId={analysisRaceId}
          />
        </EmbeddedAnalysisSection>
      )}
      {venueCode && analysisRaceId && (
        <EmbeddedAnalysisSection title={t("analysisPage.tabs.extrend")}>
          <ExhibitionTimeTrendChart
            embedded
            initialVenueCode={venueCode}
            initialRaceId={analysisRaceId}
          />
        </EmbeddedAnalysisSection>
      )}
      {venueCode && analysisRaceId && (
        <EmbeddedAnalysisSection title={t("analysisPage.tabs.techprofile")}>
          <RacerTechniqueProfileChart
            embedded
            initialVenueCode={venueCode}
            initialRaceId={analysisRaceId}
          />
        </EmbeddedAnalysisSection>
      )}

      {!isFinished && (
        <AiCopyButton
          variant="inline"
          raceId={analysisRaceId}
          prediction={prediction}
          race={selectedRace}
          venueCode={venueCode}
          promptType={aiCopyPromptType}
          onCopy={showAiCopyToast}
        />
      )}
      {!isFinished && (
        <Toast
          message={aiCopyToast.message}
          type={aiCopyToast.type}
          visible={aiCopyToast.visible}
        />
      )}

      {/* AIデータ分析（折りたたみ）: 展開予測パネル/イン崩れ指数バッジの2ブロック。
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
                  >
                    <TurnPatternList
                      patterns={prediction.turnPrediction.patterns}
                    />
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
                    raceId={analysisRaceId}
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
          hashtags={["ボートレース", "AI予想", "龍神レーダー"]}
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
