/**
 * RaceBeforeInfoTab の気象情報カード。
 * RaceBeforeInfoTab.jsx から移しただけ（出力は変えない）。
 */
import { useTranslation } from "react-i18next";
import {
  formatObservedTime,
  translateWeather,
  translateWindDirection,
  weatherIcon,
} from "./weatherInfo";

function windValue(t, weather, venueCode) {
  return [
    weather.windSpeed !== null ? `${weather.windSpeed.toFixed(1)}m` : null,
    weather.windDirection
      ? translateWindDirection(t, weather.windDirection, venueCode)
      : null,
  ]
    .filter(Boolean)
    .join(" / ");
}

function buildWeatherItems(t, weather, venueCode) {
  if (!weather) return [];
  return [
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
      value: windValue(t, weather, venueCode),
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
  ].filter(Boolean);
}

export default function RaceBeforeInfoTabWeather({ weather, venueCode }) {
  const { t } = useTranslation();
  const weatherItems = buildWeatherItems(t, weather, venueCode);
  // 気象の観測時刻（あれば「10:34現在」を見出しに添える。無ければ従来どおり何も出さない）
  const weatherObservedTime = formatObservedTime(weather?.observedAt);
  if (weatherItems.length === 0) return null;
  return (
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
  );
}
