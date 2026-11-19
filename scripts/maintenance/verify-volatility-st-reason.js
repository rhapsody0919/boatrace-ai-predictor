/**
 * verify-volatility-st-reason.js - イン崩れ指数の理由文の「1号艇の平均ST」の1行（BOA-818）。DBには接続しない。
 *
 * 守るもの: 値は racer_aggregated_stats.avg_st（当サイトに蓄積した全期間）なので、理由文がその期間どおりに
 * 書かれていること。以前は「1号艇の今節ST」と書いていて、今節の走ではない値を今節と読ませていた。
 * 予想バッチ（generate-predictions.js・generate-unified-predictions.js）の両方が同じ関数を使うことも、本文の字でなく
 * 偽の Supabase で回した出力（races.volatility_reasons・calculateVolatilityComposite の reasons）で確かめる
 */
import { readFileSync } from "node:fs";
import { generateAndWriteFromRacesData } from "../daily/generate-predictions.js";
import { boat1StReason, calculateVolatilityComposite } from "../lib/volatilityFactors.js";
import { createFakeSupabaseClient } from "../lib/scrapeJobs/testing/fakeSupabaseClient.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

const cases = [
  [0.23, "1号艇の平均ST（当サイトに蓄積した全期間）が非常に遅い（0.230秒）→ 出遅れリスク大"],
  [0.19, "1号艇の平均ST（当サイトに蓄積した全期間）が遅い（0.190秒）→ イン崩れリスク"],
  [0.16, "1号艇の平均ST（当サイトに蓄積した全期間）は標準（0.160秒）"],
  [0.13, "1号艇の平均ST（当サイトに蓄積した全期間）が速い（0.130秒）→ スタート安定"],
  [0.09, "1号艇の平均ST（当サイトに蓄積した全期間）が非常に速い（0.090秒）→ 逃げ鉄板"],
];
for (const [st, expected] of cases) {
  const got = boat1StReason(st);
  check(`平均ST ${st} の理由文`, got === expected, got);
}
check(
  "理由文に「今節」と書かない（値は今節の走ではない）",
  cases.every(([st]) => !boat1StReason(st).includes("今節")),
);

const venue = JSON.parse(readFileSync(new URL("../lib/racesInit/__fixtures__/golden-venue-01.json", import.meta.url), "utf8"));
const race = { ...venue.races[0], racers: venue.races[0].racers.map((r) => ({ ...r, number: r.lane, winRate: r.globalWinRate })) };
const log = console.log;
for (const [st, expected] of cases) {
  const client = createFakeSupabaseClient({ tables: { venues: [], racer_aggregated_stats: [{ racer_id: race.racers[0].racerId, venue_code: 0, avg_st: st }] } });
  console.log = () => {};
  await generateAndWriteFromRacesData({ racesData: { success: true, data: [{ ...venue, races: [structuredClone(race)] }] }, date: race.date, client, now: () => new Date(`${race.date}T06:00:00+09:00`) }).finally(() => (console.log = log));
  const reasons = client.data.races?.[0]?.volatility_reasons ?? [];
  check(`generate-predictions.js: 平均ST ${st} の races.volatility_reasons に boat1StReason の文が入り「今節」が無い`, reasons.includes(expected) && !reasons.join().includes("今節"), JSON.stringify(reasons));
  const unified = calculateVolatilityComposite(race.racers, race.placeCd, null, [{ boatNumber: 1, avgST: st }]).reasons;
  check(`calculateVolatilityComposite: 平均ST ${st} の reasons に boat1StReason の文が入り「今節」が無い`, unified.includes(expected) && !unified.join().includes("今節"), JSON.stringify(unified));
}

if (failures > 0) {
  console.error(`\n${failures}件失敗`);
  process.exit(1);
}
console.log("\n全て成功");
