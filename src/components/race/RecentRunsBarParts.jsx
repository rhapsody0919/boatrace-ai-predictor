/**
 * RecentRunsBarParts - RecentRunsBar の 1 走タイルと詳細行（RecentRunsBar.jsx から移しただけ）
 */
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import { finishPositionOf } from "./basicInfoStats";
import { finishMarkKeyOf } from "../../utils/prevResult";
import { GRADE_LABELS } from "./raceGradeLabels";

function rankClass(rank) {
  if (rank === null) return "rrb-rank-bad";
  if (rank === 1) return "rrb-rank-first";
  if (rank <= 3) return "rrb-rank-good";
  if (rank <= 4) return "rrb-rank-mid";
  return "rrb-rank-bad";
}

const formatSt = (r) =>
  r.isFlying
    ? null
    : r.stForRank === null || r.stForRank === undefined
      ? null
      : Number(r.stForRank).toFixed(2).replace(/^0/, "");

const monthDay = (raceId) =>
  `${Number(raceId.slice(5, 7))}/${Number(raceId.slice(8, 10))}`;

// 着順の付かない走は公式の記号（F・沈・転など）で出す。以前は一律「外」で、F（本人の
// 事故）と沈・転覆を区別できなかった（BOA-604 ファン評価1周目）。データ出走表・
// 直近10走と同じ表記（finishMarkKeyOf）
const finishLabelOf = (t, r) => {
  const rank = finishPositionOf(r);
  if (rank !== null) return null;
  if (r.absent) return t("basicInfo.finishAbsent");
  const key = finishMarkKeyOf(r.finishMark ?? (r.isFlying ? "F" : null));
  return key ? t(`dataTable.prevMark.${key}`) : t("wakuInfo.outOfPlace");
};

export function RecentRunsTile({ r, isSelected, onSelect }) {
  const { t } = useTranslation();
  const rank = finishPositionOf(r);
  const course = r.actualCourse ?? null;
  const color = course ? BOAT_COLORS[course] || {} : {};
  return (
    <button
      type="button"
      data-race-id={r.raceId}
      className={`rrb-item${isSelected ? " is-selected" : ""}`}
      aria-pressed={isSelected}
      onClick={() => onSelect(r.raceId)}
    >
      <span className="rrb-date">{monthDay(r.raceId)}</span>
      <span
        className="rrb-course"
        style={
          course ? { background: color.bg, color: color.text } : undefined
        }
      >
        {course ?? "—"}
      </span>
      <span className={`rrb-rank ${rankClass(rank)}`}>
        {rank ?? finishLabelOf(t, r)}
      </span>
      <span className="rrb-st">
        {r.isFlying ? t("recentRuns.flying") : (formatSt(r) ?? "—")}
      </span>
      <span className="rrb-st-rank">
        {r.isFlying || r.stRank === null || r.stRank === undefined
          ? ""
          : t("recentRuns.stRank", { n: r.stRank })}
      </span>
    </button>
  );
}

// 括弧の中はグレードとレース名。「SG・G1」の行で「（一般戦）」とだけ出ると、
// 表の「一般戦」行と同じ言葉で集計が混ざったように読まれた（ファン評価1周目）
// 一般戦の節は「一般戦」が名前と重なるので、グレードを付けるのは SG・G1・G2・G3 だけ
function stageText(t, selected) {
  if (!selected.raceStage) return "";
  if (selected.raceGrade && selected.raceGrade !== "ippan") {
    return t("recentRuns.stageWithGrade", {
      grade: t(
        `raceHistoryTable.grades.${selected.raceGrade}`,
        GRADE_LABELS[selected.raceGrade] ?? selected.raceGrade,
      ),
      stage: selected.raceStage,
    });
  }
  return t("recentRuns.stageOnly", { stage: selected.raceStage });
}

function stText(t, selected) {
  if (selected.isFlying) return t("recentRuns.flying");
  if (formatSt(selected) === null) return "—";
  return `${formatSt(selected)}${
    selected.stRank ? t("recentRuns.stRank", { n: selected.stRank }) : ""
  }`;
}

export function RecentRunsDetail({ selected }) {
  const { t } = useTranslation();
  return (
    <p className="rrb-detail" aria-live="polite">
      {t("recentRuns.detail", {
        date: monthDay(selected.raceId),
        venue: t(`venues.${selected.venueCode}`, String(selected.venueCode)),
        race: Number(selected.raceId.slice(14, 16)),
        stage: stageText(t, selected),
        course: selected.actualCourse
          ? t("dataTable.prevResultCourse", { course: selected.actualCourse })
          : "—",
        finish:
          finishPositionOf(selected) !== null
            ? t("review.finishPosition", {
                position: finishPositionOf(selected),
              })
            : finishLabelOf(t, selected),
        st: stText(t, selected),
      })}
    </p>
  );
}
