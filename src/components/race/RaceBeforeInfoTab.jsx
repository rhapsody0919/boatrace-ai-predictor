/**
 * RaceBeforeInfoTab - レース詳細ページ「直前情報」タブ（BOA-304）
 *
 * DataRaceTable（基本情報、過去実績系）から「当日更新・レース前は未確定」の
 * 4指標（展示ST・展示タイム・チルト・調整重量）を分離し、性質の異なるデータを
 * 混在させない。あわせて表示欠落だった気象情報（race_conditions）を追加し、
 * モーター調子ドリルダウン（BOA-221、部品交換/プロペラ交換履歴）への参照導線を
 * 置く。選手コメント（BOA-273未実装）・今節展示情報の内訳（BOA-266）・
 * スタート展示の並び（BOA-290）・潮汐（BOA-295）はデータが無いためスコープ外
 * （ダミー表示は作らない）。
 *
 * 行の定義・レンダリングロジックはDataRaceTableと同じraceIndicators.jsx
 * （buildBeforeInfoRows）を共有し、二重実装を避ける。
 */
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
import { buildBeforeInfoRows, toNumber } from "./raceIndicators";
import {
  translateWeather,
  translateWindDirection,
  weatherIcon,
} from "./weatherInfo";
import { trackEvent } from "../../utils/analytics";
import TermHintButton from "./TermHintButton";
import "./RaceBeforeInfoTab.css";

function RaceBeforeInfoTab({ raceId, venueCode, players, weather }) {
  const { t } = useTranslation();
  const analysis = useRaceAnalysisData(raceId, { venueCode });

  const sortedPlayers = [...(players ?? [])].sort(
    (a, b) => a.number - b.number,
  );
  if (sortedPlayers.length === 0) return null;

  const rows = buildBeforeInfoRows({
    t,
    players: sortedPlayers,
    analysis,
    pending: analysis.pending,
  });

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

  return (
    <div className="race-before-info-tab" id="race-before-info-tab">
      <p className="rbi-subtitle">{t("beforeInfo.subtitle")}</p>

      {weatherItems.length > 0 && (
        <section className="rbi-card">
          <h3 className="rbi-heading">{t("beforeInfo.weatherTitle")}</h3>
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
      </section>

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
