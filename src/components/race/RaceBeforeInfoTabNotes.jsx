/**
 * RaceBeforeInfoTab の「展示情報」表の下の注記・出典。
 * RaceBeforeInfoTab.jsx から移しただけ（出力は変えない）。
 */
import { useTranslation } from "react-i18next";
import InlineFetchError from "../InlineFetchError";
import { originalExhibitionKindLabels, toNumber } from "./raceIndicators";
import { formatCapturedAtJst } from "../../utils/formatters";

// 出走表の体重の取得失敗は、展示前の体重を出せないときだけ示す
// （全艇に直前情報の体重があれば、表示に影響しないため）
function EntryWeightError({ entryWeights, sortedPlayers, analysis, onRetry }) {
  const { t } = useTranslation();
  const allHaveTodayWeight = sortedPlayers.every(
    (p) =>
      toNumber(
        (analysis.motorMaintenance ?? []).find(
          (r) => r.boat_number === p.number,
        )?.today_weight,
      ) !== null,
  );
  if (entryWeights.state !== "error" || allHaveTodayWeight) return null;
  return (
    <InlineFetchError
      message={t("beforeInfo.entryWeightFetchError")}
      onRetry={onRetry}
    />
  );
}

function OriginalExhibitionSource({ originalExhibition }) {
  const { t } = useTranslation();
  return (
    <>
      <p className="rbi-source-text">
        {t("beforeInfo.originalExhibitionSource", {
          items: originalExhibitionKindLabels(t, originalExhibition.kinds).join(
            t("beforeInfo.originalExhibitionItemSeparator"),
          ),
        })}
      </p>
      {formatCapturedAtJst(originalExhibition.capturedAt) && (
        <p className="rbi-source-text">
          {t("beforeInfo.originalExhibitionCapturedAt", {
            time: formatCapturedAtJst(originalExhibition.capturedAt),
          })}
          {t("home.jstNote")}
        </p>
      )}
    </>
  );
}

// オリジナル展示（BOA-452 / ADR-0067）の出典。値を出したときだけ、
// 表のすぐ下に1回。ピットレポート（RacePitReportSection）と同じ形で、
// 出典・取得時刻・再配布しない旨の3点を書く
function SourceBlock({
  hasOriginalExhibitionSource,
  hasExhibitionCourseSource,
  exhibitionCourseTime,
  originalExhibition,
}) {
  const { t } = useTranslation();
  return (
    <div className="rbi-source" data-testid="rbi-source">
      {hasExhibitionCourseSource && (
        <p className="rbi-source-text">
          {t("beforeInfo.exhibitionCourseSource")}
          {exhibitionCourseTime && (
            <>
              {" / "}
              {t("beforeInfo.originalExhibitionCapturedAt", {
                time: exhibitionCourseTime,
              })}
              {t("home.jstNote")}
            </>
          )}
        </p>
      )}
      {hasOriginalExhibitionSource && (
        <OriginalExhibitionSource originalExhibition={originalExhibition} />
      )}
      {/* 注記は1回だけ。BOATCASTだけなら従来の文言、展示進入を含むなら
          出典が2つありうるので「各出典で」の文言にする */}
      <p className="rbi-source-text">
        {hasExhibitionCourseSource
          ? t("beforeInfo.rawValuesNote")
          : t("beforeInfo.originalExhibitionNote")}
      </p>
    </div>
  );
}

export default function RaceBeforeInfoTabNotes({
  entryWeights,
  sortedPlayers,
  analysis,
  onRetryEntryWeights,
  showPreExhibitionNote,
  showTurnTimeNote,
  noMeetComparison,
  exhibitionCourseOutOfRange,
  hasOriginalExhibitionSource,
  hasExhibitionCourseSource,
  exhibitionCourseTime,
  originalExhibition,
}) {
  const { t } = useTranslation();
  return (
    <>
      <EntryWeightError
        entryWeights={entryWeights}
        sortedPlayers={sortedPlayers}
        analysis={analysis}
        onRetry={onRetryEntryWeights}
      />
      {showPreExhibitionNote && (
        <p className="rbi-note" data-testid="rbi-pre-exhibition-note">
          {t("beforeInfo.preExhibitionNote")}
        </p>
      )}
      {/* 「※」の行に近いよう、表の下の注記の先頭に置く（ファン評価1周目） */}
      {showTurnTimeNote && (
        <p className="rbi-note" data-testid="rbi-turn-time-venue-note">
          ※ {t("beforeInfo.turnTimeVenueNote")}
        </p>
      )}
      <p className="rbi-note">💡 {t("beforeInfo.detailTableNote")}</p>
      {/* 金枠と⚠の意味（PR #1193 ファン評価1周目: 件数が少なくて金枠を外したことが読めなかった） */}
      <p className="rbi-note">
        {t(
          noMeetComparison
            ? "beforeInfo.bestLegendNoMeet"
            : "beforeInfo.bestLegend",
        )}
      </p>
      {exhibitionCourseOutOfRange && (
        <p className="rbi-note" data-testid="exhibition-course-out-of-range">
          {t("beforeInfo.exhibitionCourseOutOfRange")}
        </p>
      )}
      {(hasOriginalExhibitionSource || hasExhibitionCourseSource) && (
        <SourceBlock
          hasOriginalExhibitionSource={hasOriginalExhibitionSource}
          hasExhibitionCourseSource={hasExhibitionCourseSource}
          exhibitionCourseTime={exhibitionCourseTime}
          originalExhibition={originalExhibition}
        />
      )}
    </>
  );
}
