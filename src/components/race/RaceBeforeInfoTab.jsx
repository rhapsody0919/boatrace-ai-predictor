/**
 * RaceBeforeInfoTab - レース詳細ページ「直前情報」タブ（BOA-304）
 *
 * DataRaceTable（基本情報、過去実績系）から「当日更新・レース前は未確定」の
 * 4指標（展示ST・展示タイム・チルト・調整重量）を分離し、性質の異なるデータを
 * 混在させない。あわせて表示欠落だった気象情報（race_conditions）を追加し、
 * モーター調子ドリルダウン（BOA-221、部品交換/プロペラ交換履歴）への参照導線を
 * 置く。選手コメント（BOA-273未実装）・今節展示情報の周回/周り足/直線タイム
 * 内訳（BOA-266）・スタート展示の並び（BOA-290）・潮汐（BOA-295）はデータが
 * 無いためスコープ外（ダミー表示は作らない）。
 *
 * 行の定義・レンダリングロジックはDataRaceTableと同じraceIndicators.jsx
 * （buildBeforeInfoRows）を共有し、二重実装を避ける。
 *
 * 2026-09-16追記(ユーザーによる日和再調査後のフィードバック): 除外理由の無い
 * 抜けが4つ見つかったため追加した。いずれも新規スクレイピング不要、既存データの
 * 集計のみ:
 * - 平均進入順・展示タイム1位勝率: RaceBasicInfoTab（BOA-306）と同じ
 *   getRacerScopedRaceStats(racerId)の生データ（既にactualCourse/
 *   isFastestExhibitionを追加済み）をこのタブでも取得し、basicInfoStats.jsの
 *   computeAvgEntryCourse/computeExhibitionTopRatesで集計する
 * - 今節展示情報（展示タイムのみ）: racerService.getCurrentMeetRaceEntriesと
 *   同じ節判定（groupIntoCurrentMeet）を使うgetRacerMeetExhibitionTrendBefore
 *
 * 2026-09-24（phase a FR-5 / BOA-222）に「本日の成績サマリー」をこのタブから
 * 外した。粒度（レース単位ではなく会場×当日単位）と更新タイミング（発走前に
 * 確定していくのではなく、レースが終わるたびに増える事後集計）が、このタブの
 * 他の項目とずれていたため。移設先は結果タブ（払戻の下）と会場ページで、
 * 実装は VenueDaySummaryCard。getVenueDaySummary の呼び出しもそちらへ移した
 */
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { BOAT_COLORS } from "../../utils/colors";
import { useRaceAnalysisData } from "../../hooks/useRaceAnalysisData";
import { supabaseDataService } from "../../services/supabaseDataService";
import { buildBeforeInfoRows, toNumber } from "./raceIndicators";
import {
  computeAvgEntryCourse,
  computeExhibitionTopRates,
  SMALL_SAMPLE_THRESHOLD,
} from "./basicInfoStats";
import {
  formatObservedTime,
  translateWeather,
  translateWindDirection,
  weatherIcon,
} from "./weatherInfo";
import { trackEvent } from "../../utils/analytics";
import TermHintButton from "./TermHintButton";
import RacePitReportSection from "./RacePitReportSection";
import InlineFetchError from "../InlineFetchError";
import "./RaceBeforeInfoTab.css";

function RaceBeforeInfoTab({ raceId, venueCode, players, weather, raceGrade }) {
  const { t } = useTranslation();
  const analysis = useRaceAnalysisData(raceId, { venueCode });

  const sortedPlayers = [...(players ?? [])].sort(
    (a, b) => a.number - b.number,
  );

  // 平均進入順・展示タイム1位勝率用: 基本情報タブ(BOA-306)と同じgetRacerScopedRaceStats
  // を選手ごとに取得する（withCacheで基本情報タブと同一キャッシュを共有するため、
  // 既にどちらかのタブを開いていれば再取得は発生しない）
  const [scopedStatsByRacer, setScopedStatsByRacer] = useState({});
  useEffect(() => {
    let cancelled = false;
    sortedPlayers.forEach((p) => {
      if (!p.racerId) return;
      supabaseDataService
        .getRacerScopedRaceStats(p.racerId)
        .then((data) => {
          if (!cancelled)
            setScopedStatsByRacer((prev) => ({ ...prev, [p.racerId]: data }));
        })
        .catch((err) => {
          // 取得失敗時にscopedStatsByRacer[p.racerId]が永久にundefinedのまま
          // 残ると「平均進入順」「展示タイム1位勝率」が読み込み中のまま固まる
          // （RaceBasicInfoTab.jsxの同種の指摘と同じ問題、2026-09-16修正）
          console.error("選手出走履歴取得エラー:", err?.message ?? String(err));
          if (!cancelled)
            setScopedStatsByRacer((prev) => ({ ...prev, [p.racerId]: [] }));
        });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceId]);

  // 今節展示情報用: 選手ごとに「このレースより前・同一モーターの今節」の展示タイム推移を取得する
  const [meetTrendByRacer, setMeetTrendByRacer] = useState({});
  useEffect(() => {
    let cancelled = false;
    sortedPlayers.forEach((p) => {
      if (!p.racerId || !p.motorNumber || !raceId) return;
      supabaseDataService
        .getRacerMeetExhibitionTrendBefore(p.racerId, p.motorNumber, raceId)
        .then((data) => {
          if (!cancelled)
            setMeetTrendByRacer((prev) => ({ ...prev, [p.racerId]: data }));
        })
        .catch((err) => {
          // catchしないとmeetTrendByRacer[p.racerId]がundefinedのまま残り、
          // 今節展示情報のセルがスケルトンのまま固まる（上のscopedStatsと同じ扱い）
          console.error("今節展示情報取得エラー:", err?.message ?? String(err));
          if (!cancelled)
            setMeetTrendByRacer((prev) => ({ ...prev, [p.racerId]: [] }));
        });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceId]);

  if (sortedPlayers.length === 0) return null;

  const smallSampleClass = (n) =>
    n !== null && n > 0 && n < SMALL_SAMPLE_THRESHOLD
      ? "drt-n-small-sample"
      : "";

  const extraRows = [
    {
      key: "avgEntryCourse",
      label: t("beforeInfo.rowAvgEntryCourse"),
      shortLabel: t("beforeInfo.rowAvgEntryCourseShort"),
      tab: null,
      best: null,
      render: (p) => {
        if (!p.racerId) return "—";
        const state = scopedStatsByRacer[p.racerId];
        if (state === undefined)
          return <span className="drt-skeleton" aria-hidden="true" />;
        const { n, avgCourse } = computeAvgEntryCourse(state ?? []);
        if (avgCourse === null) return "—";
        return (
          <span className="drt-value">
            {avgCourse.toFixed(2)}
            <span className={`drt-sub ${smallSampleClass(n)}`}>
              {t("beforeInfo.sampleCount", { n })}
            </span>
          </span>
        );
      },
    },
    {
      key: "exhibitionTopRate",
      label: t("beforeInfo.rowExhibitionTopRate"),
      shortLabel: t("beforeInfo.rowExhibitionTopRateShort"),
      tab: null,
      best: null,
      render: (p) => {
        if (!p.racerId) return "—";
        const state = scopedStatsByRacer[p.racerId];
        if (state === undefined)
          return <span className="drt-skeleton" aria-hidden="true" />;
        const rates = computeExhibitionTopRates(state ?? []);
        if (rates.n === 0)
          return (
            <span className="drt-sub">
              {t("beforeInfo.noFastestExhibition")}
            </span>
          );
        return (
          <span className="drt-value">
            <span className="drt-sub">
              {t("beforeInfo.winRateAbbrev")} {rates.winRate.toFixed(0)}%
            </span>
            <span className="drt-sub">
              {t("beforeInfo.top2RateAbbrev")} {rates.top2Rate.toFixed(0)}%
            </span>
            <span className="drt-sub">
              {t("beforeInfo.top3RateAbbrev")} {rates.top3Rate.toFixed(0)}%
            </span>
            <span className={`drt-sub ${smallSampleClass(rates.n)}`}>
              {t("beforeInfo.sampleCount", { n: rates.n })}
            </span>
          </span>
        );
      },
    },
    {
      key: "meetExhibitionTrend",
      label: t("beforeInfo.rowMeetExhibition"),
      shortLabel: t("beforeInfo.rowMeetExhibitionShort"),
      tab: null,
      best: null,
      render: (p) => {
        if (!p.racerId || !p.motorNumber) return "—";
        const state = meetTrendByRacer[p.racerId];
        if (state === undefined)
          return <span className="drt-skeleton" aria-hidden="true" />;
        const trend = (state ?? []).filter((e) => e.exhibitionTime !== null);
        if (trend.length === 0)
          return (
            <span className="drt-sub">{t("dataTable.prevResultNoRace")}</span>
          );
        const prev = trend[trend.length - 1].exhibitionTime;
        const avg =
          trend.reduce((sum, e) => sum + e.exhibitionTime, 0) / trend.length;
        return (
          <span className="drt-value">
            <span className="drt-sub">
              {t("beforeInfo.prevAbbrev")} {prev.toFixed(2)}
            </span>
            <span className="drt-sub">
              {t("beforeInfo.avgAbbrev")} {avg.toFixed(2)}
            </span>
          </span>
        );
      },
    },
  ];

  const rows = [
    ...buildBeforeInfoRows({
      t,
      players: sortedPlayers,
      analysis,
      pending: analysis.pending,
    }),
    ...extraRows,
  ];

  const deepLink = (tab) =>
    venueCode && raceId
      ? `/winning-technique?venue_code=${venueCode}&race_id=${raceId}&tab=${tab}`
      : `/winning-technique?tab=${tab}`;

  const onLinkClick = (tab) => () =>
    trackEvent("deep_link_click", {
      tab,
      link_source: "race_before_info_tab",
    });

  const cellClass = (boat, best) =>
    `drt-cell ${best !== null && boat === best ? "drt-best" : ""}`;

  // 展示タイム棒グラフ用データ（艇番順、未取得艇はnullのままバーを描かない）
  const exhibitionByBoat = new Map(
    (analysis.exhibitionTime ?? []).map((r) => [r.boat_number, r]),
  );
  const exhibitionChartData = sortedPlayers.map((p) => {
    const row = exhibitionByBoat.get(p.number);
    return {
      boat: p.number,
      name: t("analysis.boatN", { n: p.number }),
      time: row?.exhibition_time != null ? toNumber(row.exhibition_time) : null,
    };
  });
  const hasExhibitionChartData = exhibitionChartData.some(
    (d) => d.time !== null,
  );

  const weatherItems = weather
    ? [
        weather.weather && {
          key: "weather",
          icon: weatherIcon(weather.weather),
          value: translateWeather(t, weather.weather),
          label: t("beforeInfo.weatherLabel"),
        },
        weather.temperature !== null && {
          key: "temperature",
          icon: "🌡️",
          value: `${weather.temperature.toFixed(1)}℃`,
          label: t("beforeInfo.temperatureLabel"),
        },
        (weather.windSpeed !== null || weather.windDirection) && {
          key: "wind",
          icon: "💨",
          value: [
            weather.windSpeed !== null
              ? `${weather.windSpeed.toFixed(1)}m`
              : null,
            weather.windDirection
              ? translateWindDirection(t, weather.windDirection)
              : null,
          ]
            .filter(Boolean)
            .join(" / "),
          label: t("beforeInfo.windLabel"),
        },
        weather.waterTemperature !== null && {
          key: "waterTemperature",
          icon: "🌊",
          value: `${weather.waterTemperature.toFixed(1)}℃`,
          label: t("beforeInfo.waterTemperatureLabel"),
        },
        weather.waveHeight !== null && {
          key: "waveHeight",
          icon: "🌀",
          value: `${weather.waveHeight}cm`,
          label: t("beforeInfo.waveHeightLabel"),
        },
      ].filter(Boolean)
    : [];

  // 気象の観測時刻（あれば「10:34現在」を見出しに添える。無ければ従来どおり何も出さない）
  const weatherObservedTime = formatObservedTime(weather?.observedAt);

  return (
    <div className="race-before-info-tab" id="race-before-info-tab">
      <p className="rbi-subtitle">{t("beforeInfo.subtitle")}</p>

      {/* 取得失敗を「—」の羅列（データなし）に化けさせない（BOA-359） */}
      {analysis.hasFailure && <InlineFetchError onRetry={analysis.reload} />}

      {weatherItems.length > 0 && (
        <section className="rbi-card">
          <h3 className="rbi-heading">
            {t("beforeInfo.weatherTitle")}
            {weatherObservedTime && (
              <span className="rbi-observed-at" data-testid="rbi-observed-at">
                {t("beforeInfo.weatherObservedAt", {
                  time: weatherObservedTime,
                })}
              </span>
            )}
          </h3>
          <div className="rbi-weather-grid">
            {weatherItems.map((item) => (
              <div className="rbi-weather-item" key={item.key}>
                <span className="rbi-weather-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="rbi-weather-value">{item.value}</span>
                <span className="rbi-weather-label">{item.label}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rbi-card">
        <h3 className="rbi-heading">
          {t("beforeInfo.exhibitionChartTitle")}
          {analysis.loading && (
            <span className="drt-loading-chip">{t("dataTable.loading")}</span>
          )}
        </h3>
        {hasExhibitionChartData ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={exhibitionChartData}
              margin={{ top: 5, right: 16, left: 0, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis
                domain={["dataMin - 0.1", "dataMax + 0.1"]}
                tick={{ fontSize: 11 }}
                // dataMin/dataMax指定はrecharts内部の浮動小数点演算により
                // 6.630000000000001のような誤差が目盛りに出るため、表示直前に丸める
                tickFormatter={(value) => value.toFixed(2)}
              />
              <Tooltip
                formatter={(value) =>
                  value != null
                    ? `${value.toFixed(2)}${t("beforeInfo.secondsUnit")}`
                    : "—"
                }
              />
              <Bar dataKey="time" radius={[4, 4, 0, 0]}>
                {exhibitionChartData.map((d) => (
                  <Cell
                    key={d.boat}
                    fill={
                      BOAT_COLORS[d.boat]?.bg || "var(--brand-accent-primary)"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="rbi-empty">{t("beforeInfo.exhibitionChartEmpty")}</p>
        )}
      </section>

      <section className="rbi-card">
        <h3 className="rbi-heading">{t("beforeInfo.detailTableTitle")}</h3>
        <div className="drt-table-wrapper">
          <table className="drt-table">
            <thead>
              <tr>
                <th className="drt-label-th"></th>
                {sortedPlayers.map((p) => {
                  const color = BOAT_COLORS[p.number] || {};
                  return (
                    <th
                      key={p.number}
                      className="drt-boat-th"
                      style={{ background: color.bg, color: color.text }}
                    >
                      {p.number}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className="drt-label-cell">
                    {row.tab ? (
                      <Link
                        to={deepLink(row.tab)}
                        className="drt-label-link"
                        onClick={onLinkClick(row.tab)}
                      >
                        <span className="drt-label-full">{row.label}</span>
                        <span className="drt-label-short">
                          {row.shortLabel}
                        </span>
                        <span className="drt-link-arrow">›</span>
                      </Link>
                    ) : (
                      <>
                        <span className="drt-label-full">{row.label}</span>
                        <span className="drt-label-short">
                          {row.shortLabel}
                        </span>
                      </>
                    )}
                    <TermHintButton termKey={row.key} />
                  </td>
                  {sortedPlayers.map((p) => (
                    <td
                      key={p.number}
                      className={cellClass(p.number, row.best)}
                    >
                      {row.render(p)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="rbi-note">💡 {t("beforeInfo.detailTableNote")}</p>
      </section>

      <RacePitReportSection
        raceId={raceId}
        raceGrade={raceGrade}
        players={sortedPlayers}
      />

      <Link
        to={deepLink("motor")}
        className="rbi-motor-link"
        onClick={onLinkClick("motor")}
      >
        🔧 {t("beforeInfo.motorHistoryLink")} →
      </Link>
    </div>
  );
}

export default RaceBeforeInfoTab;
