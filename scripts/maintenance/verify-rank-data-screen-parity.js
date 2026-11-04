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
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  rankVenuesByPayout,
  tallyVenuePayouts,
} from "../../src/utils/venuePayoutStats.js";
import { readAll, readAllIn } from "../sns/rank-data-db.js";

const dateArg = process.argv.slice(2).find((a) => a.startsWith("--date="));
// 既定は昨日（JST）。今日は照合の間にレースが確定して値が動くため（画面は当日しか出さないので、昨日は
// 画面の計算を同じ取得で再現して比べる。今日の値を画面で目で見て比べるときは --date に今日を渡す）
const date = dateArg
  ? dateArg.slice(7)
  : new Date(Date.now() + 9 * 3600 * 1000 - 86400000).toISOString().slice(0, 10);
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

try {
  await venuePayoutParity();
} catch (error) {
  console.error(`❌ verify-rank-data-screen-parity: ${error.message}`);
  process.exitCode = 1;
}
