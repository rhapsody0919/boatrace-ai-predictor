#!/usr/bin/env node
/**
 * 龍神ボート番付（scripts/sns/rank-data.js）の DB を読む dataset が、画面と同じ値を出すかを本番の読み取りで照合する。
 * 画面の取得（supabaseDataService の同じ表・列・絞り込み）をここで再現し、画面と同じ純関数に通した値と、
 * rank-data.js の出力を比べる。読むだけ（匿名キー）。
 *
 *   node --env-file=.env.local scripts/maintenance/verify-rank-data-screen-parity.js [--date=YYYY-MM-DD]（既定は昨日）
 *
 * - venue_payout（BOA-1242）: 分析の「会場ランキング」（getTodaysVenueRanking(5)）の固い場・荒れている場・万舟率の
 *   各上位5場の平均配当・万舟率・消化レース数と、rank-data.js --from=<日> --to=<日> の行が一致する
 * - motor_power（BOA-1245）: --venue=<会場>（既定 10）の上位3機・下位3機の機力指数・走数が、画面の1機ずつの計算と一致する
 * - racer_page（BOA-1244）: その会場の今日の出走表で番付に載る選手のうち最大3人について、選手ページの取得
 *   （getRacerRaceHistory: 選手1人の全会場730日）を再現して会場×1号艇で絞った逃げ・出走数・平均ST と、
 *   rank-data.js（会場の走だけをまとめて読む）の行が一致する。当地勝率は出走表の列そのもの
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  rankVenuesByPayout,
  tallyVenuePayouts,
} from "../../src/utils/venuePayoutStats.js";
import { readAll, readAllIn } from "../sns/rank-data-db.js";
import {
  computeMotorPowerIndex,
  motorWindowFrom,
} from "../../src/utils/motorPowerIndex.js";
import { currentMotorGenerationStart } from "../../src/utils/motorGeneration.js";
import { formatPowerIndex } from "../../src/utils/smallSampleRate.js";
import { addDaysToDateString } from "../lib/dateUtils.js";
import { buildRacerRaceHistoryRows } from "../../src/services/racerRaceHistoryRows.js";
import {
  aggregateRacerVenueBoatStats,
  racerHistoryCutoff,
} from "../../src/utils/racerVenueBoatStats.js";

const dateArg = process.argv.slice(2).find((a) => a.startsWith("--date="));
const venueArg = process.argv.slice(2).find((a) => a.startsWith("--venue="));
const venue = venueArg ? Number(venueArg.slice(8)) : 10;
// 既定は昨日（JST）。今日は照合の間にレースが確定して値が動くため（画面は当日しか出さないので、昨日は
// 画面の計算を同じ取得で再現して比べる。今日の値を画面で目で見て比べるときは --date に今日を渡す）
const date = dateArg
  ? dateArg.slice(7)
  : new Date(Date.now() + 9 * 3600 * 1000 - 86400000)
      .toISOString()
      .slice(0, 10);
const cli = fileURLToPath(new URL("../sns/rank-data.js", import.meta.url));
const runCli = (args) => {
  const r = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    timeout: 120000,
    env: process.env,
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

async function venuePayoutParity() {
  // 画面（getTodaysVenueRanking）と同じ取得: その日の races → race_results（画面の列）
  const races = await readAll(
    "races",
    "race_id, venue_code",
    ["race_id"],
    (q) => q.eq("race_date", date),
  );
  if (!races.length)
    return console.log(`- venue_payout: ${date} はレースが無いので照合しない`);
  const venueByRaceId = new Map(races.map((r) => [r.race_id, r.venue_code]));
  const results = await readAllIn(
    "race_results",
    "race_id, rank1, payout_trio, winning_technique, race_status",
    "race_id",
    races.map((r) => r.race_id),
    ["race_id"],
  );
  const screen = rankVenuesByPayout(
    tallyVenuePayouts(results, (id) => venueByRaceId.get(id)),
    5,
    3,
  );
  if (!screen.stable.length)
    return console.log(
      `- venue_payout: ${date} は確定レースが3つ以上の会場が無いので照合しない`,
    );
  const out = runCli([
    "--dataset=venue_payout",
    `--from=${date}`,
    `--to=${date}`,
  ]);
  const rowOf = (metric, code) =>
    out.rows.find(
      (r) => r.extra.metric === metric && r.extra.venue_code === code,
    );
  let checked = 0;
  for (const s of [...screen.stable, ...screen.rough]) {
    const row = rowOf("avg_payout", s.venue_code);
    assert.ok(row, `会場 ${s.venue_code} の平均配当の行が無い`);
    assert.equal(
      row.value,
      Math.round(s.avg_payout),
      `会場 ${s.venue_code} の平均配当（画面は ¥${Math.round(s.avg_payout)}）`,
    );
    assert.equal(row.extra.race_count, s.race_count);
    checked += 1;
  }
  for (const s of screen.manshu) {
    const row = rowOf("high_payout_rate", s.venue_code);
    assert.ok(row);
    assert.equal(
      row.value,
      Number(s.manshu_rate.toFixed(1)),
      `会場 ${s.venue_code} の万舟率（画面は ${s.manshu_rate.toFixed(1)}%）`,
    );
    checked += 1;
  }
  console.log(
    `✅ venue_payout: ${date} の会場ランキング ${checked} 件（固い場・荒れている場・万舟率）が画面の値と一致`,
  );
  console.log(
    `   例: 固い場1位 ${screen.stable[0].venue_code} ¥${Math.round(screen.stable[0].avg_payout)}（${screen.stable[0].race_count}R）`,
  );
}

/**
 * motor_power（BOA-1245）: 画面の getMotorPowerIndex（1機ずつ、モーター調子で翌日の最初のレースを選んだときと同じ
 * beforeRaceId=<翌日>）の取得を再現し、rank-data.js --to=<日> の上位3機・下位3機の指数・走数が一致する
 */
async function motorPowerParity() {
  const out = runCli([
    "--dataset=motor_power",
    `--venue=${venue}`,
    `--to=${date}`,
  ]);
  if (out.rows.length === 0)
    return console.log(
      `- motor_power: 会場 ${venue} は載る機が無いので照合しない`,
    );
  const before = addDaysToDateString(date, 1);
  const starts = await readAll(
    "venue_motor_start_dates",
    "start_date",
    ["start_date"],
    (q) => q.eq("venue_code", venue),
  );
  const window = motorWindowFrom(
    currentMotorGenerationStart(starts),
    90,
    before,
  );
  const races = (
    await readAll(
      "races",
      "race_id, race_date",
      ["race_date", "race_id"],
      (q) =>
        q
          .eq("venue_code", venue)
          .gte("race_date", window.since)
          .lte("race_date", before),
    )
  ).filter((r) => r.race_id < before);
  const picks = [...out.rows.slice(0, 3), ...out.rows.slice(-3)];
  for (const row of picks) {
    const motor = row.extra.motor_number;
    // 画面と同じ: その機の race_entries（global_2rate）→ その走の race_results
    const entries = await readAllIn(
      "race_entries",
      "race_id, boat_number, global_2rate",
      "race_id",
      races.map((r) => r.race_id),
      ["race_id", "boat_number"],
      (q) => q.eq("motor_number", motor),
    );
    const results = await readAllIn(
      "race_results",
      "race_id, rank1, rank2, rank3",
      "race_id",
      entries.map((e) => e.race_id),
      ["race_id"],
    );
    const screen = computeMotorPowerIndex(
      entries,
      new Map(results.map((r) => [r.race_id, r])),
    );
    assert.ok(screen, `${motor}号機の画面の指数が出ない`);
    assert.equal(row.n, screen.sample_count, `${motor}号機の走数`);
    assert.equal(
      row.extra.label,
      formatPowerIndex(screen.power_index),
      `${motor}号機の指数（画面は ${formatPowerIndex(screen.power_index)}）`,
    );
  }
  console.log(
    `✅ motor_power: 会場 ${venue}・${date} まで、上位3機・下位3機の機力指数と走数が画面の1機ずつの計算と一致`,
  );
  console.log(
    `   例: ${picks[0].name} ${picks[0].extra.label}（${picks[0].n}走）`,
  );
}

async function racerPageParity() {
  const today = new Date(Date.now() + 9 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  let out;
  try {
    out = runCli(["--dataset=racer_page", `--venue=${venue}`]);
  } catch (error) {
    if (/出走表が無い/.test(error.message))
      return console.log(
        `- racer_page: 会場 ${venue} は ${today} の出走表が無いので照合しない`,
      );
    throw error;
  }
  const ids = [
    ...new Set(
      out.rows
        .filter((r) => r.extra.metric === "nige_rate_boat1")
        .map((r) => r.extra.racer_id),
    ),
  ].slice(0, 3);
  if (!ids.length)
    return console.log(
      `- racer_page: 会場 ${venue} は1号艇の走が足りる選手がいないので照合しない`,
    );
  const since = racerHistoryCutoff();
  for (const racerId of ids) {
    // 選手ページと同じ: 選手1人の全会場の race_entries（730日）→ 5つの表
    const entries = await readAll(
      "race_entries",
      "race_id, boat_number",
      ["race_id", "boat_number"],
      (q) => q.eq("racer_id", racerId).gte("race_id", since),
    );
    const raceIds = [...new Set(entries.map((e) => e.race_id))];
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
    const history = buildRacerRaceHistoryRows({
      entries,
      raceRows,
      resultRows,
      exhibitionRows,
      conditionRows,
      stRows,
    });
    const page = aggregateRacerVenueBoatStats(history, venue, 1, null, null);
    const nige = out.rows.find(
      (r) =>
        r.extra.racer_id === racerId && r.extra.metric === "nige_rate_boat1",
    );
    const st = out.rows.find(
      (r) => r.extra.racer_id === racerId && r.extra.metric === "avg_st_boat1",
    );
    assert.equal(
      nige.n,
      page.n,
      `${racerId} の1号艇の出走数（ページは ${page.n}回）`,
    );
    assert.equal(nige.k, page.tech["逃げ"] ?? 0, `${racerId} の逃げの回数`);
    assert.equal(nige.extra.wins, page.win);
    if (st)
      assert.equal(
        st.value,
        Number(page.avgSt.toFixed(3)),
        `${racerId} の平均ST（ページは ${page.avgSt.toFixed(3)}）`,
      );
  }
  console.log(
    `✅ racer_page: 会場 ${venue}・${today} の出走表の ${ids.length} 人で、会場×1号艇の逃げ・出走数・平均ST が選手ページの取得と一致`,
  );
}

try {
  await venuePayoutParity();
  await motorPowerParity();
  await racerPageParity();
} catch (error) {
  console.error(`❌ verify-rank-data-screen-parity: ${error.message}`);
  process.exitCode = 1;
}
