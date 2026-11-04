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
 *   node --env-file=.env.local scripts/sns/rank-data.js --dataset=motor_power --venue=<1-24> [--to=YYYY-MM-DD]
 *   node --env-file=.env.local scripts/sns/rank-data.js --dataset=racer_page --venue=<1-24> [--date=YYYY-MM-DD（出走表の日、既定は今日）]
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
import { readAll, readAllIn, monthSlices } from "./rank-data-db.js";
import {
  computeVenueMotorPowerIndexes,
  motorWindowFrom,
} from "../../src/utils/motorPowerIndex.js";
import { currentMotorGenerationStart } from "../../src/utils/motorGeneration.js";
import { formatPowerIndex } from "../../src/utils/smallSampleRate.js";
import { SMALL_SAMPLE_THRESHOLD } from "../../src/components/race/basicInfoStats.js";
import { buildRacerRaceHistoryRows } from "../../src/services/racerRaceHistoryRows.js";
import { splitRacerName } from "../../src/utils/racerName.js";
import {
  aggregateRacerVenueBoatStats,
  racerHistoryCutoff,
} from "../../src/utils/racerVenueBoatStats.js";

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

// ── DB を読む dataset ─────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** JST の今日 */
const jstToday = () =>
  new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const slash = (d) => d.replaceAll("-", "/");
const round = (v, digits) =>
  v === null || v === undefined ? null : Number(v.toFixed(digits));

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
    Promise.all(
      slices.map((s) =>
        readAll("races", "race_id, venue_code", ["race_id"], (q) =>
          q.gte("race_date", s.from).lte("race_date", s.to),
        ),
      ),
    ),
    Promise.all(
      slices.map((s) =>
        readAll(
          "race_results",
          "race_id, rank1, payout_trio, popularity_trio, winning_technique, race_status",
          ["race_id"],
          (q) =>
            q
              .gte("race_id", s.from)
              .lt("race_id", addDaysToDateString(s.to, 1)),
        ),
      ),
    ),
  ]);
  const venueByRaceId = new Map(
    raceParts.flat().map((r) => [r.race_id, r.venue_code]),
  );
  return { results: resultParts.flat(), venueByRaceId };
}

/** 期間の中で結果のあった最初と最後の日（ラベルを実際に数えた日に合わせる） */
function observedSpan(results, venueByRaceId) {
  const days = results
    .filter((r) => venueByRaceId.has(r.race_id))
    .map((r) => r.race_id.slice(0, 10))
    .sort();
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
  const national = tallyVenuePayouts(results, (id) =>
    venueByRaceId.has(id) ? 0 : null,
  ).get(0);
  const { payoutVenues } = venuePayoutRates(byVenue, VENUE_RANKING_MIN_RACES);
  const nationalAvg = national.payoutSum / national.payoutCount;
  const nationalHigh = (national.manshuCount / national.payoutCount) * 100;
  const sorted = [...payoutVenues].sort((a, b) => a.venue_code - b.venue_code);
  return {
    dataset: "venue_payout",
    period: {
      from: span.from,
      to: span.to,
      label: `${slash(span.from)}〜${slash(span.to)}`,
    },
    scope: from || to ? "custom" : "12m",
    unit: "venue",
    value_type: "mean",
    rows: [
      ...sorted.map((v) => ({
        name: STADIUM_NAMES[v.venue_code],
        k: null,
        n: v.payout_count,
        value: Math.round(v.avg_payout),
        extra: {
          venue_code: v.venue_code,
          metric: "avg_payout",
          unit: "円",
          race_count: v.race_count,
          national_value: Math.round(nationalAvg),
        },
      })),
      ...sorted.map((v) => ({
        name: STADIUM_NAMES[v.venue_code],
        k: v.manshu_count,
        n: v.payout_count,
        value: round(v.manshu_rate, 1),
        extra: {
          venue_code: v.venue_code,
          metric: "high_payout_rate",
          unit: "%",
          threshold_yen: HIGH_PAYOUT_YEN,
          race_count: v.race_count,
          national_value: round(nationalHigh, 1),
        },
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
  if (until < POPULARITY_COMPLETE_FROM)
    throw new Error(
      `--to は ${POPULARITY_COMPLETE_FROM} 以降（3連単の人気がそろう日から）`,
    );
  const { results, venueByRaceId } = await readVenueResults(
    POPULARITY_COMPLETE_FROM,
    until,
  );
  const span = observedSpan(results, venueByRaceId);
  const byVenue = tallyVenuePayouts(results, (id) => venueByRaceId.get(id));
  const national = tallyVenuePayouts(results, (id) =>
    venueByRaceId.has(id) ? 0 : null,
  ).get(0);
  const rows = [...byVenue.values()]
    .filter(
      (v) => v.raceCount >= VENUE_RANKING_MIN_RACES && v.popularityCount > 0,
    )
    .sort((a, b) => a.venue_code - b.venue_code)
    .map((v) => ({
      name: STADIUM_NAMES[v.venue_code],
      k: v.favoriteCount,
      n: v.popularityCount,
      value: round((v.favoriteCount / v.popularityCount) * 100, 1),
      extra: {
        venue_code: v.venue_code,
        metric: "favorite_rate",
        race_count: v.raceCount,
      },
    }));
  return {
    dataset: "venue_favorite",
    period: {
      from: span.from,
      to: span.to,
      label: `${slash(span.from)}〜${slash(span.to)}`,
    },
    scope: to ? "custom" : "since_2026_10",
    unit: "venue",
    value_type: "rate",
    rows,
    baseline: {
      label: "全国",
      value: round(
        (national.favoriteCount / national.popularityCount) * 100,
        1,
      ),
    },
    observed_at: new Date().toISOString(),
    source_sha: null,
  };
}

/** 機力指数の期間（画面の既定、MotorConditionChart の「過去90日」） */
const MOTOR_POWER_DAYS = 90;

/**
 * 会場の全機の機力指数（画面のモーター調子・モータ情報と同じ式・同じ期間）。
 * 期間は max(現行モーターの使用開始日, 基準日−90日)。基準日は今日（JST、画面と同じ。当日の確定レースも入る）。
 * --to=D を渡すと D の終わりまで（画面で D の翌日の最初のレースを開いたときと同じ: 基準日 D+1、race_id < D+1）。
 * 番付に載せるのは、画面が評価の言葉を出す走数（SMALL_SAMPLE_THRESHOLD=6、powerIndexTone の small の線）以上の機。
 * それ未満の機は excluded に出す
 */
async function motorPower({ venue, to }) {
  const venueCode = Number(venue);
  if (!Number.isInteger(venueCode) || venueCode < 1 || venueCode > 24) {
    throw new Error("--venue=<1〜24> を指定してください");
  }
  const baseDate = to ? addDaysToDateString(to, 1) : jstToday();
  const before = to ? baseDate : null; // race_id はこの文字列より前（画面の beforeRaceId と同じ比べ方）
  const starts = await readAll(
    "venue_motor_start_dates",
    "start_date",
    ["start_date"],
    (q) => q.eq("venue_code", venueCode),
  );
  const window = motorWindowFrom(
    currentMotorGenerationStart(starts),
    MOTOR_POWER_DAYS,
    baseDate,
  );
  if (window.since === null) {
    throw new Error(
      `${STADIUM_NAMES[venueCode]} はモーターの使用開始日が分からない（画面も機力指数を出さない）`,
    );
  }
  // 画面の getRacesForVenueSince と同じ: 会場・race_date が since 以降（上限があれば race_id < 上限）
  const races = (
    await readAll(
      "races",
      "race_id, race_date",
      ["race_date", "race_id"],
      (q) =>
        q
          .eq("venue_code", venueCode)
          .gte("race_date", window.since)
          .lte("race_date", before ?? "9999-12-31"),
    )
  ).filter((r) => before === null || r.race_id < before);
  const raceIds = races.map((r) => r.race_id);
  const [entries, results] = await Promise.all([
    readAllIn(
      "race_entries",
      "race_id, boat_number, motor_number, global_2rate",
      "race_id",
      raceIds,
      ["race_id", "boat_number"],
    ),
    readAllIn(
      "race_results",
      "race_id, rank1, rank2, rank3",
      "race_id",
      raceIds,
      ["race_id"],
    ),
  ]);
  const resultByRaceId = new Map(results.map((r) => [r.race_id, r]));
  const indexes = computeVenueMotorPowerIndexes(entries, resultByRaceId);
  const shown = indexes.filter((m) => m.sample_count >= SMALL_SAMPLE_THRESHOLD);
  const lastDay =
    races
      .filter((r) => resultByRaceId.has(r.race_id))
      .map((r) => r.race_date)
      .sort()
      .at(-1) ?? null;
  const name = STADIUM_NAMES[venueCode];
  const toLabel = lastDay ? slash(lastDay) : "";
  return {
    dataset: "motor_power",
    period: {
      from: window.since,
      to: lastDay,
      label: window.clippedByGeneration
        ? `${slash(window.since)}（モーターの使用開始）〜${toLabel}`
        : `${slash(window.since)}〜${toLabel}（過去${MOTOR_POWER_DAYS}日）`,
    },
    scope: "90d",
    unit: "motor",
    value_type: "mean",
    rows: [...shown]
      .sort(
        (a, b) =>
          b.power_index - a.power_index || a.motor_number - b.motor_number,
      )
      .map((m) => ({
        name: `${name}${m.motor_number}号機`,
        k: null,
        n: m.sample_count,
        value: round(m.power_index, 1),
        extra: {
          venue_code: venueCode,
          motor_number: m.motor_number,
          label: formatPowerIndex(m.power_index),
          actual_rate2: round(m.actual_rate2, 1),
          avg_baseline_rate2: round(m.avg_baseline_rate2, 1),
          clipped_by_generation: window.clippedByGeneration,
          generation_start: window.generationStart,
        },
      })),
    excluded: indexes
      .filter((m) => m.sample_count < SMALL_SAMPLE_THRESHOLD)
      .map((m) => ({ motor_number: m.motor_number, n: m.sample_count })),
    min_n: SMALL_SAMPLE_THRESHOLD,
    baseline: { label: "選手の実力どおり", value: 0 },
    observed_at: new Date().toISOString(),
    source_sha: null,
  };
}

/**
 * 番付の行に載せる最少の走数。目安（根拠なし）: プロジェクトの小標本の線 SMALL_SAMPLE_THRESHOLD（=6、BOA-306）を
 * 借りた。選手ページの会場×枠番のカードには線が無い（1走でも率を出す）。関門にはしない
 */
const RACER_PAGE_MIN_RUNS = SMALL_SAMPLE_THRESHOLD;

/**
 * 選手ページ（GS00）の会場×1号艇の絞り込み（「会場」と「1号艇」を選んだ表示）と同じ値を、その日の出走表の選手ごとに出す。
 * - 1号艇の逃げ率: 決まり手の「逃げ」の回数 ÷ 1着率のカードの出走数（tech["逃げ"] / n）。枠番の基準（ページと同じ。BOA-257）
 * - 1号艇の平均ST: 同じ絞り込みの平均STのカード（本番ST、F を除く）
 * - 当地勝率: 出走表の公式の当地勝率（race_entries.local_win_rate。ページの「全国勝率・当地勝率の推移」の当地の線と同じ列）
 * 期間はページと同じ（見た時刻から730日、racerHistoryCutoff）。集計は aggregateRacerVenueBoatStats（ページと同じ関数）。
 * 選手の履歴はその会場の走だけをまとめて読む（集計は会場で絞るので結果は同じ。1人ずつ読むと1場で数百の要求になる）
 */
async function racerPage({ venue, date }) {
  const venueCode = Number(venue);
  if (!Number.isInteger(venueCode) || venueCode < 1 || venueCode > 24) {
    throw new Error("--venue=<1〜24> を指定してください");
  }
  const day = date ?? jstToday();
  const vv = String(venueCode).padStart(2, "0");
  const card = await readAll(
    "race_entries",
    "race_id, boat_number, racer_id, player_name, local_win_rate",
    ["race_id", "boat_number"],
    (q) => q.like("race_id", `${day}-${vv}-__`),
  );
  const racers = new Map();
  for (const e of card) {
    if (e.racer_id != null && !racers.has(e.racer_id))
      racers.set(e.racer_id, e);
  }
  if (racers.size === 0)
    throw new Error(`${day} の${STADIUM_NAMES[venueCode]}の出走表が無い`);
  const racerIds = [...racers.keys()];
  const since = racerHistoryCutoff();
  const [grades, entries] = await Promise.all([
    readAll("racer_grade_cache", "data", ["key"], (q) =>
      q.eq("key", "latest_grades"),
    ),
    readAllIn(
      "race_entries",
      "race_id, boat_number, racer_id",
      "racer_id",
      racerIds,
      ["race_id", "boat_number"],
      (q) => q.gte("race_id", since).like("race_id", `__________-${vv}-__`),
    ),
  ]);
  const gradeOf = new Map(
    (grades[0]?.data ?? []).map((g) => [g.racer_id, g.grade ?? null]),
  );
  const raceIds = [...new Set(entries.map((e) => e.race_id))];
  // 選手ページの getRacerRaceHistory と同じ表・列
  const [raceRows, resultRows, exhibitionRows, conditionRows, stRows] =
    await Promise.all([
      readAllIn(
        "races",
        "race_id, venue_code, race_grade",
        "race_id",
        raceIds,
        ["race_id"],
      ),
      readAllIn(
        "race_results",
        "race_id, rank1, rank2, rank3, rank4, rank5, rank6, winning_technique, payout_win, payout_place_1, payout_place_2, race_status, actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6",
        "race_id",
        raceIds,
        ["race_id"],
      ),
      readAllIn(
        "exhibition_data",
        "race_id, boat_number, exhibition_time",
        "race_id",
        raceIds,
        ["race_id", "boat_number"],
      ),
      readAllIn(
        "race_conditions",
        "race_id, race_stage, race_title, weather, wind_speed, wave_height",
        "race_id",
        raceIds,
        ["race_id"],
      ),
      readAllIn(
        "race_start_timings",
        "race_id, boat_number, start_timing, is_flying, finish_mark, entry_course",
        "race_id",
        raceIds,
        ["race_id", "boat_number"],
      ),
    ]);
  const entriesOf = new Map();
  for (const e of entries) {
    if (!entriesOf.has(e.racer_id)) entriesOf.set(e.racer_id, []);
    entriesOf.get(e.racer_id).push(e);
  }
  const stats = racerIds.map((racerId) => {
    const history = buildRacerRaceHistoryRows({
      entries: entriesOf.get(racerId) ?? [],
      raceRows,
      resultRows,
      exhibitionRows,
      conditionRows,
      stRows,
    });
    const boat1 = aggregateRacerVenueBoatStats(
      history,
      venueCode,
      1,
      null,
      null,
    );
    const card1 = racers.get(racerId);
    return {
      racerId,
      // 選手ページの見出しと同じく空白を詰める（出走表の名前は全角スペースで固定幅に詰めてある）
      name: splitRacerName(card1.player_name).join(""),
      grade: gradeOf.get(racerId) ?? null,
      localWinRate: card1.local_win_rate ?? null,
      boat1,
    };
  });
  const base = (s) => ({
    racer_id: s.racerId,
    class: s.grade,
    venue_code: venueCode,
  });
  const rows = [
    ...stats
      .filter((s) => s.boat1.n >= RACER_PAGE_MIN_RUNS)
      .map((s) => ({
        name: s.name,
        k: s.boat1.tech["逃げ"] ?? 0,
        n: s.boat1.n,
        value: round(((s.boat1.tech["逃げ"] ?? 0) / s.boat1.n) * 100, 1),
        extra: {
          ...base(s),
          metric: "nige_rate_boat1",
          unit: "%",
          wins: s.boat1.win,
        },
      })),
    ...stats
      .filter(
        (s) => s.boat1.avgSt !== null && s.boat1.stN >= RACER_PAGE_MIN_RUNS,
      )
      .map((s) => ({
        name: s.name,
        k: null,
        n: s.boat1.stN,
        value: round(s.boat1.avgSt, 3),
        extra: { ...base(s), metric: "avg_st_boat1", unit: "秒" },
      })),
    ...stats
      .filter((s) => s.localWinRate !== null)
      .map((s) => ({
        name: s.name,
        k: null,
        n: null,
        value: Number(s.localWinRate),
        extra: {
          ...base(s),
          metric: "local_win_rate",
          unit: "点",
          source: "出走表の公式の当地勝率",
        },
      })),
  ];
  return {
    dataset: "racer_page",
    period: {
      from: since,
      to: day,
      label: `${slash(since)}〜${slash(day)}（選手ページと同じ最大過去2年）`,
    },
    scope: "today",
    unit: "racer",
    value_type: "rate",
    rows,
    excluded: stats
      .filter((s) => s.boat1.n < RACER_PAGE_MIN_RUNS)
      .map((s) => ({ racer_id: s.racerId, name: s.name, n: s.boat1.n })),
    min_n: RACER_PAGE_MIN_RUNS,
    baseline: null,
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
  ["motor_power", { build: motorPower, options: ["venue", "to"] }],
  ["racer_page", { build: racerPage, options: ["venue", "date"] }],
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
      if (dataset !== undefined)
        throw new Error("--dataset は1つだけ指定してください");
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
      throw new Error(
        `未対応の引数: --${key}（${dataset} が受け付けるのは ${spec.options.length ? spec.options.map((o) => `--${o}`).join("・") : "--dataset だけ"}）`,
      );
    }
    if (["from", "to", "date"].includes(key) && !DATE_RE.test(value))
      throw new Error(`--${key} は YYYY-MM-DD`);
  }
  if (options.from && options.to && options.from > options.to)
    throw new Error("--from は --to 以前");
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
