/**
 * モーターの推移の節の点の吹き出し（オーナー 2026-11-25 承認のモック、mock-motor-trend/tip/tip-mock.png）。
 * 選手の推移の吹き出し（TrendTooltip）と同じ形・同じ見た目（trc-tip）で、頭に「節へ →」でその節のページへ飛べる。
 * 3行: 節の期間・会場・グレード・日数／乗った選手とこの節の着順／点の値（節の初日の公式の率と、それまでの走数）。
 * 点の値はその節に入る前までの累計で、選手と着順はその節の中の物（3行目の「節の初日」「それまで」で示す）
 */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { localizePath } from "../../pure/localizePath.js";
import { GRADE_LABELS } from "../race/raceGradeLabels";
import { venueNameOf } from "../../utils/raceListDisplay";

const md = (date) => `${Number(date.slice(5, 7))}/${date.slice(8, 10)}`;

/**
 * @param {{tip: ReturnType<import("../../pure/motorGenerationTrend.js").motorMeetTip>, point: {value:number, runs:number},
 *   venueCode: number, metric: "top2Rate"|"top3Rate", leftPct: number, pinned: boolean, onClose: () => void}} props
 */
export default function MotorMeetTooltip({ tip, point, venueCode, metric, leftPct, pinned, onClose }) {
  const { t, i18n } = useTranslation();
  const lp = (path) => localizePath(path, i18n.resolvedLanguage);
  return (
    <div className={`trc-tip${pinned ? " is-pinned" : ""}${leftPct > 55 ? " is-flip" : ""}`} style={{ left: `${leftPct}%` }}>
      {pinned && (
        <button type="button" className="trc-tip-close" onClick={onClose} aria-label={t("basicInfo.trend.tipClose")}>
          ×
        </button>
      )}
      <Link className="trc-tip-link" to={lp(`/venue/${Number(venueCode)}/meet/${tip.start}`)}>
        {t("analysis.motor.genTrend.toMeet")}
      </Link>
      <p className="trc-tip-line">
        {`${md(tip.start)}〜${md(tip.end)} ${venueNameOf(t, Number(venueCode))}`}
        {tip.grade && ` ${GRADE_LABELS[tip.grade] ?? tip.grade}`}
        {tip.days && ` ${t("analysis.motor.genTrend.tipDays", { n: tip.days })}`}
      </p>
      {/* 選手名と着順の並びは長くなりうるので、この行だけ折り返す（3行の決まりは見出しの数で守る） */}
      <p className="trc-tip-line mtc-tip-wrap">
        {tip.racerName && <span translate="no">{t("analysis.motor.genTrend.tipRacer", { name: tip.racerName.replace(/\s+/g, "") })} </span>}
        {t("analysis.motor.genTrend.tipFinishes", { order: tip.finishes.map((f) => f ?? "-").join("-") })}
      </p>
      <p className="trc-tip-line trc-tip-value">
        {t("analysis.motor.genTrend.tipValue", {
          metric: t(`analysis.motor.genTrend.metric.${metric}`),
          value: `${point.value.toFixed(1)}%`,
          runs: point.runs,
        })}
      </p>
    </div>
  );
}
