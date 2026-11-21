/**
 * verify-scrape-daily-jobs.js の後半の場面（3/9）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-daily-jobs.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { run as runPointRank } from "../../daily/scrape-point-rank.js";
import { createFakeSupabaseClient as createFakeClient } from "../../lib/scrapeJobs/testing/fakeSupabaseClient.js";

let check, show, POINT_RANK_HAYAMI, EC, createFakeFetch;

// ===========================================================================
// (e) 会場ごとのジョブ（B4 進入コース別選手成績・B3 会場別モーター成績）
// ===========================================================================
const EC_HOST_FIXTURE = {
  "www.boatrace-tokoname.jp": "tokoname.html", // 8 常滑（通常）
  "www.boatrace-tokuyama.jp": "tokuyama.html", // 18 徳山（通常）
  "www.boatrace-karatsu.jp": "karatsu.html", // 23 唐津（通常）
  "www.boatrace-mikuni.jp": "mikuni.html", // 10 三国（非開催: no_active_meet）
};

export const ecTables = () => ({
  races: [
    { race_id: "2026-09-19-08-01", start_time: "10:30:00" },
    { race_id: "2026-09-19-08-02", start_time: "11:00:00" },
    { race_id: "2026-09-19-18-01", start_time: "10:30:00" },
    { race_id: "2026-09-19-23-01", start_time: "10:30:00" },
    { race_id: "2026-09-19-04-01", start_time: "10:30:00" }, // 対象外の会場
  ],
  race_entries: [
    ...[1, 2, 3, 4, 5, 6].map((n) => ({
      race_id: "2026-09-19-08-01",
      boat_number: n,
      racer_id: 4000 + n,
    })),
  ],
});

export const ecFetch = (overrides = {}) =>
  createFakeFetch((url) => {
    const host = new URL(url).hostname;
    if (host in overrides) return overrides[host];
    return EC(EC_HOST_FIXTURE[host]);
  });

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene1() {
  const tables = () => ({
    races: [{ race_id: "2026-09-19-05-01", race_grade: "G1" }],
    race_conditions: [{ race_id: "2026-09-19-05-01", series_day: 4 }],
  });
  const hayamiFetch = async () =>
    new Response(POINT_RANK_HAYAMI, { status: 200 });
  const client = createFakeClient({ tables: tables() });
  const result = await runPointRank("2026-09-19", {
    client,
    fetchImpl: hayamiFetch,
    venueDelayMs: 0,
  });
  const first = (client.data.racer_series_points ?? []).find(
    (r) => r.racer_id === 3897,
  );
  check(
    "得点率: 早見の列（next_race_1・next_race_2・next_series_day）を書き、報告に早見ありの人数と読めない人数を出す",
    result.count === 52 &&
      first?.next_race_1 === 5 &&
      first?.next_race_2 === 11 &&
      first?.next_series_day === 5 &&
      result.venues[0]?.nextRaceRows === 3 &&
      result.venues[0]?.nextRaceUnreadable === 1,
    show({ first, venues: result.venues }),
  );
  // 159 が未適用の DB: 早見の列を含む upsert は PGRST204 で拒否される
  const legacy = createFakeClient({ tables: tables() });
  const legacyFrom = legacy.from.bind(legacy);
  let rejected = 0;
  legacy.from = (table) => {
    const b = legacyFrom(table);
    const upsert = b.upsert.bind(b);
    b.upsert = (rows, opts) => {
      // 159 は racer_series_points の列。192 の写し（racer_series_points_daily）は作るときから列を持つ
      if (
        table === "racer_series_points" &&
        rows.some((r) => "next_race_1" in r)
      ) {
        rejected += 1;
        return Promise.resolve({
          data: null,
          error: {
            code: "PGRST204",
            message:
              "Could not find the 'next_race_1' column of 'racer_series_points' in the schema cache",
          },
        });
      }
      return upsert(rows, opts);
    };
    return b;
  };
  const legacyResult = await runPointRank("2026-09-19", {
    client: legacy,
    fetchImpl: hayamiFetch,
    venueDelayMs: 0,
  });
  const legacyRows = legacy.data.racer_series_points ?? [];
  return { rejected, legacyResult, legacyRows };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene2({ rejected, legacyResult, legacyRows }) {
  check(
    "得点率: 159 が未適用なら早見の列だけを除いて書き直し、他の列（52行）は書く",
    rejected === 1 &&
      legacyResult.updated === true &&
      legacyResult.failures.length === 0 &&
      legacyRows.length === 52 &&
      legacyRows.every((r) => !("next_race_1" in r)),
    show({ rejected, legacyResult, n: legacyRows.length }),
  );
}

async function scene3() {
  {
    const s1 = await scene1();
    scene2(s1);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・POINT_RANK_HAYAMI・EC・createFakeFetch） */
export async function runScrapeDailyJobsScenes3(env) {
  ({ check, show, POINT_RANK_HAYAMI, EC, createFakeFetch } = env);
  await scene3();
}
