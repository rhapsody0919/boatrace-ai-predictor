#!/usr/bin/env node
/**
 * BOA-1244: 選手ページの会場×枠番の絞り込み（aggregateRacerVenueBoatStats）と龍神ボート番付（rank-data.js の racer_page）が、
 * 同じ純関数（src/utils/racerVenueBoatStats.js）と同じ期間（racerHistoryCutoff）で数えていることを固定する。DB・通信なし。
 *
 *   1. サービス層・選手ページが純関数を import し、サービス層に集計・730日の切りの写しが無い
 *   2. racerHistoryCutoff は移す前の式（見た時刻から730日、その環境の時刻で数えて UTC の日付）と同じ
 *   3. 番付は会場の走だけを読む。会場で絞る集計は、全会場の履歴でも会場の走だけの履歴でも同じ値になる（乱数 2,000 通り）
 *   4. rank-data.js が racer_page の引数の誤りを DB の前に拒否する
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  aggregateRacerVenueBoatStats,
  racerHistoryCutoff,
  toReturnRate,
} from "../../src/utils/racerVenueBoatStats.js";
import { readDataLayerSource } from "./dataLayerSource.js";

// 1. 呼び出し側
const service = readDataLayerSource();
assert.doesNotMatch(
  service,
  /export function aggregateRacerVenueBoatStats\(/,
  "サービス層に集計の写しが残っていない",
);
assert.doesNotMatch(service, /function toReturnRate\(/);
assert.match(
  service,
  /import \{\s*racerHistoryCutoff,\s*toReturnRate,\s*\} from "\.\.\/utils\/racerVenueBoatStats\.js";/,
);
const history = service.slice(
  service.indexOf("  getRacerRaceHistory(racerId) {"),
  service.indexOf("  getRacerBoatReturnRate(racerId) {"),
);
assert.match(
  history,
  /fetchRacerEntriesSince\(\s*racerId,\s*"race_id, boat_number",\s*racerHistoryCutoff\(\),?\s*\)/,
);
assert.doesNotMatch(history, /getDate\(\) - 730/);
const page = readFileSync(
  new URL(
    "../../src/components/racer/RacerPerformanceStats.jsx",
    import.meta.url,
  ),
  "utf8",
);
assert.match(
  page,
  /import \{ aggregateRacerVenueBoatStats \} from "\.\.\/\.\.\/utils\/racerVenueBoatStats\.js";/,
);
const rankData = readFileSync(
  new URL("../sns/rank-data.js", import.meta.url),
  "utf8",
);
assert.match(
  rankData,
  /aggregateRacerVenueBoatStats\(\s*history,\s*venueCode,\s*1,\s*null,\s*null,?\s*\)/,
  "番付はページの会場×1号艇と同じ引数",
);
// 既定（今日）はページと同じ見た時刻、--date の過去の日はその日の終わり。後の走は race_id < 翌日で外す（/code-review #1）
assert.match(
  rankData,
  /const asOf =\s*date && date < jstToday\(\)\s*\?\s*new Date\(`\$\{date\}T23:59:59\+09:00`\)\s*:\s*new Date\(\);/,
);
assert.match(rankData, /const since = racerHistoryCutoff\(asOf\);/);
assert.match(rankData, /\.gte\("race_id", since\)\s*\.lt\("race_id", until\)/);
assert.equal(toReturnRate(1500, 10), 150);
assert.equal(toReturnRate(0, 0), null);

// 2. 730日の切り（移す前の式）
for (const iso of [
  "2026-11-04T00:30:00Z",
  "2026-11-03T23:59:00Z",
  "2026-02-28T12:00:00Z",
  "2028-03-01T03:00:00Z",
]) {
  const now = new Date(iso);
  const legacy = new Date(now.getTime());
  legacy.setDate(legacy.getDate() - 730);
  assert.equal(
    racerHistoryCutoff(now),
    legacy.toISOString().split("T")[0],
    iso,
  );
}

// 3. 会場で絞る集計は、他の会場の走があっても無くても同じ
let seed = 1244;
const rand = () =>
  (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
for (let t = 0; t < 2000; t++) {
  const rows = [];
  const n = Math.floor(rand() * 50);
  for (let i = 0; i < n; i++) {
    const boatNumber = pick([1, 1, 2, 3, 6]);
    const rank1 = pick([1, 2, 3, boatNumber]);
    rows.push({
      raceId: `2026-${String(1 + (i % 9)).padStart(2, "0")}-${String(10 + i).padStart(2, "0")}-0${pick([1, 2, 3])}-${String(1 + (i % 12)).padStart(2, "0")}`,
      venueCode: pick([1, 2, 10, 10]),
      raceGrade: pick(["ippan", "G1"]),
      raceStage: pick([null, "優勝戦"]),
      raceTitle: null,
      boatNumber,
      rank1,
      rank2: pick([2, 4, boatNumber]),
      rank3: pick([3, 5]),
      rank4: 4,
      rank5: 5,
      rank6: 6,
      winningTechnique: pick(["逃げ", "差し", "抜き", null]),
      payoutWin: pick([null, 150, 1200]),
      payoutPlace1: pick([null, 110]),
      payoutPlace2: pick([null, 240]),
      exhibitionTime: pick([null, 6.71]),
      startTiming: pick([null, 0.12, 0.2]),
      isFlying: rand() < 0.05,
      finishMark: pick([null, "1", "F", "転"]),
      entryCourse: pick([null, 1, 2]),
      stRank: pick([null, 1, 4]),
      unranked: rand() < 0.05,
    });
  }
  rows.sort((a, b) => a.raceId.localeCompare(b.raceId));
  const venue = pick([1, 10]);
  const all = aggregateRacerVenueBoatStats(rows, venue, 1, null, null);
  const onlyVenue = aggregateRacerVenueBoatStats(
    rows.filter((r) => r.venueCode === venue),
    venue,
    1,
    null,
    null,
  );
  assert.deepStrictEqual(onlyVenue, all, `乱数の入力 ${t}`);
}

// 4. 引数
const cli = fileURLToPath(new URL("../sns/rank-data.js", import.meta.url));
const env = { PATH: process.env.PATH };
for (const args of [
  ["--dataset=racer_page"],
  ["--dataset=racer_page", "--venue=0"],
  ["--dataset=racer_page", "--venue=10", "--date=2026/11/04"],
  ["--dataset=racer_page", "--venue=10", "--to=2026-11-04"],
]) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    timeout: 10000,
    env,
  });
  assert.equal(r.status, 1, JSON.stringify(args));
  assert.equal(r.stdout, "");
  assert.doesNotMatch(
    r.stderr,
    /匿名キーが無い/,
    `${JSON.stringify(args)} は DB の前に拒否する: ${r.stderr}`,
  );
}

console.log(
  "✅ verify-racer-page-shared: 選手ページと番付が同じ純関数・同じ730日の切り・会場の走だけでも同じ値（2,000通り）・引数の拒否を確認",
);
