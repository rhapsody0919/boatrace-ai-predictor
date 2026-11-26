/**
 * 枠別情報の「ST履歴」の上に出す、6艇の ST の推移（R-36、オーナー 2026-11-26 の時系列の残り）。
 * 各艇の想定コースで走った全走の、1走ごとの生の ST を走の順に並べる（窓の平均でない）。
 * フライング（F）・出遅れ（L）の走は値を持たず線を切り、選んだ艇だけ図の上端に印を出す。
 * 選ぶ艇は折りたたみのチップ（detailBoat）と同じ。点の吹き出しからその走のレース詳細へ飛べる（11/25 の決まり）。
 */
import { useTranslation } from "react-i18next";
import TrendChart from "./basic-info/TrendChart";
import { getRecentRaces } from "../../pure/basicInfoStats.js";
import { TREND_MAX_POINTS } from "../../pure/racerTrendSeries.js";
import "./basic-info/TrendChart.css";

const dayOf = (date) => Date.parse(`${date}T00:00:00Z`) / 86400000;

/** 1艇の想定コースの走（古い順）を、生の ST の点に直す */
function stPoints(records, course) {
  const rows = (records ?? [])
    .filter((r) => r.actualCourse === course)
    .slice(-TREND_MAX_POINTS);
  const runs = getRecentRaces(rows, rows.length);
  return rows.map((r, i) => ({
    raceId: r.raceId,
    date: r.date,
    value: r.isFlying || r.startTiming == null ? null : r.startTiming,
    flag: r.isFlying ? "F" : r.lateStartTiming != null ? "L" : null,
    gapDays:
      i === 0 ? null : Math.round(dayOf(r.date) - dayOf(rows[i - 1].date)),
    run: runs[i],
  }));
}

export default function RaceStHistoryTrend({
  columns,
  scopedByRacer,
  selected,
}) {
  const { t } = useTranslation();
  const series = new Map(
    columns
      .map(({ player, course }) => [
        player.number,
        stPoints(player.racerId ? scopedByRacer[player.racerId] : null, course),
      ])
      .filter(([, s]) => s.some((p) => p.value != null)),
  );
  if (series.size === 0) return null;
  return (
    <div className="trc-wrap trc-wrap--wide rsc-st-trend">
      <p className="rsc-fold-note">{t("stConsideration.trendNote")}</p>
      <TrendChart
        seriesByBoat={series}
        metric="st"
        selected={series.has(selected) ? selected : [...series.keys()][0]}
      />
    </div>
  );
}
