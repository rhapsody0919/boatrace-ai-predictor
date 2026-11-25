/**
 * 推移の線の点の吹き出し（オーナー 2026-11-25、ファン4人の検討の最終案。棚卸しの追補 timeseries-hover-links.md の「走」）。
 * 3行まで: 日付・会場・R・グレード／艇番→進入コース・着順・ST／その時点の値。頭に「レースへ →」でレース詳細へ飛べる。
 * 決まり手・展示は出さない（飛び先で見る）。ほかの艇の値は添えない（横の位置が艇ごとに違う日付になるため）。
 */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
// 言語の接頭辞は純関数の localizePath で付ける（config/languages は記事の束を読み込むので通さない）
import { localizePath } from "../../../pure/localizePath.js";
import { GRADE_LABELS } from "../raceGradeLabels";
import { venueNameOf, raceNumberLabel } from "../../../utils/raceListDisplay";

// ST は公式の表記にそろえて先頭の 0 を省く（0.14 → .14）。F は記号を前に付ける（RecentRunsTableRows と同じ書き方）
const stText = (run) => {
  if (run.startTiming == null) return run.isFlying ? "F" : "-";
  const s = Number(run.startTiming).toFixed(2).replace(/^0/, "");
  return run.isFlying ? `F${s}` : s;
};

function finishText(t, run) {
  if (run.finishRank != null)
    return t("basicInfo.trend.tipRank", { rank: run.finishRank });
  if (run.absent) return t("basicInfo.finishAbsent");
  return run.finishMark ?? t("raceHistoryTable.finishUnknownShort");
}

export default function TrendTooltip({
  point,
  metric,
  leftPct,
  pinned,
  onClose,
}) {
  const { t, i18n } = useTranslation();
  const lp = (path) => localizePath(path, i18n.resolvedLanguage);
  const run = point.run;
  const value =
    metric === "avgSt" ? point.value.toFixed(2) : `${point.value.toFixed(1)}%`;
  return (
    <div
      className={`trc-tip${pinned ? " is-pinned" : ""}${leftPct > 55 ? " is-flip" : ""}`}
      style={{ left: `${leftPct}%` }}
    >
      {pinned && (
        <button
          type="button"
          className="trc-tip-close"
          onClick={onClose}
          aria-label={t("basicInfo.trend.tipClose")}
        >
          ×
        </button>
      )}
      {run && (
        <Link className="trc-tip-link" to={lp(`/race/${run.raceId}`)}>
          {t("basicInfo.trend.toRace")}
        </Link>
      )}
      {run && (
        <p className="trc-tip-line">
          {`${Number(run.date.slice(5, 7))}/${run.date.slice(8, 10)} `}
          {venueNameOf(t, Number(run.venueCode))} {raceNumberLabel(run.raceNo)}
          {run.raceGrade && ` ${GRADE_LABELS[run.raceGrade] ?? run.raceGrade}`}
        </p>
      )}
      {run && (
        <p className="trc-tip-line">
          {t("basicInfo.trend.tipCourse", {
            boat: run.boatNumber,
            course: run.entryCourse ?? "-",
          })}{" "}
          {finishText(t, run)} ST {stText(run)}
        </p>
      )}
      <p className="trc-tip-line trc-tip-value">
        {t("basicInfo.trend.tipValue", {
          metric: t(`basicInfo.metrics.${metric}`),
          value,
        })}
      </p>
    </div>
  );
}
