/**
 * PredictionPanel - レース詳細のAI予想・タブの区画（App.jsx と RaceDetail.jsx で共通利用）
 *
 * ここは状態のフックを呼び、表示用の値を束ね、描画を子へ渡すだけ。
 * - 状態のフック: PredictionPanelState.jsx（URL の艇・タブ、枠別情報の期間、AI用コピーのトースト）
 * - 表示用の値: PredictionPanelDerive.js（日付・公式URL・状態の旗）、PredictionPanelShareTitle.js（共有文）
 * - タブの定義と並び順の根拠: PredictionPanelTabs.jsx の buildMainTabs
 * - 描画: PredictionPanelBody.jsx（バナー・タブ・分析ツール・AI用コピー・共有・ガイドリンク）
 * 変更の経緯は git の履歴にある
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useRaceData } from "../../hooks/useRaceData";
import { SONAR_RACE_TAB } from "../../utils/raceUrlState";
import { isInCautionEnabled } from "../../config/featureFlags";
import { useRaceWinnerCourse } from "../../hooks/useRaceWinnerCourse";
import PredictionLoadingOverlay from "./PredictionLoadingOverlay";
import { getRaceId } from "../../utils/raceId";
import { AI_COPY_PROMPT_TYPES } from "../../utils/aiCopyPrompts";
import { PredictionErrorView } from "./PredictionPanelBanners";
import { buildShareTitle } from "./PredictionPanelShareTitle";
import {
  buildOfficialUrl,
  deriveRaceFlags,
  resolveRaceDate,
} from "./PredictionPanelDerive";
import {
  useRaceUrlState,
  useSixBoatPeriod,
  useAiCopyToast,
  useTabRequests,
} from "./PredictionPanelState";
import { buildMainTabs } from "./PredictionPanelTabs";
import PredictionPanelBody from "./PredictionPanelBody";

// データ出走表・枠番傾向・分析ツール群（レース前の予想材料）を隠すタブ。
// 結果/直前情報/モータ情報/AI予想の各タブは、それぞれのタブ内で同種の情報を
// 独立して表示しているため二重表示を避けて隠す（BOA-305〜312フィードバック#7、
// 2026-09-16のユーザーフィードバックでモータ情報タブも対象に追加。同日、
// BOA-346でAI予想タブも同じ扱いに追加）。
// 今節タブも同じ扱い（2026-09-27ユーザー指摘）。6艇の得点率・着順・前検と
// 選んだ1艇の走りを出しており、下にデータ出走表・枠番傾向が続くと
// 同じ6艇の数字が二重に並ぶ。
// 名前付きの一覧にすることで、今後タブが増えても1行の追加で済む
const PRE_RACE_TOOLS_HIDDEN_TABS = [
  "result",
  "beforeInfo",
  "motor",
  "waku",
  "aiPrediction",
  SONAR_RACE_TAB,
  "oddsList",
  "meet",
];

function PredictionPanel({
  prediction,
  selectedRace,
  isAnalyzing,
  date,
  status,
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
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
  const urlState = useRaceUrlState();
  const tabRequests = useTabRequests(navigate);
  const { sixBoatPeriod, setSixBoatPeriod } = useSixBoatPeriod(analysisRaceId);
  const aiCopy = useAiCopyToast({ analysisRaceId, t, i18n, navigate });
  // 結果確定後の共有文に使う、1着の艇の進入コース（早期 return より前に呼ぶ。フックの順序の規則）
  const winnerCourse = useRaceWinnerCourse(
    selectedRace?.id,
    Boolean(prediction?.result?.finished),
  );

  if (!prediction && !isAnalyzing) return null;

  // null check を一箇所に集約：ここで selectedRace の存在を確認
  // 以降のコードでは selectedRace が null でないことを前提とする
  if (!selectedRace) return null;

  const raceDate = resolveRaceDate(date, selectedRace);
  const flags = deriveRaceFlags(prediction, status);
  const inCautionShare = isInCautionEnabled();
  const shareTitle = buildShareTitle({
    isFinished: flags.isFinished,
    inCautionShare,
    venueName,
    selectedRace,
    raceDate,
    isCancelled: flags.isCancelled,
    prediction,
    winnerCourse,
    t,
  });

  // ローディング中
  if (isAnalyzing) {
    return <PredictionLoadingOverlay />;
  }

  // エラー
  if (prediction.error) {
    return (
      <PredictionErrorView
        prediction={prediction}
        isCancelled={flags.isCancelled}
        t={t}
      />
    );
  }

  const ctx = {
    ...urlState,
    ...tabRequests,
    ...aiCopy,
    ...flags,
    t,
    prediction,
    selectedRace,
    venueCode,
    venueName,
    analysisRaceId,
    sixBoatPeriod,
    setSixBoatPeriod,
    officialUrl: buildOfficialUrl(venueCode, raceDate, selectedRace),
    aiCopyPromptType,
    setAiCopyPromptType,
    setActiveMainTab,
    // activeMainTab未確定時（初回レンダー等）は従来通り表示する
    showPreRaceAnalysisTools:
      !PRE_RACE_TOOLS_HIDDEN_TABS.includes(activeMainTab),
    shareTitle,
    inCautionShare,
  };
  return <PredictionPanelBody c={{ ...ctx, tabs: buildMainTabs(ctx) }} />;
}

export default PredictionPanel;
