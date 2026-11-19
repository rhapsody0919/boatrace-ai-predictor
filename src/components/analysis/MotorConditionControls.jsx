/** MotorConditionChart の見出しと期間の切り替え（MotorConditionChart.jsx から本文を字のまま移した） */
import { useTranslation } from "react-i18next";
import { formatGenerationDate } from "../../utils/motorGeneration";

export function MotorTitle() {
  const { t } = useTranslation();
  return (
    <>
      <h2>{t("analysis.motor.title")}</h2>
      <p className="section-description">
        {t("analysis.motor.description")}
      </p>
    </>
  );
}

export function PeriodControls({ m, v }) {
  const { t } = useTranslation();
  const { generationStart, periodDays, setPeriodDays, drillDownMotor, racePreGeneration } = m;
  const { showPeriodToggle, periodChoiceHasEffect, clippedByGeneration, officialMode } = v;
  return showPeriodToggle ? (
    <>
      {/* 現行モーターの使用開始日。いつからのモーターかが分からないと、「入れ替え後の
          ため期間を限っています」を「最近入れ替えた」と読み違える（2026-09-29 ユーザー指摘）。
          当日のレースだけに出す（過去レースは出走表時点の公式値で、取れるのは最新の
          使用開始日1つだけのため、当時の日付を出せない） */}
      {generationStart !== null && (
        <p className="motor-generation-start">
          {t("analysis.motor.generationStartLabel", {
            date: formatGenerationDate(generationStart),
          })}
          <span className="motor-generation-start-source">
            {t("analysis.motor.generationStartSource")}
          </span>
        </p>
      )}
      {periodChoiceHasEffect && (
        <div className="period-toggle" role="group">
          <button
            type="button"
            className={`period-toggle-btn ${periodDays === 90 ? "active" : ""}`}
            onClick={() => setPeriodDays(90)}
          >
            {t("analysis.motor.period90")}
          </button>
          <button
            type="button"
            className={`period-toggle-btn ${periodDays === 30 ? "active" : ""}`}
            onClick={() => setPeriodDays(30)}
          >
            {t("analysis.motor.period30")}
          </button>
        </div>
      )}
      {clippedByGeneration && (
        <p className="table-note">
          {t("analysis.motor.periodClippedNote", {
            date: formatGenerationDate(generationStart, { short: true }),
          })}
        </p>
      )}
    </>
  ) : (
    officialMode &&
    drillDownMotor === null && (
      <p className="table-note">
        {t("analysis.motor.periodOfficialNote")}
        {racePreGeneration &&
          ` ${t("analysis.motor.racePreGenerationNote")}`}
      </p>
    )
  );
}
