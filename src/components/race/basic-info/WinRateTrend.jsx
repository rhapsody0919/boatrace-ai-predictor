/**
 * 勝率の推移（公式の期別成績の段）の中身。値は useRacerPeriodStats が取る racer_period_stats の直近5期
 * （範囲・グレードの絞り込みは効かない。公式の期の値なので）。取得の失敗は InlineFetchError で出し取り直せる。
 */
import { useTranslation } from "react-i18next";
import InlineFetchError from "../../InlineFetchError";
import WinRateStepChart from "./WinRateStepChart";
import { winRateSteps } from "../../../pure/racerWinRateSteps.js";

const slash = (d) => `${d.slice(2, 4)}/${d.slice(5, 7)}`;
// 記録のある最後の期の勝率（図の右の札と同じ）
const lastWinRate = (steps) =>
  steps?.findLast(Boolean)?.winRate.toFixed(2) ?? null;

export default function WinRateTrend({
  periodStats,
  periodFailed,
  retryPeriod,
  raceDate,
  sortedPlayers,
  selectedBoat,
  renderPicker,
}) {
  const { t } = useTranslation();
  if (periodFailed)
    return (
      <div className="trc-wrap">
        <InlineFetchError onRetry={retryPeriod} />
      </div>
    );
  if (periodStats === undefined)
    return (
      <div className="trc-wrap">
        <p className="trc-note">{t("basicInfo.loading")}</p>
      </div>
    );
  const steps = winRateSteps(
    periodStats,
    sortedPlayers.map((p) => p.racerId),
    raceDate,
  );
  const stepsByBoat = new Map(
    sortedPlayers
      .map((p) => [p.number, steps?.byRacer.get(p.racerId)])
      .filter(([, s]) => s?.some(Boolean)),
  );
  if (!steps || stepsByBoat.size === 0)
    return (
      <div className="trc-wrap">
        <p className="trc-note">{t("basicInfo.trend.noRecord")}</p>
      </div>
    );
  const selected = stepsByBoat.has(selectedBoat)
    ? selectedBoat
    : [...stepsByBoat.keys()][0];
  return (
    <div className="trc-wrap trc-wrap--wide">
      {/* 1200px 以上は左に段・右に6艇の一覧と注記（走ごとの線と同じ、オーナー 11/25 の案 A） */}
      <div className="race-split trc-split">
        <div className="race-split__main">
          <WinRateStepChart
            stepsByBoat={stepsByBoat}
            periods={steps.periods}
            selected={selected}
          />
        </div>
        <div className="race-split__side">
          {/* 艇の選びは走ごとの線と同じ部品（BasicInfoTrend の BoatPicker。相互の import を避けて渡してもらう） */}
          {renderPicker(
            (boat) => stepsByBoat.has(boat),
            selected,
            (boat) => lastWinRate(stepsByBoat.get(boat)),
          )}
          <p className="trc-note">
            {t("basicInfo.trend.winRateNote")}
            {steps.pending &&
              t("basicInfo.trend.winRateNotYet", {
                from: slash(steps.pending.calcFrom),
                to: slash(steps.pending.calcTo),
              })}
          </p>
        </div>
      </div>
    </div>
  );
}
