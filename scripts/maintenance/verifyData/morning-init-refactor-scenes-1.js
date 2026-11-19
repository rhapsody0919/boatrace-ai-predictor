/**
 * verify-morning-init-refactor.js の後半の場面（1/3）。verify ではない。
 * 判定と期待値は分ける前の verify-morning-init-refactor.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { getTodayVenues, scrapeVenue, scrapeRacesData } from "../../scrape-to-json.js";

let check, show, same, rejects, GOLDEN_VENUE, GOLDEN_VENUES, DATE, createFixtureFetch;

/** 元の verify の1つの塊 { } を割った 1/3 */
async function scene1() {
  const fetchHtml = createFixtureFetch();
  const venues = await getTodayVenues(DATE, { fetchHtml, strict: true });
  check(
    "(a) 開催会場一覧: 旧実装の出力（golden）と一致",
    same(venues, GOLDEN_VENUES),
    show(venues),
  );
  const venue = await scrapeVenue(DATE, 1, { fetchHtml, strict: true });
  check(
    "(a) 1会場の出走表・直前情報・発走時刻: 旧実装の出力（golden）と完全に一致（strict）",
    same(venue, GOLDEN_VENUE),
  );
  const venueDefault = await scrapeVenue(DATE, 1, { fetchHtml });
  check(
    "(a) 既定（非 strict）でも、同じ出力（従来の GitHub Actions・CLI と同じ）",
    same(venueDefault, GOLDEN_VENUE),
  );
  check(
    "(a) 12レース・全レースに6艇・発走時刻あり",
    venue.races.length === 12 &&
      venue.races.every((r) => r.racers.length === 6 && r.startTime),
  );
  const data = await scrapeRacesData(DATE, [1], {
    fetchHtml,
    venueDelayMs: 0,
  });
  check(
    "(a) scrapeRacesData: races.json と同じ形（success・date・data・scrapedAt）をメモリ上で返す",
    data.success === true &&
      data.date === DATE &&
      data.data.length === 1 &&
      same(data.data[0], GOLDEN_VENUE) &&
      typeof data.scrapedAt === "string",
  );
  // 非 strict: 取得の失敗は、従来どおり null・空に化ける
  const failVenues = await getTodayVenues(DATE, {
    fetchHtml: createFixtureFetch({ fail: () => true }),
  });
  check(
    "(a) 非 strict: 会場一覧の取得失敗は [] に化ける（従来どおり）",
    same(failVenues, []),
  );
  const racelist3Fails = await scrapeVenue(DATE, 1, {
    fetchHtml: createFixtureFetch({
      fail: (u) => u.includes("racelist") && u.includes("rno=3"),
    }),
  });
  check(
    "(a) 非 strict: racelist の失敗は、そのレースの選手が空になるだけ（従来どおり）",
    racelist3Fails.races.length === 12 &&
      racelist3Fails.races[2].racers.length === 0 &&
      racelist3Fails.races[3].racers.length === 6,
  );
  const beforeinfoFails = await scrapeVenue(DATE, 1, {
    fetchHtml: createFixtureFetch({
      fail: (u) => u.includes("beforeinfo"),
    }),
  });
  check(
    "(a) 非 strict: beforeinfo が取れなくても、全レースがそろう（beforeinfo は取らない。BOA-1145）",
    same(beforeinfoFails, GOLDEN_VENUE),
  );
}

/** 元の verify の1つの塊 { } を割った 2/3 */
async function scene2() {
  // strict: 失敗は例外
  const e1 = await rejects(
    getTodayVenues(DATE, {
      fetchHtml: createFixtureFetch({ fail: () => true }),
      strict: true,
    }),
  );
  check(
    "(a) strict: 会場一覧の取得失敗は例外（開催なしに化けない）",
    e1 && /開催会場一覧の取得に失敗/.test(e1.message),
    e1?.message,
  );
  const e2 = await rejects(
    scrapeVenue(DATE, 1, {
      fetchHtml: createFixtureFetch({
        fail: (u) => u.includes("racelist") && u.includes("rno=3"),
      }),
      strict: true,
    }),
  );
  check(
    "(a) strict: racelist が1ページでも失敗したら、会場全体が例外（一部欠けたまま書かない）",
    e2 && /会場1/.test(e2.message),
    e2?.message,
  );
  const beforeinfoLog = createFixtureFetch({
    fail: (u) => u.includes("beforeinfo"),
  });
  const e3 = await rejects(
    scrapeVenue(DATE, 1, { fetchHtml: beforeinfoLog, strict: true }),
  );
  check(
    "(a) strict: beforeinfo が全て失敗しても、会場は例外にならない（beforeinfo を取りに行かない。BOA-1145）",
    e3 === null && !beforeinfoLog.log.some((u) => u.includes("beforeinfo")),
    e3?.message,
  );
  const e4 = await rejects(
    scrapeVenue(DATE, 1, {
      fetchHtml: createFixtureFetch({
        fail: (u) => u.includes("raceindex"),
      }),
      strict: true,
    }),
  );
  check(
    "(a) strict: 発走時刻のページが失敗したら例外",
    e4 && /発走時刻の取得に失敗/.test(e4.message),
    e4?.message,
  );
  const noTimesFetch = async (url) =>
    String(url).includes("raceindex")
      ? "<html><body><table><tr><td>-</td></tr></table></body></html>"
      : createFixtureFetch()(url);
  const e5 = await rejects(
    scrapeVenue(DATE, 1, { fetchHtml: noTimesFetch, strict: true }),
  );
  check(
    "(a) strict: 発走時刻が1件も読めなければ例外（start_time が NULL のまま書かない）",
    e5 && /発走時刻を1件も取得できません/.test(e5.message),
    e5?.message,
  );
  // 並列度の上限
  const limited = createFixtureFetch({ latencyMs: 8 });
  await scrapeVenue(DATE, 1, { fetchHtml: limited, raceConcurrency: 3 });
  check(
    "(a) raceConcurrency=3: 同時リクエストは最大3（3レース×racelist。beforeinfo は取らない）",
    limited.maxActive <= 3 && limited.maxActive >= 2,
    `maxActive=${limited.maxActive}`,
  );
  const unlimited = createFixtureFetch({ latencyMs: 8 });
  return { unlimited };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
async function scene3({ unlimited }) {
  await scrapeVenue(DATE, 1, { fetchHtml: unlimited });
  check(
    "(a) 既定（12レース同時）: 12リクエスト（racelist）が同時に走る",
    unlimited.maxActive === 12,
    `maxActive=${unlimited.maxActive}`,
  );
}

async function scene4() {
  {
    await scene1();
    const s2 = await scene2();
    await scene3(s2);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・rejects・GOLDEN_VENUE・GOLDEN_VENUES・DATE・createFixtureFetch） */
export async function runMorningInitRefactorScenes1(env) {
  ({ check, show, same, rejects, GOLDEN_VENUE, GOLDEN_VENUES, DATE, createFixtureFetch } = env);
  await scene4();
}
