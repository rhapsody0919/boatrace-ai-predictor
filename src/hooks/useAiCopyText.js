/**
 * useAiCopyText - race-ai-copy機能（BOA-194）用フック
 * データ出走表と同じデータソース（useRaceAnalysisData + prediction.allPlayers）から
 * Markdown表＋選択中の分析依頼プロンプトを組み立てて返す。
 * 値の整形はraceIndicators.jsxのbuildIndicatorRowsのrender()と同じロジックを
 * プレーンテキスト向けに書き直したもの（JSXを返すbuildIndicatorRowsはそのまま流用できないため）。
 * 行を作るところまでがこのフックで、文面の組み立て（前提の行・注記・出典など）は
 * 純関数の utils/aiCopyText.js が行う（BOA-770）。
 */
import { useEffect, useState } from "react";
import { getRaceOriginalExhibition } from "../services/raceQueries4.js";
import { useTranslation } from "react-i18next";
import { useRaceAnalysisData } from "./useRaceAnalysisData";
import { useSixBoatCourseStats } from "./useSixBoatCourseStats";
import { useRaceEntryFlyingRows } from "./useRaceEntryFlyingRows";
import { useCurrentMeetFlyingBoats } from "./useCurrentMeetFlyingBoats";
import {
  ORIGINAL_EXHIBITION_ROW_META,
  buildOriginalExhibitionRows,
  originalExhibitionKindLabels,
  isExhibitionCourseOutOfRange,
  toNumber,
  translateTechnique,
  translatePartName,
  expectedCourseWinRateText,
} from "../components/race/raceIndicators";
import {
  byBoat,
  buildNameRow,
  buildWinRateRow,
  buildLocalWinRateRow,
  buildTwoRateRow,
  buildMotorRow,
  buildFormRow,
  buildAvgStOfficialRow,
  buildAvgSt30Row,
  buildStRow,
  buildExhibitionStRow,
  buildExhibitionTimeRow,
  buildExhibitionCourseRow,
  buildTodayWeightRow,
  buildTiltRow,
  buildAdjustmentWeightRow,
  buildPartsChangedRow,
  buildPrevResultRow,
  buildExpectedCourseWinRateRow,
  buildTechniqueRow,
  buildReturnRateRow,
} from "./useAiCopyTextRows";
import { getAiCopyPromptText } from "../utils/aiCopyPrompts";
import { isInCautionEnabled } from "../config/featureFlags";
import { aiCopyPageUrl, buildAiCopyText } from "../utils/aiCopyText";
import { isRaceCancelled } from "../utils/raceCancellation";
import { splitRacerName } from "../utils/racerName";

// courseStats: useSixBoatCourseStats の戻り値。想定コース1着率の行に使う（データ出走表と同じ値、BOA-1296）
function buildRows(
  t,
  players,
  analysis,
  flying,
  raceId,
  originalExhibition,
  courseStats = { status: "error", rows: [] },
) {
  const courseByBoat = new Map(
    (courseStats.status === "ready" ? courseStats.rows : []).map((r) => [
      r.boat,
      r,
    ]),
  );
  const originalRows = buildOriginalExhibitionRows(t, originalExhibition);
  const originalKeys = new Set(originalRows.map((r) => r.key));
  const originalLabels = originalExhibitionKindLabels(t,
    (originalExhibition?.kinds ?? []).filter((kind) =>
      originalKeys.has(ORIGINAL_EXHIBITION_ROW_META[kind]?.key),
    ),
  );
  const motorByBoat = byBoat(analysis.motor);
  const formByBoat = byBoat(analysis.racerForm);
  const stByBoat = byBoat(analysis.stPredictability);
  const exByBoat = byBoat(analysis.exhibitionTime);
  const maintenanceByBoat = byBoat(analysis.motorMaintenance);
  const techByBoat = byBoat(analysis.techniqueProfile);
  const rateByBoat = byBoat(analysis.returnRate);
  const meetPrevByBoat = byBoat(analysis.meetPrevRun);
  const officialStByBoat = new Map(
    (analysis.officialAvgSt?.rows ?? []).map((r) => [r.boatNumber, r.avgSt]),
  );
  const st30ByBoat = new Map(
    (analysis.st30 ?? []).map((r) => [r.boatNumber, r.st30]),
  );

  const ui = {
    toNumber,
    translateTechnique,
    translatePartName,
    expectedCourseWinRateText,
  };

  return [
    buildNameRow(t, players),
    buildWinRateRow(t, players, flying, ui),
    buildLocalWinRateRow(t, players, ui),
    buildTwoRateRow(t, players, ui),
    buildMotorRow(t, players, motorByBoat, ui),
    buildFormRow(t, players, formByBoat),
    buildAvgStOfficialRow(t, players, officialStByBoat, ui),
    buildAvgSt30Row(t, players, st30ByBoat, ui),
    buildStRow(t, players, stByBoat),
    buildExhibitionStRow(t, players, stByBoat),
    buildExhibitionTimeRow(t, players, exByBoat),
    // 直前情報表と同じ位置・行生成・値の整形を使う。
    ...originalRows.map((r, i) => ({
      key: r.key,
      label: r.label,
      originalExhibitionLabel: originalLabels[i],
      values: players.map((p) => r.formatValue(p)),
    })),
    ...(isExhibitionCourseOutOfRange(raceId, analysis.motorMaintenance)
      ? []
      : [buildExhibitionCourseRow(t, players, maintenanceByBoat, ui)]),
    buildTodayWeightRow(t, players, maintenanceByBoat, ui),
    buildTiltRow(t, players, maintenanceByBoat, ui),
    buildAdjustmentWeightRow(t, players, maintenanceByBoat, ui),
    buildPartsChangedRow(t, players, maintenanceByBoat, ui),
    buildPrevResultRow(t, players, meetPrevByBoat),
    buildExpectedCourseWinRateRow(t, players, courseByBoat, ui),
    buildTechniqueRow(t, players, techByBoat, ui),
    buildReturnRateRow(t, players, rateByBoat),
  ];
}

// 展示タイム・展示STのどれかが出ていれば「展示後」とみなす。
// どちらかの取得に失敗したときは分からないので null（「未反映」の行を出さない。取得失敗を
// 展示前と言い切らないため）
function isExhibitionPublished(analysis) {
  const hasValue = (v) => v !== null && v !== undefined;
  const published =
    (analysis.exhibitionTime ?? []).some((r) => hasValue(r.exhibition_time)) ||
    (analysis.stPredictability ?? []).some((r) => hasValue(r.exhibition_st));
  if (published) return true;
  if (analysis.failed?.exhibitionTime || analysis.failed?.stPredictability)
    return null;
  return false;
}

// レース切替時に前レースの値をコピーしない。取得失敗はこの行だけ省き、理由を記録する。
function useOriginalExhibition(raceId) {
  const [fetchedExhibition, setFetchedExhibition] = useState(null);
  useEffect(() => {
    if (!raceId) return undefined;
    let cancelled = false;
    getRaceOriginalExhibition(raceId)
      .then((data) => {
        if (!cancelled) setFetchedExhibition({ raceId, data });
      })
      .catch((err) => {
        console.error("AI用コピーのオリジナル展示取得エラー:", err?.message ?? String(err));
        if (!cancelled) setFetchedExhibition({ raceId, data: null, failed: true });
      });
    return () => { cancelled = true; };
  }, [raceId]);
  return fetchedExhibition?.raceId === raceId
    ? fetchedExhibition.data : null;
}

// 公式の全角空白の桁揃え（全角空白の連続）は外し、姓と名を半角空白1つで区切る。
// 表と展開予測の両方で同じ名前にするため、ここで1回だけ整える
function sortedPlayers(prediction) {
  return [...(prediction?.allPlayers ?? [])]
    .sort((a, b) => a.number - b.number)
    .map((p) =>
      p.name ? { ...p, name: splitRacerName(p.name).join(" ") } : p,
    );
}

// 会場名はvenues.*i18nキー経由で翻訳する（他箇所と同じ既存パターン。
// race?.venueは日本語の生値のため、非ja言語では直接使えない）
function venueLabelOf(t, race, venueCode) {
  return venueCode
    ? t(`venues.${venueCode}`, race?.venue ?? "")
    : (race?.venue ?? "");
}

// 予測側の値を優先し、無ければ race.rawData の値、どちらも無ければ null
function predictionOrRaw(prediction, raw, key) {
  return prediction?.[key] ?? raw[key] ?? null;
}

function buildContext({ raceId, race, prediction, venueCode }) {
  const raw = race?.rawData ?? {};
  return {
    date: (raceId ?? "").slice(0, 10),
    startTime: race?.startTime || null,
    raceGrade: predictionOrRaw(prediction, raw, "raceGrade"),
    seriesTitle: race?.seriesTitle ?? null,
    seriesDayLabel: race?.seriesDayLabel ?? null,
    raceStage: predictionOrRaw(prediction, raw, "raceStage"),
    weather: predictionOrRaw(prediction, raw, "weather"),
    venueCode: venueCode ?? null,
  };
}

export function useAiCopyText({ raceId, prediction, race, venueCode }) {
  const { t, i18n } = useTranslation();
  // venueCodeを渡さないとDataRaceTable側のuseRaceAnalysisData呼び出しと
  // キャッシュキー・in-flightデデュープが分岐し、同じレースのモーター内訳を
  // 二重に取得してしまう（BOA-265でDataRaceTable側にvenueCodeを追加した際に発覚）
  const analysis = useRaceAnalysisData(raceId, { venueCode });
  const flyingRows = useRaceEntryFlyingRows(raceId);
  const currentMeetFlying = useCurrentMeetFlyingBoats(raceId);
  const originalExhibition = useOriginalExhibition(raceId);
  const players = sortedPlayers(prediction);

  const courseStats = useSixBoatCourseStats({
    raceDate: raceId?.slice(0, 10),
    venueCode,
    players,
  });

  const buildText = (promptType) => {
    if (players.length === 0) return "";
    const lang = i18n.resolvedLanguage;
    const inCautionEnabled = isInCautionEnabled();
    return buildAiCopyText({
      t,
      heading: t("aiCopy.markdownHeading", {
        venue: venueLabelOf(t, race, venueCode),
        race: race?.raceNumber ?? "",
      }),
      context: buildContext({ raceId, race, prediction, venueCode }),
      players,
      rows: buildRows(
        t,
        players,
        analysis,
        { rows: flyingRows, currentMeet: currentMeetFlying },
        raceId,
        originalExhibition,
        courseStats,
      ),
      // BOA-822: 機能フラグの側では展開予測を画面から外すので、コピーにも入れない
      turnPrediction: inCautionEnabled ? null : prediction?.turnPrediction,
      prompt: getAiCopyPromptText(t, promptType, { inCautionEnabled }),
      pageUrl: aiCopyPageUrl(raceId, lang),
      now: new Date(),
      exhibitionPublished: isExhibitionPublished(analysis),
    });
  };

  // analysisは複数クエリの並列取得（30分TTLキャッシュ）で、DataRaceTableと
  // 同じソースを共有する。読み込み未完了のままコピーすると本来値が有る行まで
  // 「—」として出力されうるため、読み込み完了までボタン自体を出さない。
  // 中止確定のレースは分析する対象が無いので出さない（BOA-424。呼び出し側の
  // PredictionPanel でも隠しているが、別の画面から使われたときの保険）
  return {
    buildText,
    isReady:
      players.length > 0 &&
      !analysis.loading &&
      courseStats.status !== "loading" &&
      !isRaceCancelled(prediction),
  };
}
