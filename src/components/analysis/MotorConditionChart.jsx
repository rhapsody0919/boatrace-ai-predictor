/**
 * MotorConditionChart - モーター調子（BOA-151）
 * 本日開催中の会場・レースを選ぶと、そのレースの枠番別モーター調子
 * （2連率/3連率）を一覧表示する。「このレースのどの艇のモーターが
 * 調子いいか」を直接示すことで、賭ける判断にそのまま使えるようにする。
 * 気になるモーターは節ごとの推移グラフにドリルダウンできる。
 */
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { supabaseDataService } from "../../services/supabaseDataService";
import { STADIUM_NAMES as VENUE_NAMES } from "../../constants";
import { useVenueRaceSelector } from "../../hooks/useVenueRaceSelector";
import RacerGradeBadge from "../racer/RacerGradeBadge";
import MotorStatBadgeRow from "../MotorStatBadgeRow";
import MotorRecordStatCards from "../MotorRecordStatCards";
import TrendLineChart from "./TrendLineChart";
import DrillDownHeader from "./DrillDownHeader";
import "./MotorConditionChart.css";

function MotorConditionChart({
  initialVenueCode = null,
  initialRaceId = null,
  initialMotorNumber = null,
  embedded = false,
}) {
  const { t } = useTranslation();
  const {
    venues,
    selectedVenue,
    setSelectedVenue,
    races,
    selectedRace,
    setSelectedRace,
    loading,
    setLoading,
    error,
    setError,
  } = useVenueRaceSelector({ initialVenueCode, initialRaceId, embedded, t });

  const [breakdown, setBreakdown] = useState([]);
  const [drillDownMotor, setDrillDownMotor] = useState(null);
  const [trendData, setTrendData] = useState(null);

  const [powerIndex, setPowerIndex] = useState(null);
  const [usageHistory, setUsageHistory] = useState([]);
  const [partsHistory, setPartsHistory] = useState([]);
  const [venueMotorStats, setVenueMotorStats] = useState(null);
  const [championshipHistory, setChampionshipHistory] = useState([]);
  const [periodDays, setPeriodDays] = useState(90);
  const pendingInitialMotorNumber = useRef(initialMotorNumber);
  // レース/会場が変わった時だけドリルダウンをリセットする（期間トグルだけの
  // 変更でドリルダウン中の画面が一覧に戻されてしまわないようにするため）
  const lastRaceVenueRef = useRef(null);

  // レース選択時: 枠番別モーター調子を取得（機力指数はvenue確定後に別途取得）
  useEffect(() => {
    if (selectedRace === null) return;
    const raceVenueKey = `${selectedRace}-${selectedVenue}`;
    const isNewRaceOrVenue = lastRaceVenueRef.current !== raceVenueKey;
    lastRaceVenueRef.current = raceVenueKey;
    // StrictMode（開発時）の2回実行対策: 使い捨ての1回目でpendingを消費しきって
    // しまわないよう、cleanup側で未適用（cancelled）なら元に戻す
    const pendingSnapshot = pendingInitialMotorNumber.current;
    let cancelled = false;
    let applied = false;
    const loadBreakdown = async () => {
      try {
        setLoading(true);
        setError(null);
        if (isNewRaceOrVenue) setDrillDownMotor(null);
        const data = await supabaseDataService.getRaceMotorBreakdown(
          selectedRace,
          selectedVenue,
          periodDays,
        );
        if (cancelled) return;
        setBreakdown(data);
        // 機力バッジ等からのディープリンク（?motor=）で指定されたモーターが
        // 今回のレースに実在すれば、そのままドリルダウン画面を開く。
        // マッチしなかった場合もpendingは消費する（消費せず残すと、後で
        // ユーザーが手動で選んだ別レースがたまたま同じモーター番号を含んでいた際に
        // 意図せず自動ドリルダウンしてしまうため）
        const pendingExists =
          pendingSnapshot !== null &&
          data.some((r) => r.motor_number === pendingSnapshot);
        if (pendingExists) {
          setDrillDownMotor(pendingSnapshot);
        }
        pendingInitialMotorNumber.current = null;
        applied = true;
      } catch (err) {
        if (cancelled) return;
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load race motor breakdown:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadBreakdown();
    return () => {
      cancelled = true;
      if (!applied) pendingInitialMotorNumber.current = pendingSnapshot;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRace, selectedVenue, periodDays]);

  // モーター選択時: 節ごとの推移と機力指数を取得
  useEffect(() => {
    if (drillDownMotor === null || selectedVenue === null) return;
    const loadTrend = async () => {
      try {
        setLoading(true);
        setError(null);
        const [trend, power, history, parts, venueStats, championships] =
          await Promise.all([
            supabaseDataService.getMotorConditionTrend(
              selectedVenue,
              drillDownMotor,
              periodDays,
            ),
            supabaseDataService.getMotorPowerIndex(
              selectedVenue,
              drillDownMotor,
              periodDays,
            ),
            supabaseDataService.getMotorUsageHistory(
              selectedVenue,
              drillDownMotor,
            ),
            supabaseDataService.getMotorPartsHistory(
              selectedVenue,
              drillDownMotor,
              periodDays,
            ),
            supabaseDataService.getVenueMotorStats(
              selectedVenue,
              drillDownMotor,
            ),
            supabaseDataService.getVenueMotorChampionshipHistory(
              selectedVenue,
              drillDownMotor,
            ),
          ]);
        setTrendData(trend);
        setPowerIndex(power);
        setUsageHistory(history);
        setPartsHistory(parts.events ?? []);
        setVenueMotorStats(venueStats);
        setChampionshipHistory(championships);
      } catch (err) {
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load motor condition trend:", err);
      } finally {
        setLoading(false);
      }
    };
    loadTrend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVenue, drillDownMotor, periodDays]);

  const chartData = (trendData?.trend ?? []).map((row) => ({
    date: row.date.slice(5),
    motor_2rate: row.motor_2rate,
    motor_3rate: row.motor_3rate,
  }));

  const exhibitionChartData = (trendData?.trend ?? [])
    .filter((row) => row.exhibition_time !== null)
    .map((row) => ({
      date: row.date.slice(5),
      exhibition_time: row.exhibition_time,
    }));

  const usageHistoryChartData = usageHistory
    .filter((meet) => meet.rate2 !== null)
    .map((meet) => ({
      date: meet.playerName?.replace(/\s+/g, "") ?? "",
      rate2: meet.rate2,
      rate3: meet.rate3,
    }));

  const bestMotor2Rate =
    breakdown.length > 0
      ? Math.max(...breakdown.map((r) => r.motor_2rate ?? 0))
      : null;

  // kyoteibiyori等の会場出走表に倣い、優出数・優勝数・1着率は艇ごとの
  // 単一バッジではなく、同じレースの全艇を横並びで比較できる列として表示する
  // （1位・2位を色分けするのも合わせて模倣。BOA-264追加調査）
  const firstPlaceRates = breakdown.map((r) =>
    r.race_count && r.first_place_count !== null
      ? (r.first_place_count / r.race_count) * 100
      : null,
  );
  const rankClassFor = (values) => {
    const distinct = [...new Set(values.filter((v) => v !== null))].sort(
      (a, b) => b - a,
    );
    // 全艇が同値（例: まだ実績が無く全て0）の場合は「1位」を強調する意味が
    // 無いため、RaceCardDataTable.jsxのrankClass()と同じくハイライトなしにする
    if (distinct.length <= 1) return () => "";
    return (value) => {
      if (value === null || value === undefined) return "";
      if (distinct[0] !== undefined && value === distinct[0])
        return "motor-stat-rank1";
      if (distinct[1] !== undefined && value === distinct[1])
        return "motor-stat-rank2";
      return "";
    };
  };
  const finalCountRankClass = rankClassFor(breakdown.map((r) => r.final_count));
  const championshipCountRankClass = rankClassFor(
    breakdown.map((r) => r.championship_count),
  );
  const firstPlaceRateRankClass = rankClassFor(firstPlaceRates);

  return (
    <div className="motor-condition-container">
      {!embedded && (
        <>
          <h2>{t("analysis.motor.title")}</h2>
          <p className="section-description">
            {t("analysis.motor.description")}
          </p>
        </>
      )}

      {!embedded &&
        (venues.length === 0 && !loading ? (
          <div className="empty-state">{t("analysis.noRacesToday")}</div>
        ) : (
          <div className="controls-section">
            <label htmlFor="motor-venue-select">
              {t("analysis.venueSelectTodayLabel")}
            </label>
            <select
              id="motor-venue-select"
              value={selectedVenue ?? ""}
              onChange={(e) => setSelectedVenue(parseInt(e.target.value, 10))}
              className="venue-select"
            >
              {venues.map((v) => (
                <option key={v} value={v}>
                  {t(`venues.${v}`, VENUE_NAMES[v] || String(v))}
                </option>
              ))}
            </select>

            {races.length > 0 && (
              <>
                <label htmlFor="motor-race-select">
                  {t("analysis.raceSelectLabel")}
                </label>
                <select
                  id="motor-race-select"
                  value={selectedRace ?? ""}
                  onChange={(e) => setSelectedRace(e.target.value)}
                  className="venue-select"
                >
                  {races.map((r) => (
                    <option key={r.race_id} value={r.race_id}>
                      {t("analysis.raceOption", {
                        number: r.race_number,
                        time: r.start_time?.slice(0, 5),
                      })}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        ))}

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

      {loading && <div className="loading-state">{t("analysis.loading")}</div>}
      {error && (
        <div className="error-state">
          {t("analysis.error", { message: error })}
        </div>
      )}

      {!loading &&
        !error &&
        drillDownMotor === null &&
        breakdown.length > 0 && (
          <div className="table-wrapper">
            <table className="motor-ranking-table">
              <thead>
                <tr>
                  <th>{t("analysis.laneHeader")}</th>
                  <th>{t("table.playerName")}</th>
                  <th>{t("analysis.motor.motorNumberHeader")}</th>
                  <th>{t("analysis.motor.rate2Header")}</th>
                  <th>{t("analysis.motor.rate3Header")}</th>
                  <th>{t("analysis.motor.firstPlaceRateHeader")}</th>
                  <th>{t("analysis.motor.powerIndexHeader")}</th>
                  <th>{t("analysis.motor.finalCountHeader")}</th>
                  <th>{t("analysis.motor.championshipCountHeader")}</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((row, i) => (
                  <tr
                    key={row.boat_number}
                    className={`motor-ranking-row ${row.motor_2rate === bestMotor2Rate ? "best-motor" : ""}`}
                    onClick={() => setDrillDownMotor(row.motor_number)}
                  >
                    <td className="rank">{row.boat_number}</td>
                    <td translate="no">
                      {row.player_name?.replace(/\s+/g, "")}
                    </td>
                    <td className="motor-num">
                      {t("analysis.motor.motorUnit", { n: row.motor_number })}
                    </td>
                    <td className="rate">{row.motor_2rate?.toFixed(2)}</td>
                    <td className="rate">{row.motor_3rate?.toFixed(2)}</td>
                    <td
                      className={`rate ${firstPlaceRateRankClass(firstPlaceRates[i])}`}
                    >
                      {firstPlaceRates[i] !== null
                        ? `${firstPlaceRates[i].toFixed(1)}%`
                        : "-"}
                    </td>
                    <td
                      className={`rate power-index ${
                        row.power_index > 0
                          ? "power-index-good"
                          : row.power_index < 0
                            ? "power-index-bad"
                            : ""
                      }`}
                    >
                      {row.power_index !== null && row.power_index !== undefined
                        ? `${row.power_index > 0 ? "+" : ""}${row.power_index.toFixed(1)}`
                        : "-"}
                    </td>
                    <td
                      className={`rate ${finalCountRankClass(row.final_count)}`}
                    >
                      {row.final_count ?? "-"}
                    </td>
                    <td
                      className={`rate ${championshipCountRankClass(row.championship_count)}`}
                    >
                      {row.championship_count ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {!loading && !error && drillDownMotor !== null && (
        <>
          <DrillDownHeader
            onBack={() => setDrillDownMotor(null)}
            backLabel={t("analysis.backToList")}
            heading={t("analysis.motor.trendHeading", { n: drillDownMotor })}
          />

          {powerIndex?.power_index !== null &&
            powerIndex?.power_index !== undefined && (
              <p
                className={`power-index-summary ${
                  powerIndex.power_index > 0
                    ? "power-index-good"
                    : powerIndex.power_index < 0
                      ? "power-index-bad"
                      : ""
                }`}
              >
                {t("analysis.motor.powerIndexSummary", {
                  index: `${powerIndex.power_index > 0 ? "+" : ""}${powerIndex.power_index.toFixed(1)}`,
                  count: powerIndex.sample_count,
                  period: t(`analysis.motor.period${periodDays}`),
                })}
                {" — "}
                {powerIndex.power_index > 0
                  ? t("analysis.motor.powerIndexGood")
                  : powerIndex.power_index < 0
                    ? t("analysis.motor.powerIndexBad")
                    : ""}
              </p>
            )}

          <MotorStatBadgeRow
            icon="🔧"
            label={t("analysis.motor.freshnessLabel")}
            badges={[
              venueMotorStats?.raceCount !== null &&
                venueMotorStats?.raceCount !== undefined && {
                  key: "raceCount",
                  text: t("analysis.motor.freshnessRaceBadge", {
                    raceCount: venueMotorStats.raceCount,
                  }),
                },
              venueMotorStats?.meetCount !== null &&
                venueMotorStats?.meetCount !== undefined && {
                  key: "meetCount",
                  text: t("analysis.motor.freshnessMeetBadge", {
                    meetCount: venueMotorStats.meetCount,
                  }),
                },
            ].filter(Boolean)}
          />

          <MotorRecordStatCards
            cards={[
              venueMotorStats?.finalCount !== null &&
                venueMotorStats?.finalCount !== undefined && {
                  key: "finalCount",
                  value: venueMotorStats.finalCount,
                  label: t("analysis.motor.finalCountHeader"),
                },
              venueMotorStats?.championshipCount !== null &&
                venueMotorStats?.championshipCount !== undefined && {
                  key: "championshipCount",
                  value: venueMotorStats.championshipCount,
                  label: t("analysis.motor.championshipCountHeader"),
                },
              venueMotorStats?.firstPlaceCount !== null &&
                venueMotorStats?.firstPlaceCount !== undefined &&
                venueMotorStats?.raceCount && {
                  key: "firstPlaceRate",
                  value: `${(
                    (venueMotorStats.firstPlaceCount /
                      venueMotorStats.raceCount) *
                    100
                  ).toFixed(1)}%`,
                  label: t("analysis.motor.firstPlaceRateHeader"),
                },
            ].filter(Boolean)}
          />

          <h3 className="selected-motor-heading">
            {t("analysis.motor.championshipHistoryHeading")}
          </h3>
          {championshipHistory.length > 0 ? (
            <ul className="history-list">
              {championshipHistory.map((win) => (
                <li key={win.raceId}>
                  <span className="history-date">{win.date}</span>
                  <span translate="no" className="usage-history-player">
                    {win.playerName?.replace(/\s+/g, "")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">
              {t("analysis.motor.championshipHistoryEmpty")}
            </div>
          )}
          <p className="table-note">
            {t("analysis.motor.championshipHistoryNote")}
          </p>

          {chartData.length > 0 ? (
            <TrendLineChart
              data={chartData}
              yAxisLabel={t("analysis.motor.yAxis")}
              tooltipFormatter={(value) => `${value.toFixed(1)}%`}
              series={[
                {
                  dataKey: "motor_2rate",
                  name: t("analysis.motor.legend2"),
                  stroke: "var(--brand-accent-primary)",
                  type: "stepAfter",
                },
                {
                  dataKey: "motor_3rate",
                  name: t("analysis.motor.legend3"),
                  stroke: "var(--brand-accent-secondary)",
                  type: "stepAfter",
                },
              ]}
            />
          ) : (
            <div className="empty-state">{t("analysis.motor.trendEmpty")}</div>
          )}

          <h3 className="selected-motor-heading">
            {t("analysis.motor.exhibitionTrendHeading")}
          </h3>
          {exhibitionChartData.length > 0 ? (
            <TrendLineChart
              data={exhibitionChartData}
              yAxisLabel={t("analysis.motor.exhibitionYAxis")}
              tooltipFormatter={(value) => value.toFixed(2)}
              series={[
                {
                  dataKey: "exhibition_time",
                  name: t("analysis.motor.exhibitionLegend"),
                  stroke: "var(--brand-accent-primary)",
                  type: "monotone",
                },
              ]}
            />
          ) : (
            <div className="empty-state">
              {t("analysis.motor.exhibitionTrendEmpty")}
            </div>
          )}
          <p className="table-note">
            {t("analysis.motor.exhibitionTrendNote")}
          </p>

          <h3 className="selected-motor-heading">
            {t("analysis.motor.usageHistoryHeading")}
          </h3>
          {usageHistoryChartData.length > 1 && (
            <TrendLineChart
              data={usageHistoryChartData}
              yAxisLabel={t("analysis.motor.yAxis")}
              tooltipFormatter={(value) => `${value.toFixed(1)}%`}
              series={[
                {
                  dataKey: "rate2",
                  name: t("analysis.motor.legend2"),
                  stroke: "var(--brand-accent-primary)",
                  type: "monotone",
                },
                {
                  dataKey: "rate3",
                  name: t("analysis.motor.legend3"),
                  stroke: "var(--brand-accent-secondary)",
                  type: "monotone",
                },
              ]}
            />
          )}
          {usageHistory.length > 0 ? (
            <ul className="history-list">
              {usageHistory.map((meet, i) => (
                <li key={`${meet.racerId}-${meet.firstDate}-${i}`}>
                  <span className="history-date">
                    {meet.firstDate}
                    {meet.firstDate !== meet.lastDate && `〜${meet.lastDate}`}
                  </span>
                  <span translate="no" className="usage-history-player">
                    {meet.playerName?.replace(/\s+/g, "")}
                  </span>
                  <RacerGradeBadge grade={meet.grade} />
                  {meet.rate2 !== null && (
                    <span className="usage-history-rate">
                      {t("analysis.motor.rate2Header")} {meet.rate2.toFixed(1)}%
                    </span>
                  )}
                  <span className="usage-history-ranks">
                    {meet.races
                      .map((r) =>
                        r.rank !== null
                          ? t("analysis.motor.usageHistoryRank", {
                              n: r.rank,
                            })
                          : "-",
                      )
                      .join(" ")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">
              {t("analysis.motor.usageHistoryEmpty")}
            </div>
          )}
          <p className="table-note">{t("analysis.motor.usageHistoryNote")}</p>

          <h3 className="selected-motor-heading">
            {t("analysis.motor.partsHistoryHeading")}
          </h3>
          {partsHistory.length > 0 ? (
            <ul className="history-list">
              {partsHistory.map((event, i) => (
                <li key={`${event.date}-${i}`}>
                  <span className="history-date">{event.date}</span>
                  <span className="parts-history-items">
                    {event.parts && event.parts.length > 0 && (
                      <span className="parts-history-tag">
                        {event.parts.join("・")}
                      </span>
                    )}
                    {event.propellerChanged && (
                      <span className="parts-history-tag">
                        {t("analysis.motor.propellerChanged")}
                      </span>
                    )}
                  </span>
                  {event.interpretation && (
                    <span
                      className={`parts-history-badge parts-history-badge-${event.interpretation}`}
                    >
                      {t(
                        `analysis.motor.partsInterpretation.${event.interpretation}`,
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">
              {t("analysis.motor.partsHistoryEmpty")}
            </div>
          )}
          <p className="table-note">{t("analysis.motor.partsHistoryNote")}</p>
        </>
      )}

      <p className="table-note">{t("analysis.motor.note")}</p>
      <p className="table-note">{t("analysis.motor.powerIndexNote")}</p>
    </div>
  );
}

export default MotorConditionChart;
