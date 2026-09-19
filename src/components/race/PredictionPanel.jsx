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
 * （結果と矛盾する見え方になるため）。過去レースの検証はレース結果パネル（RaceResult、
 * 複勝的中/展開予測的中の検証）が担う。unifiedモデルのデータが無い日付でAIデータ分析欄が
 * 空白のまま表示される問題も、未確定レースに限定することで実質的に解消される
 *
 * 2026-08-14再追記(複勝予想パネル撤去): 複勝予想の「実測回収率」バッジが、1レース1点分の
 * 投資額(100円)で2点(◎○)ぶんの的中を数える実行不可能な計算方式により約1.5倍に水増しされて
 * いたことが判明（実際に両方100円ずつ買った場合の真の回収率は92.4%、BOA-180）。的中率90%
 * 自体は正しい実測値だったが、ユーザー判断により複勝予想UI（本コンポーネント内のパネル・
 * ホームページのレースカード一覧プレビュー）を一式撤去した。データ取得基盤（複勝オッズ
 * スクレイピング等）は将来の再設計に備えて残置している
 *
 * 2026-09-15追記(日和スタイルのタブ構成、BOA-305〜312): レース詳細ページに
 * 「基本情報/モータ情報/結果」の3タブ（RaceTabs）を追加した。
 * - 基本情報タブ（RaceBasicInfoTab、BOA-306）はDataRaceTableとは別の切り口
 *   （会場/グレード/期間フィルタ×棒グラフ）のため重複ではなく併存する
 * - モータ情報タブ（BOA-308）は既存のEmbeddedAnalysisSection「モーター調子」を
 *   タブへ昇格したため、重複表示を避けるためアコーディオン版は撤去した
 * - 結果タブ（BOA-312）は従来PredictionSection側で常時表示していたRaceResultを
 *   タブへ移設した。「データで振り返る」（RaceReview）はユーザー判断により
 *   BOA-312で撤去済み（docs/reference/deprecated-terms.json参照）
 * 残り4タブ（枠別情報/今節成績/オッズ検索/オッズ一覧）はデータ未整備の
 * ため未実装（`docs/design/scraping-full-coverage/`待ち）
 *
 * 2026-09-16追記(直前情報タブ分離、BOA-304): DataRaceTable（基本情報、過去実績系）に
 * 混在していた「当日更新・レース前は未確定」の4指標（展示ST/展示タイム/チルト/
 * 調整重量）を「直前情報」タブへ分離した（RaceBeforeInfoTab、モータ情報と結果の間）。
 * レース前の長い時間帯にDataRaceTable全体が「未完成」に見える問題への対応。
 * あわせて表示欠落だった気象情報（race_conditions）も同タブに追加した
 *
 * 2026-09-16追記(「AI予想」独立タブ新設、BOA-346): 日和には無い龍神レーダー独自の
 * AI予想機能（展開予測カード/イン崩れ指数バッジ/出現パターン）を、常時表示エリアの
 * 折りたたみ（旧AiAnalysisSection）から「AI予想」タブ（基本情報の次）へ格上げした。
 * 確定済みレースの答え合わせロジック（旧RaceResult.jsxの
 * showVolatilityOutcome/isUpset）も同タブに統合したため、結果タブは着順・配当・
 * 決まり手のみのシンプルな内容になった。詳細はRaceAiPredictionTab.jsx参照
 *
 * 2026-09-16追記(オッズ一覧タブ追加、BOA-311): FR-4（オッズ全券種対応、
 * race_odds.trifecta_all/trio_all/exacta_all/quinella_all/wide_all）が
 * 本番稼働済みになったため、「直前情報」と「結果」の間に「オッズ一覧」タブ
 * （RaceOddsListTab）を追加した。券種タブ×6x6ヒートマップグリッド×セルタップ
 * でのオッズ推移ドリルダウン。3連単/3連複は3艇の組み合わせのため、グリッドは
 * 1着×2着（trioは艇番の小さい2艇）のペア軸にし、タップ後に3着候補一覧を
 * 挟んでから推移を表示する2段階ドリルダウンにしている（詳細はコンポーネント
 * 冒頭コメント参照）
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useRaceData } from "../../hooks/useRaceData";
import { SocialShareButtons } from "../SocialShareButtons";
import { generatePredictionShareText } from "../../utils/share";
import { getVenueGuidePath } from "../../utils/venueUtils";
import PredictionLoadingOverlay from "./PredictionLoadingOverlay";
import DataRaceTable from "./DataRaceTable";
import VenueTendencyPanel from "./VenueTendencyPanel";
import EmbeddedAnalysisSection from "./EmbeddedAnalysisSection";
import RacerFormChart from "../analysis/RacerFormChart";
import StPredictabilityChart from "../analysis/StPredictabilityChart";
import ExhibitionTimeTrendChart from "../analysis/ExhibitionTimeTrendChart";
import RacerTechniqueProfileChart from "../analysis/RacerTechniqueProfileChart";
import RacerBoatReturnRateChart from "../analysis/RacerBoatReturnRateChart";
import AttackDefenseAnalysis from "../analysis/AttackDefenseAnalysis";
import MotorConditionChart from "../analysis/MotorConditionChart";
import AiCopyBanner from "./AiCopyBanner";
import AiCopyButton from "./AiCopyButton";
import Toast, { useToast } from "../Toast";
import RaceTabs from "./RaceTabs";
import RaceBasicInfoTab from "./RaceBasicInfoTab";
import RaceBeforeInfoTab from "./RaceBeforeInfoTab";
import RaceAiPredictionTab from "./RaceAiPredictionTab";
import RaceOddsListTab from "./RaceOddsListTab";
import RaceResult from "./RaceResult";
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
  // 結果タブ表示中はDataRaceTable/VenueTendencyPanel/分析ツールアコーディオン群
  // （いずれもレース前の予想材料）を隠す（BOA-305〜312フィードバック#7）。
  // 初期値はRaceTabsのdefaultTabIdと同じ判定にしておき、初回描画時に一瞬
  // 表示されてすぐ消える「ちらつき」を防ぐ
  const [activeMainTab, setActiveMainTab] = useState(() =>
    prediction?.result?.finished ? "result" : "basic",
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
  // 過去レースの検証は「結果」タブ（RaceResult）が担う
  const isFinished = Boolean(prediction?.result?.finished);
  // 締切は過ぎたが結果はまだ反映されていない状態（1時間おきのスクレイピングバッチのラグ）。
  // AI分析パネル自体は表示を維持しつつ、案内バナーのみ追加する
  const isAwaitingResult = status === RACE_STATUS.AWAITING_RESULT;
  // 中止・順延の確定検知（BOA-254）。暫定検知（"tentative"）はまだ誤検出の
  // 可能性があるため、既存の受付中/結果反映待ち表示のまま変更しない
  const isCancelled = prediction?.cancellationStatus === "confirmed";

  // データ出走表・枠番傾向・分析ツール群（レース前の予想材料）を表示するか。
  // 結果/直前情報/モータ情報/AI予想の各タブは、それぞれのタブ内で同種の情報を
  // 独立して表示しているため二重表示を避けて隠す（BOA-305〜312フィードバック#7、
  // 2026-09-16のユーザーフィードバックでモータ情報タブも対象に追加。同日、
  // BOA-346でAI予想タブも同じ扱いに追加）。
  // activeMainTab未確定時（初回レンダー等）は従来通り表示する。名前付き変数に
  // 切り出すことで、今後タブが増えても1行の追加で済むようにしている
  const showPreRaceAnalysisTools =
    activeMainTab !== "result" &&
    activeMainTab !== "beforeInfo" &&
    activeMainTab !== "motor" &&
    activeMainTab !== "aiPrediction" &&
    activeMainTab !== "oddsList";

  // ローディング中
  if (isAnalyzing) {
    return <PredictionLoadingOverlay />;
  }

  // エラー
  if (prediction.error) {
    // 中止・順延（BOA-254）で選手情報が無く出走表自体が組めないレースは、
    // 汎用の「予想データが利用できません」ではなく専用メッセージを出す
    if (isCancelled) {
      return (
        <div
          className="prediction-cancelled"
          style={{
            padding: "2rem",
            background: "var(--color-gray-100)",
            borderRadius: "12px",
            border: "2px solid var(--color-gray-600)",
            textAlign: "center",
          }}
        >
          <h3 style={{ color: "var(--color-gray-700)" }}>
            {t("panel.cancelledBanner")}
          </h3>
        </div>
      );
    }
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

      {isCancelled ? (
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
          {t("panel.cancelledBanner")}
        </div>
      ) : (
        isAwaitingResult && (
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
        )
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

      {/* レース詳細ページのタブ構成（BOA-305〜312）: 日和スタイルの8タブのうち
          データが揃っている3タブのみ実装。DataRaceTable（主役の生データ一覧）とは
          別の切り口（条件フィルタ×棒グラフ）のため両方残す */}
      {venueCode && analysisRaceId && (
        <RaceTabs
          key={analysisRaceId}
          defaultTabId={isFinished ? "result" : "basic"}
          onActiveTabChange={setActiveMainTab}
          tabs={[
            {
              id: "basic",
              label: t("raceTabs.basic"),
              content: (
                <RaceBasicInfoTab
                  raceId={analysisRaceId}
                  venueCode={venueCode}
                  players={prediction.allPlayers}
                />
              ),
            },
            {
              id: "aiPrediction",
              label: t("raceTabs.aiPrediction"),
              content: (
                <RaceAiPredictionTab
                  prediction={prediction}
                  venueCode={venueCode}
                  venueName={venueName}
                  raceId={analysisRaceId}
                />
              ),
            },
            {
              id: "motor",
              label: t("raceTabs.motor"),
              content: (
                <MotorConditionChart
                  embedded
                  initialVenueCode={venueCode}
                  initialRaceId={analysisRaceId}
                />
              ),
            },
            {
              id: "beforeInfo",
              label: t("raceTabs.beforeInfo"),
              content: (
                <RaceBeforeInfoTab
                  raceId={analysisRaceId}
                  venueCode={venueCode}
                  players={prediction.allPlayers}
                  weather={prediction.weather}
                />
              ),
            },
            {
              id: "oddsList",
              label: t("raceTabs.oddsList"),
              content: (
                <RaceOddsListTab
                  raceId={analysisRaceId}
                  raceStartTime={selectedRace?.startTime}
                />
              ),
            },
            {
              id: "result",
              label: t("raceTabs.result"),
              content: isFinished ? (
                <RaceResult prediction={prediction} raceId={analysisRaceId} />
              ) : (
                <div className="race-tabs-empty">
                  <p>{t("result.notFinishedTitle")}</p>
                  <p className="race-tabs-empty-body">
                    {t("result.notFinishedBody")}
                  </p>
                </div>
              ),
            },
          ]}
        />
      )}

      {showPreRaceAnalysisTools && (
        <>
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
              データ取得する。モーター調子（BOA-308）はモータ情報タブへ昇格したため、
              重複表示を避けるためここでは表示しない */}
          {venueCode && analysisRaceId && (
            <EmbeddedAnalysisSection
              title={t("analysisPage.tabs.racer")}
              hintKey="racerForm"
            >
              <RacerFormChart
                embedded
                initialVenueCode={venueCode}
                initialRaceId={analysisRaceId}
              />
            </EmbeddedAnalysisSection>
          )}
          {venueCode && analysisRaceId && (
            <EmbeddedAnalysisSection
              title={t("analysisPage.tabs.st")}
              hintKey="stDeviation"
            >
              <StPredictabilityChart
                embedded
                initialVenueCode={venueCode}
                initialRaceId={analysisRaceId}
              />
            </EmbeddedAnalysisSection>
          )}
          {venueCode && analysisRaceId && (
            <EmbeddedAnalysisSection
              title={t("analysisPage.tabs.extrend")}
              hintKey="exhibitionTimeTrend"
            >
              <ExhibitionTimeTrendChart
                embedded
                initialVenueCode={venueCode}
                initialRaceId={analysisRaceId}
              />
            </EmbeddedAnalysisSection>
          )}
          {venueCode && analysisRaceId && (
            <EmbeddedAnalysisSection
              title={t("analysisPage.tabs.techprofile")}
              hintKey="racerTechniqueProfile"
            >
              <RacerTechniqueProfileChart
                embedded
                initialVenueCode={venueCode}
                initialRaceId={analysisRaceId}
              />
            </EmbeddedAnalysisSection>
          )}
          {venueCode && analysisRaceId && (
            <EmbeddedAnalysisSection
              title={t("analysisPage.tabs.returnrate")}
              hintKey="returnRateAnalysis"
            >
              <RacerBoatReturnRateChart
                embedded
                initialVenueCode={venueCode}
                initialRaceId={analysisRaceId}
              />
            </EmbeddedAnalysisSection>
          )}
          {venueCode && analysisRaceId && (
            <EmbeddedAnalysisSection
              title={t("analysisPage.tabs.attackdefense")}
              hintKey="attackDefense"
            >
              <AttackDefenseAnalysis
                embedded
                initialVenueCode={venueCode}
                initialRaceId={analysisRaceId}
              />
            </EmbeddedAnalysisSection>
          )}
        </>
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
