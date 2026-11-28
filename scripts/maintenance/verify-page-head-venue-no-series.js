#!/usr/bin/env node
/**
 * 会場の head の関数（/api/page-head/v1/venue/{code}、api/_lib/pageHeadApi.js）が節の行（race_series）を読まず、それでも節の行を読んで組んだ head と同じ値を返すこと。
 *
 * 2026-11-28 の本番で、会場の head の CDN の MISS が 1000ms の上限を越えていた（/api/races/today の後に節の行の取得が直列に足される）。
 * 節の行は開催の帯（head の外）にしか効かないので、head の関数は読まない。
 * 1. 帯が出る会場（G1 の開催中）でも、関数に渡した節の行の取得は呼ばれず 200
 * 2. その head（title・description・canonical・BreadcrumbList）は、節の行を読んで組んだモデル（venueModelOf）の pageHeadOf と同じ
 * 3. 帯が出ない会場（一般戦・開催なし）も同じ
 */
import assert from "node:assert/strict";
import { getLocaleT, venueModelOf } from "../../api/_lib/botPage.js";
import { pageHeadOf } from "../../api/_lib/botPageRender.js";
import { respondVenueHead } from "../../api/_lib/pageHeadApi.js";

const race = (placeCd, raceNo, raceGrade, raceTitle) => ({
  raceNo, startTime: `${10 + raceNo}:00`, date: "2026-10-08", placeCd, raceGrade, cancellationStatus: null,
  seriesDay: 3, isFinalDay: false, raceTitle, raceStage: "予選",
});
const TODAY = {
  success: true,
  scrapedAt: "2026-10-08T01:00:00.000Z",
  data: [
    { place_cd: 1, place_name: "桐生", races: [1, 2].map((n) => race(1, n, "G1", "赤城雷神杯")) },
    { place_cd: 2, place_name: "戸田", races: [1, 2].map((n) => race(2, n, "ippan", "一般戦")) },
  ],
};
const ROW = {
  start_date: "2026-10-06", end_date: "2026-10-11", title: "赤城雷神杯", grade: "G1",
  venue_code: 1, total_days: 6, class_code: "G1", kind: "g1",
};
const NOW = Date.UTC(2026, 9, 8, 3, 0); // JST 2026-10-08 12:00
const HOST = { host: "www.boat-ai.jp" };

let failures = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n     ${error.message}`);
  }
};

async function headOf(code) {
  let seriesCalls = 0;
  const res = await respondVenueHead(
    { method: "GET", url: `/api/page-head/v1/venue/${code}`, headers: HOST },
    {
      getTodayJson: async () => structuredClone(TODAY),
      getSeriesRows: async () => {
        seriesCalls += 1;
        throw new Error("節の行を読んだ");
      },
      getT: () => getLocaleT("ja"),
      now: () => NOW,
    },
  );
  const t = await getLocaleT("ja");
  const withSeries = await venueModelOf(structuredClone(TODAY), code, { t, lang: "ja", today: "2026-10-08" }, async () => [ROW]);
  return { res, seriesCalls, withSeries };
}

await check("1・2. 帯が出る会場でも節の行を読まず、読んで組んだ head と同じ", async () => {
  const { res, seriesCalls, withSeries } = await headOf(1);
  assert.equal(withSeries.meetBannerEligible, true, "前提: 桐生の G1 は帯が出る");
  assert.ok(withSeries.meetBanner, "前提: 節の行を読むと帯が組まれる");
  assert.equal(seriesCalls, 0, "節の行の取得を呼んだ");
  assert.equal(res.status, 200, res.body);
  const { v, kind, ...head } = JSON.parse(res.body);
  assert.deepEqual([v, kind], [1, "venue"]);
  assert.deepEqual(head, pageHeadOf(withSeries));
  assert.ok(head.title.includes("赤城雷神杯"), head.title);
});

await check("3. 帯が出ない会場も同じ", async () => {
  for (const code of [2, 12]) {
    const { res, seriesCalls, withSeries } = await headOf(code);
    assert.equal(withSeries.meetBannerEligible, false, `前提: 会場 ${code} は帯が出ない`);
    assert.equal(seriesCalls, 0);
    assert.equal(res.status, 200);
    const { v, kind, ...head } = JSON.parse(res.body);
    assert.deepEqual(head, pageHeadOf(withSeries), `会場 ${code}`);
  }
});

if (failures > 0) {
  console.error(`\n${failures} 件の失敗`);
  process.exit(1);
}
console.log("\nverify-page-head-venue-no-series: すべて通った");
