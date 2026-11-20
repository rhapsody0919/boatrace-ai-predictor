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
import { addDaysToDateString } from "../lib/dateUtils.js";
import { readAll, readAllIn } from "./rank-data-db.js";
import { computeVenueMotorPowerIndexes } from "../../src/utils/motorPowerIndex.js";
import { SMALL_SAMPLE_THRESHOLD } from "../../src/pure/basicInfoStats.js";
import { buildRacerRaceHistoryRows } from "../../src/services/racerRaceHistoryRows.js";
import { splitRacerName } from "../../src/utils/racerName.js";
import {
  aggregateRacerVenueBoatStats,
  racerHistoryCutoff,
} from "../../src/utils/racerVenueBoatStats.js";
import { jstToday } from "./rankDataFormat.js";
import { venueKimarite, venueInByWeather } from "./rankDataStatic.js";
import { venuePayout, venueFavorite } from "./rankDataVenue.js";
import {
  readMotorData,
  readMotorWindow,
  motorPowerOutput,
} from "./rankDataMotor.js";
import {
  groupEntriesByRacer,
  racerPageOutput,
  racerPageRows,
  readRacerCard,
  readRacerHistoryTables,
} from "./rankDataRacer.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 会場の全機の機力指数（画面のモーター調子・モータ情報と同じ式・同じ期間）。
 * 期間は max(現行モーターの使用開始日, 基準日−90日)。基準日は今日（JST、画面と同じ。当日の確定レースも入る）。
 * --to=D を渡すと D の終わりまで（画面で D の翌日の最初のレースを開いたときと同じ: 基準日 D+1、race_id < D+1）。
 * 番付に載せるのは、画面が評価の言葉を出す走数（SMALL_SAMPLE_THRESHOLD=6、powerIndexTone の small の線）以上の機。
 * それ未満の機は excluded に出す
 */
async function motorPower({ venue, to }) {
  const venueCode = Number(venue);
  const baseDate = to ? addDaysToDateString(to, 1) : jstToday();
  const before = to ? baseDate : null; // race_id はこの文字列より前（画面の beforeRaceId と同じ比べ方）
  const window = await readMotorWindow({ venueCode, to, baseDate });
  const { races, entries, resultByRaceId } = await readMotorData({
    venueCode,
    window,
    before,
  });
  const indexes = computeVenueMotorPowerIndexes(entries, resultByRaceId);
  const shown = indexes.filter((m) => m.sample_count >= SMALL_SAMPLE_THRESHOLD);
  return motorPowerOutput({
    venueCode,
    window,
    races,
    resultByRaceId,
    shown,
    indexes,
  });
}

/** 選手の級（racer_grade_cache）と、その会場の履歴の出走（期間 since〜until）を読む */
function readGradesAndEntries({ racerIds, since, until, vv }) {
  return Promise.all([
    readAll("racer_grade_cache", "data", ["key"], (q) =>
      q.eq("key", "latest_grades"),
    ),
    readAllIn(
      "race_entries",
      "race_id, boat_number, racer_id",
      "racer_id",
      racerIds,
      ["race_id", "boat_number"],
      (q) =>
        q
          .gte("race_id", since)
          .lt("race_id", until)
          .like("race_id", `__________-${vv}-__`),
    ),
  ]);
}

/** 選手ごとの会場×1号艇の集計（選手ページと同じ関数）。名前・級・当地勝率を添える */
function buildRacerStats({
  racerIds,
  racers,
  entriesOf,
  tables,
  gradeOf,
  venueCode,
}) {
  return racerIds.map((racerId) => {
    const history = buildRacerRaceHistoryRows({
      entries: entriesOf.get(racerId) ?? [],
      ...tables,
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
}

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
  const day = date ?? jstToday();
  // 期間: 既定（今日）はページと同じ「見た時刻から730日」。--date に過去の日を渡したときは、その日の終わりに
  // ページを見たのと同じにする（始まりはその日から730日、終わりはその日まで。後の走を混ぜない）。級は今の値
  const asOf =
    date && date < jstToday() ? new Date(`${date}T23:59:59+09:00`) : new Date();
  const until = addDaysToDateString(day, 1); // race_id はこれより前
  const vv = String(venueCode).padStart(2, "0");
  const racers = await readRacerCard({ day, vv, venueCode });
  const racerIds = [...racers.keys()];
  const since = racerHistoryCutoff(asOf);
  const [grades, entries] = await readGradesAndEntries({
    racerIds,
    since,
    until,
    vv,
  });
  const gradeOf = new Map(
    (grades[0]?.data ?? []).map((g) => [g.racer_id, g.grade ?? null]),
  );
  const raceIds = [...new Set(entries.map((e) => e.race_id))];
  const tables = await readRacerHistoryTables(raceIds);
  const stats = buildRacerStats({
    racerIds,
    racers,
    entriesOf: groupEntriesByRacer(entries),
    tables,
    gradeOf,
    venueCode,
  });
  return racerPageOutput({
    since,
    day,
    rows: racerPageRows(stats, venueCode),
    stats,
  });
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

/** 引数の1つを { key, value } にする（--key=value の形だけ） */
function parseOneArg(arg) {
  const m = /^--([a-z]+)=(.*)$/.exec(arg);
  if (!m) throw new Error(`未対応の引数: ${arg}`);
  const [, key, value] = m;
  return { key, value };
}

/** dataset が受け付ける引数の1つの値の検査（parseArgs から移した） */
function checkOption(dataset, spec, key, value) {
  if (!spec.options.includes(key)) {
    throw new Error(
      `未対応の引数: --${key}（${dataset} が受け付けるのは ${spec.options.length ? spec.options.map((o) => `--${o}`).join("・") : "--dataset だけ"}）`,
    );
  }
  if (["from", "to", "date"].includes(key) && !DATE_RE.test(value))
    throw new Error(`--${key} は YYYY-MM-DD`);
  if (key === "venue" && !/^(?:[1-9]|1\d|2[0-4])$/.test(value))
    throw new Error("--venue=<1〜24> を指定してください");
}

/** @returns {{ dataset: string, options: Record<string, string> }} */
function parseArgs(argv) {
  let dataset;
  const options = {};
  for (const arg of argv) {
    const { key, value } = parseOneArg(arg);
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
  for (const [key, value] of Object.entries(options))
    checkOption(dataset, spec, key, value);
  if (spec.options.includes("venue") && options.venue === undefined) {
    throw new Error("--venue=<1〜24> を指定してください");
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
