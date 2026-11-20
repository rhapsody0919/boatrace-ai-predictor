// rank-data.js から移した、会場の dataset（venue_payout・venue_favorite）と、その読み取り（会場・結果）
import { STADIUM_NAMES } from "../../src/constants/index.js";
import {
  HIGH_PAYOUT_YEN,
  tallyVenuePayouts,
  venuePayoutRates,
} from "../../src/utils/venuePayoutStats.js";
import { addDaysToDateString } from "../lib/dateUtils.js";
import { readAll, monthSlices } from "./rank-data-db.js";
import { jstToday, round, slash } from "./rankDataFormat.js";

/**
 * 3連単の人気（race_results.popularity_trio）が全会場でそろう最初の日。
 * 本番の月ごとの充足（2026-11-04 読み取りで実測）: 2026-08 は 139/4,918、09 は 3,820/4,594、
 * 10 は 4,729/4,729。それより前は一部のレースにしか無いので、1番人気の率は 2026-10-01 から数える
 */
const POPULARITY_COMPLETE_FROM = "2026-10-01";
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
export async function venuePayout({ from, to }) {
  const until = to ?? addDaysToDateString(jstToday(), -1);
  const since = from ?? addDaysToDateString(until, -364);
  const { results, venueByRaceId } = await readVenueResults(since, until);
  const span = observedSpan(results, venueByRaceId);
  const byVenue = tallyVenuePayouts(results, (id) => venueByRaceId.get(id));
  const national = tallyVenuePayouts(results, (id) =>
    venueByRaceId.has(id) ? 0 : null,
  ).get(0);
  if (!national?.payoutCount)
    throw new Error("期間に3連単の配当のあるレースが無い");
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
export async function venueFavorite({ to }) {
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
  if (!national?.popularityCount)
    throw new Error("期間に3連単の人気のあるレースが無い");
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
