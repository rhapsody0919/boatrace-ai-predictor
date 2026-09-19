/**
 * weatherInfo - 直前情報タブの気象カード向けラベル変換（BOA-304）
 * race_conditions.weather/wind_direction はスクレイピング側
 * （scripts/daily/update-race-info.js）で既に日本語ラベル文字列として
 * 保存されている。DB値→i18nキーの変換はtranslateTechnique（raceIndicators.jsx）
 * と同じパターン: 未知の値は変換せずそのまま返す
 */

const WEATHER_KEY_BY_LABEL = {
  晴: "sunny",
  曇り: "cloudy",
  雨: "rainy",
  雪: "snowy",
};

const WEATHER_ICON_BY_LABEL = {
  晴: "☀️",
  曇り: "☁️",
  雨: "🌧️",
  雪: "❄️",
};

const WIND_DIRECTION_KEY_BY_LABEL = {
  北: "n",
  北北東: "nne",
  北東: "ne",
  東北東: "ene",
  東: "e",
  東南東: "ese",
  南東: "se",
  南南東: "sse",
  南: "s",
  南南西: "ssw",
  南西: "sw",
  西南西: "wsw",
  西: "w",
  西北西: "wnw",
  北西: "nw",
  北北西: "nnw",
};

// DB値（日本語）を表示用に翻訳する。未知の値はそのまま返す
export function translateWeather(t, label) {
  const key = WEATHER_KEY_BY_LABEL[label];
  return key ? t(`beforeInfo.weather.${key}`, label) : label;
}

export function weatherIcon(label) {
  return WEATHER_ICON_BY_LABEL[label] ?? "🌤️";
}

export function translateWindDirection(t, label) {
  const key = WIND_DIRECTION_KEY_BY_LABEL[label];
  return key ? t(`beforeInfo.windDirection.${key}`, label) : label;
}

const JST_TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Tokyo",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// 気象の観測時刻（ISO文字列。race_conditions.weather_observed_at）を、JSTの「HH:MM」にする。
// 無い・時刻として読めない場合は null（表示しない。観測時刻の列が未適用・過去分の行でも壊れない）
export function formatObservedTime(observedAt) {
  if (!observedAt) return null;
  const date = new Date(observedAt);
  if (Number.isNaN(date.getTime())) return null;
  return JST_TIME_FORMAT.format(date);
}
