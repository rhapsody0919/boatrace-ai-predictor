// rank-data.js から移した、静的データだけの dataset（venue_kimarite・venue_in_by_weather。DB・環境変数・外部通信なし）
import { readFileSync } from "node:fs";
import { WIND_BINS } from "../analysis/analyze-weather-in-escape.js";
import { VENUE_SUMMARY_STATS } from "../../src/data/venueSummaryStats.js";
import { STADIUM_NAMES } from "../../src/constants/index.js";
import { venueSummaryPeriod } from "../../src/utils/venueSummary.js";

export function venueKimarite() {
  const stats = VENUE_SUMMARY_STATS;
  const period = venueSummaryPeriod();
  const slugs = ["nige", "sashi", "makuri", "makurizashi", "nuki", "megumare"];
  return {
    dataset: "venue_kimarite",
    period: {
      from: stats.from,
      to: stats.to,
      label: `${period.from}〜${period.to}`,
    },
    scope: "12m",
    unit: "venue",
    value_type: "rate",
    rows: Object.entries(stats.venues).flatMap(([code, venue]) =>
      slugs.map((slug) => ({
        name: STADIUM_NAMES[code],
        k: venue.techniques[slug].count,
        n: venue.races,
        value: venue.techniques[slug].rate,
        extra: {
          venue_code: Number(code),
          technique: slug,
          vs_national: venue.vsNational[slug] ?? null,
          national_rate: stats.national.techniques[slug].rate,
        },
      })),
    ),
    baseline: null,
    observed_at: new Date().toISOString(),
    source_sha: stats.sourceSha256,
  };
}

// 画面のランキングと同じ下限。verify で SHOW_MIN_N との一致を監視する。
const WEATHER_SHOW_MIN_N = 1000;
export function venueInByWeather() {
  const data = JSON.parse(
    readFileSync(
      new URL("../../public/data/weather-in-escape.json", import.meta.url),
      "utf8",
    ),
  );
  const bins = WIND_BINS.filter(({ key }) =>
    ["head_strong", "tail_strong"].includes(key),
  );
  const entries = Object.entries(data.venues);
  return {
    dataset: "venue_in_by_weather",
    period: {
      ...data.period,
      label: `${data.period.from.slice(0, 7).replace("-", "/")}〜${data.period.to.slice(0, 7).replace("-", "/")}`,
    },
    scope: "archive",
    unit: "venue",
    value_type: "rate",
    rows: bins.flatMap(({ key: bin, label }) =>
      entries
        .filter(([, v]) => (v.bins[bin]?.n ?? 0) >= WEATHER_SHOW_MIN_N)
        .sort((a, b) => a[1].bins[bin].diff - b[1].bins[bin].diff)
        .map(([code, v]) => ({
          name: STADIUM_NAMES[code],
          k: null, // 丸め済みの率から勝ち数を逆算しない。
          n: v.bins[bin].n,
          value: v.bins[bin].rate,
          extra: {
            venue_code: Number(code),
            bin,
            label,
            diff: v.bins[bin].diff,
            venue_rate: v.rate,
          },
        })),
    ),
    excluded: bins.map(({ key: bin }) => ({
      bin,
      names: entries
        .filter(([, v]) => (v.bins[bin]?.n ?? 0) < WEATHER_SHOW_MIN_N)
        .map(([code]) => STADIUM_NAMES[code]),
    })),
    baseline: { label: "全国の1コース1着率", value: data.overallInWinRate },
    observed_at: new Date().toISOString(),
    source_sha: data.inputHash,
  };
}
