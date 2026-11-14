/**
 * PredictionPanel の本体の描画（バナー・タブ・分析ツール・AI用コピー・共有・ガイドリンク）
 */
import {
  RACE_TAB_PARAM,
  RACE_SONAR_PARAM,
  resolveInitialRaceTab,
} from "../../utils/raceUrlState";
import { isAnalogyFinderEnabled } from "../../config/featureFlags";
import AssistEntryRow from "./assist/AssistEntryRow";
import AiCopyBanner from "./AiCopyBanner";
import AiCopyButton from "./AiCopyButton";
import Toast from "../Toast";
import RaceTabs from "./RaceTabs";
import { OfficialLinkBanner, StatusBanner } from "./PredictionPanelBanners";
import { ShareSection, VenueGuideLink } from "./PredictionPanelShare";
import PredictionPanelAnalysisTools from "./PredictionPanelAnalysisTools";

function AiCopyFooter({ c }) {
  const { aiCopyToast } = c;
  return (
    <>
      <AiCopyButton
        variant="inline"
        raceId={c.analysisRaceId}
        prediction={c.prediction}
        race={c.selectedRace}
        venueCode={c.venueCode}
        promptType={c.aiCopyPromptType}
        onCopy={c.handleAiCopy}
      />
      <Toast
        message={aiCopyToast.message}
        type={aiCopyToast.type}
        visible={aiCopyToast.visible}
        action={aiCopyToast.action}
        onClose={c.hideAiCopyToast}
        onHold={c.holdAiCopyToast}
        onRelease={c.releaseAiCopyToast}
        closeLabel={c.t("aiCopy.toastClose")}
      />
    </>
  );
}

export default function PredictionPanelBody({ c }) {
  const { analysisRaceId, venueCode, searchParams } = c;
  return (
    <>
      {/* 公式サイトリンク */}
      <OfficialLinkBanner officialUrl={c.officialUrl} t={c.t} />

      <StatusBanner
        isCancelled={c.isCancelled}
        isAwaitingResult={c.isAwaitingResult}
        t={c.t}
      />

      {/* AI用にコピー（BOA-194）: 結果未確定・中止でないレースのみ、外部AIツールで独自分析したいユーザー向け */}
      {c.showAiCopy && (
        <AiCopyBanner
          raceId={analysisRaceId}
          prediction={c.prediction}
          race={c.selectedRace}
          venueCode={venueCode}
          promptType={c.aiCopyPromptType}
          onPromptTypeChange={c.setAiCopyPromptType}
          onCopy={c.handleAiCopy}
        />
      )}

      {/* レース詳細ページのタブ構成。並び順の根拠は PredictionPanelTabs.jsx 冒頭のコメント参照 */}
      {/* タブ列のすぐ上の思考アシストの入口（BOA-832） */}
      {venueCode && analysisRaceId && (
        <AssistEntryRow raceId={analysisRaceId} />
      )}
      {venueCode && analysisRaceId && (
        <RaceTabs
          key={analysisRaceId}
          defaultTabId={c.defaultMainTab}
          initialTabId={resolveInitialRaceTab(
            searchParams.get(RACE_TAB_PARAM),
            searchParams.get(RACE_SONAR_PARAM),
            isAnalogyFinderEnabled(),
          )}
          requestedTab={c.tabRequest}
          onActiveTabChange={(tabId) => {
            c.setActiveMainTab(tabId);
            // 既定のタブではクエリを付けない（素の /race/:raceId を保つ）
            c.setRaceParam(
              RACE_TAB_PARAM,
              tabId === c.defaultMainTab ? null : tabId,
            );
          }}
          tabs={c.tabs}
        />
      )}

      {c.showPreRaceAnalysisTools && (
        <PredictionPanelAnalysisTools
          analysisRaceId={analysisRaceId}
          prediction={c.prediction}
          venueCode={venueCode}
          t={c.t}
        />
      )}

      {c.showAiCopy && <AiCopyFooter c={c} />}

      <ShareSection
        shareTitle={c.shareTitle}
        pathname={c.pathname}
        search={c.search}
        analysisRaceId={analysisRaceId}
        isFinished={c.isFinished}
        isCancelled={c.isCancelled}
        inCautionShare={c.inCautionShare}
      />

      <VenueGuideLink venueCode={venueCode} venueName={c.venueName} t={c.t} />
    </>
  );
}
