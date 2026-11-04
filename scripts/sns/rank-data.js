#!/usr/bin/env node
/**
 * 龍神ボート番付の元データ。stdout に JSON を1つ出す（hq drafts/rank-series-expand-20261103.md §3 の形）。
 *
 * 静的データだけの dataset（DB・環境変数・外部通信なし。--to は未対応）:
 *   node scripts/sns/rank-data.js --dataset=venue_kimarite
 *   node scripts/sns/rank-data.js --dataset=venue_in_by_weather
 * DB を読む dataset（読むだけ。画面と同じ匿名キーを .env.local から渡す）:
 *   node --env-file=.env.local scripts/sns/rank-data.js --dataset=venue_payout [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]
 *   node --env-file=.env.local scripts/sns/rank-data.js --dataset=venue_favorite [--to=YYYY-MM-DD]
 * 集計は画面と同じ純関数を使う（新しい集計の式を作らない）。
 */
import { readFileSync } from "node:fs";
import { WIND_BINS } from "../analysis/analyze-weather-in-escape.js";
import { VENUE_SUMMARY_STATS } from "../../src/data/venueSummaryStats.js";
import { STADIUM_NAMES } from "../../src/constants/index.js";
import { venueSummaryPeriod } from "../../src/utils/venueSummary.js";
import {
  HIGH_PAYOUT_YEN,
  tallyVenuePayouts,
  venuePayoutRates,
} from "../../src/utils/venuePayoutStats.js";
import { addDaysToDateString } from "../lib/dateUtils.js";
import { readAll, monthSlices } from "./rank-data-db.js";

function venueKimarite() {
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
function venueInByWeather() {
  const data = JSON.parse(readFileSync(new URL("../../public/data/weather-in-escape.json", import.meta.url), "utf8"));
  const bins = WIND_BINS.filter(({ key }) => ["head_strong", "tail_strong"].includes(key));
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
    rows: bins.flatMap(({ key: bin, label }) => entries
      .filter(([, v]) => (v.bins[bin]?.n ?? 0) >= WEATHER_SHOW_MIN_N)
      .sort((a, b) => a[1].bins[bin].diff - b[1].bins[bin].diff)
      .map(([code, v]) => ({
        name: STADIUM_NAMES[code],
        k: null, // 丸め済みの率から勝ち数を逆算しない。
        n: v.bins[bin].n,
        value: v.bins[bin].rate,
        extra: {
          venue_code: Number(code), bin, label,
          diff: v.bins[bin].diff, venue_rate: v.rate,
        },
      }))),
    excluded: bins.map(({ key: bin }) => ({
      bin,
      names: entries.filter(([, v]) => (v.bins[bin]?.n ?? 0) < WEATHER_SHOW_MIN_N)
        .map(([code]) => STADIUM_NAMES[code]),
    })),
    baseline: { label: "全国の1コース1着率", value: data.overallInWinRate },
    observed_at: new Date().toISOString(),
    source_sha: data.inputHash,
  };
}

// ── DB を読む dataset ─────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** JST の今日 */
const jstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const slash = (d) => d.replaceAll("-", "/");
const round = (v, digits) => (v === null || v === undefined ? null : Number(v.toFixed(digits)));

/**
 * 3連単の人気（race_results.popularity_trio）が全会場でそろう最初の日。
 * 本番の月ごとの充足（2026-11-04 読み取りで実測）: 2026-08 は 139/4,918、09 は 3,820/4,594、
 * 10 は 4,729/4,729。それより前は一部のレースにしか無いので、1番人気の率は 2026-10-01 から数える
 */
export const POPULARITY_COMPLETE_FROM = "2026-10-01";
/** 画面の会場ランキング（getTodaysVenueRanking の既定）と同じ、会場を載せる最少のレース数 */
const VENUE_RANKING_MIN_RACES = 3;

/**
 * 期間のレースの会場（races.venue_code）と結果（race_results）を読む。画面の会場ランキングと同じ表・列
 * （画面は popularity_trio を読まない。番付の1番人気だけが使う）
 */
async function readVenueResults(from, to) {
  const slices = monthSlices(from, to);
  const [raceParts, resultParts] = await Promise.all([
    Promise.all(slices.map((s) => readAll("races", "race_id, venue_code", ["race_id"],
      (q) => q.gte("race_date", s.from).lte("race_date", s.to)))),
    Promise.all(slices.map((s) => readAll(
      "race_results",
      "race_id, rank1, payout_trio, popularity_trio, winning_technique, race_status",
      ["race_id"],
      (q) => q.gte("race_id", s.from).lt("race_id", addDaysToDateString(s.to, 1)),
    ))),
  ]);
  const venueByRaceId = new Map(raceParts.flat().map((r) => [r.race_id, r.venue_code]));
  return { results: resultParts.flat(), venueByRaceId };
}

/** 期間の中で結果のあった最初と最後の日（ラベルを実際に数えた日に合わせる） */
function observedSpan(results, venueByRaceId) {
  const days = results.filter((r) => venueByRaceId.has(r.race_id)).map((r) => r.race_id.slice(0, 10)).sort();
  if (!days.length) throw new Error("期間に結果のあるレースが無い");
  return { from: days[0], to: days[days.length - 1] };
}

/**
 * ★ 会場ごとの3連単の平均配当と、3連単1万円以上の割合（画面の会場ランキングの「固い場・荒れている場・万舟率」と同じ式）。
 * 既定の期間は、昨日（JST）までの365日。rows は metric ごと（avg_payout・high_payout_rate）に24場
 */
async function venuePayout({ from, to }) {
  const until = to ?? addDaysToDateString(jstToday(), -1);
  const since = from ?? addDaysToDateString(until, -364);
  const { results, venueByRaceId } = await readVenueResults(since, until);
  const span = observedSpan(results, venueByRaceId);
  const byVenue = tallyVenuePayouts(results, (id) => venueByRaceId.get(id));
  const national = tallyVenuePayouts(results, (id) => (venueByRaceId.has(id) ? 0 : null)).get(0);
  const { payoutVenues } = venuePayoutRates(byVenue, VENUE_RANKING_MIN_RACES);
  const nationalAvg = national.payoutSum / national.payoutCount;
  const nationalHigh = (national.manshuCount / national.payoutCount) * 100;
  const sorted = [...payoutVenues].sort((a, b) => a.venue_code - b.venue_code);
  return {
    dataset: "venue_payout",
    period: { from: span.from, to: span.to, label: `${slash(span.from)}〜${slash(span.to)}` },
    scope: from || to ? "custom" : "12m",
    unit: "venue",
    value_type: "mean",
    rows: [
      ...sorted.map((v) => ({
        name: STADIUM_NAMES[v.venue_code],
        k: null,
        n: v.payout_count,
        value: Math.round(v.avg_payout),
        extra: { venue_code: v.venue_code, metric: "avg_payout", unit: "円", race_count: v.race_count, national_value: Math.round(nationalAvg) },
      })),
      ...sorted.map((v) => ({
        name: STADIUM_NAMES[v.venue_code],
        k: v.manshu_count,
        n: v.payout_count,
        value: round(v.manshu_rate, 1),
        extra: { venue_code: v.venue_code, metric: "high_payout_rate", unit: "%", threshold_yen: HIGH_PAYOUT_YEN, race_count: v.race_count, national_value: round(nationalHigh, 1) },
      })),
    ],
    // 2つの metric を1つの dataset に入れるので、全国の値は行ごと（extra.national_value）に持つ（venue_kimarite と同じ）
    baseline: null,
    observed_at: new Date().toISOString(),
    source_sha: null,
  };
}

/**
 * ★ 会場ごとの「3連単の1番人気で決まった割合」。3連単の人気がそろう POPULARITY_COMPLETE_FROM から昨日（JST）まで。
 * 画面には無い値（画面の人気は単勝・複勝だけ）。分母は3連単の配当と人気があるレース、分子は人気が1
 */
async function venueFavorite({ to }) {
  const until = to ?? addDaysToDateString(jstToday(), -1);
  if (until < POPULARITY_COMPLETE_FROM) throw new Error(`--to は ${POPULARITY_COMPLETE_FROM} 以降（3連単の人気がそろう日から）`);
  const { results, venueByRaceId } = await readVenueResults(POPULARITY_COMPLETE_FROM, until);
  const span = observedSpan(results, venueByRaceId);
  const byVenue = tallyVenuePayouts(results, (id) => venueByRaceId.get(id));
  const national = tallyVenuePayouts(results, (id) => (venueByRaceId.has(id) ? 0 : null)).get(0);
  const rows = [...byVenue.values()]
    .filter((v) => v.raceCount >= VENUE_RANKING_MIN_RACES && v.popularityCount > 0)
    .sort((a, b) => a.venue_code - b.venue_code)
    .map((v) => ({
      name: STADIUM_NAMES[v.venue_code],
      k: v.favoriteCount,
      n: v.popularityCount,
      value: round((v.favoriteCount / v.popularityCount) * 100, 1),
      extra: { venue_code: v.venue_code, metric: "favorite_rate", race_count: v.raceCount },
    }));
  return {
    dataset: "venue_favorite",
    period: { from: span.from, to: span.to, label: `${slash(span.from)}〜${slash(span.to)}` },
    scope: to ? "custom" : "since_2026_10",
    unit: "venue",
    value_type: "rate",
    rows,
    baseline: { label: "全国", value: round((national.favoriteCount / national.popularityCount) * 100, 1) },
    observed_at: new Date().toISOString(),
    source_sha: null,
  };
}

// options: その dataset が受け付ける引数。静的データの dataset は引数を受け付けない（期間は画面のデータと同じ）
const datasets = new Map([
  ["venue_kimarite", { build: venueKimarite, options: [] }],
  ["venue_in_by_weather", { build: venueInByWeather, options: [] }],
  ["venue_payout", { build: venuePayout, options: ["from", "to"] }],
  ["venue_favorite", { build: venueFavorite, options: ["to"] }],
]);

/** @returns {{ dataset: string, options: Record<string, string> }} */
export function parseArgs(argv) {
  let dataset;
  const options = {};
  for (const arg of argv) {
    const m = /^--([a-z]+)=(.*)$/.exec(arg);
    if (!m) throw new Error(`未対応の引数: ${arg}`);
    const [, key, value] = m;
    if (key === "dataset") {
      if (dataset !== undefined) throw new Error("--dataset は1つだけ指定してください");
      dataset = value;
      continue;
    }
    if (key in options) throw new Error(`--${key} は1つだけ指定してください`);
    options[key] = value;
  }
  if (!dataset) throw new Error("--dataset=<id> を指定してください");
  const spec = datasets.get(dataset);
  if (!spec) throw new Error(`未対応の dataset: ${dataset}`);
  for (const [key, value] of Object.entries(options)) {
    if (!spec.options.includes(key)) {
      throw new Error(`未対応の引数: --${key}（${dataset} が受け付けるのは ${spec.options.length ? spec.options.map((o) => `--${o}`).join("・") : "--dataset だけ"}）`);
    }
    if ((key === "from" || key === "to") && !DATE_RE.test(value)) throw new Error(`--${key} は YYYY-MM-DD`);
  }
  if (options.from && options.to && options.from > options.to) throw new Error("--from は --to 以前");
  return { dataset, options };
}

async function main() {
  const { dataset, options } = parseArgs(process.argv.slice(2));
  const out = await datasets.get(dataset).build(options);
  console.log(JSON.stringify(out));
}

main().catch((error) => {
  console.error(`rank-data: ${error.message}`);
  process.exitCode = 1;
});
