/**
 * verify-morning-init-refactor.js の後半の場面（2/3）。verify ではない。
 * 判定と期待値は分ける前の verify-morning-init-refactor.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { findRacesMissingUnified, generateUnifiedPredictions } from "../../daily/generate-unified-predictions.js";
import { createFakeSupabaseClient } from "../../lib/scrapeJobs/testing/fakeSupabaseClient.js";

let FIXED_NOW, check, show, same, rejects, DATE;

/** 元の verify の1つの塊 { } を割った 1/3 */
async function scene1() {
  const entries = (raceId) =>
    Array.from({ length: 6 }, (_, i) => ({
      race_id: raceId,
      boat_number: i + 1,
      racer_id: 4000 + i,
      grade: "B1",
      win_rate: 5 - i * 0.3,
      local_win_rate: 5 - i * 0.2,
      motor_2rate: 40 - i,
    }));
  // イン崩れ注意度の夜の表（BOA-822）。無いと全レースが rates_unavailable になり、欠けとして数え直される
  const rpcs = {
    get_in_caution_band_rates: ({ p_through }) =>
      Array.from({ length: 15 }, (_, i) => ({
        round_grp: "other",
        gap_band: i - 8,
        n: 30000,
        non_win: 9000 + i * 1000,
        first_date: "2019-04-01",
        last_date: p_through,
      })),
  };
  const tables = () => ({
    races: [
      { race_id: "2026-09-21-01-01", start_time: "15:26:00" },
      { race_id: "2026-09-21-01-02", start_time: "15:57:00" },
    ],
    race_entries: [
      ...entries("2026-09-21-01-01"),
      ...entries("2026-09-21-01-02"),
    ],
    race_conditions: [
      { race_id: "2026-09-21-01-01", wind_speed: 2, wave_height: 3 },
    ],
    racer_aggregated_stats: [],
    predictions: [],
  });
  const client = createFakeSupabaseClient({ tables: tables(), rpcs });
  const missingBefore = await findRacesMissingUnified(DATE, client, {
    now: () => FIXED_NOW,
  });
  check(
    "(c) findRacesMissingUnified: unified が無い2レースを返す",
    same(missingBefore, ["2026-09-21-01-01", "2026-09-21-01-02"]),
    show(missingBefore),
  );
  const r = await generateUnifiedPredictions({
    now: () => FIXED_NOW,
    date: DATE,
    client,
    strict: true,
  });
  check(
    "(c) generateUnifiedPredictions: 2レース分の unified を書く（model_id='unified'）",
    r.generated === 2 &&
      r.written === 2 &&
      client.data.predictions.length === 2 &&
      client.data.predictions.every((p) => p.model_id === "unified"),
    show(r),
  );
  const missingAfter = await findRacesMissingUnified(DATE, client, {
    now: () => FIXED_NOW,
  });
  check("(c) 生成後は、欠けたレースが無い", same(missingAfter, []));
  await generateUnifiedPredictions({
    now: () => FIXED_NOW,
    date: DATE,
    client,
    strict: true,
  });
  check(
    "(c) 再実行しても行は増えない（upsert。冪等）",
    client.data.predictions.length === 2,
  );
  return { rpcs, tables };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
async function scene2({ rpcs, tables }) {
  const failingClient = createFakeSupabaseClient({
    tables: tables(),
    rpcs,
    failOn: { "predictions:upsert": "boom-unified" },
  });
  const err = await rejects(
    generateUnifiedPredictions({
      now: () => FIXED_NOW,
      date: DATE,
      client: failingClient,
    }),
  );
  check(
    "(c) 書き込みの失敗は例外（成功したバッチの件数をメッセージに含む）",
    err &&
      /boom-unified/.test(err.message) &&
      /反映済み0\/2件/.test(err.message),
    err?.message,
  );
  const noClient = await rejects(
    generateUnifiedPredictions({
      now: () => FIXED_NOW,
      date: DATE,
      client: null,
    }),
  );
  check("(c) Supabase が無ければ例外", noClient !== null);
  const dbDown = createFakeSupabaseClient({
    tables: tables(),
    rpcs,
    failOn: { "races:select": "db-down" },
  });
  const lenient = await generateUnifiedPredictions({
    now: () => FIXED_NOW,
    date: DATE,
    client: dbDown,
    strict: false,
  });
  check(
    "(c) strict: false: スケジュール取得の失敗は「対象レースなし」",
    lenient.targetRaces === 0,
  );
  const defaultErr = await rejects(
    generateUnifiedPredictions({
      now: () => FIXED_NOW,
      date: DATE,
      client: dbDown,
    }),
  );
  check(
    "(c) 既定（BOA-391）: スケジュール取得の失敗は例外（CLI の例外は morning-init が catch する）",
    defaultErr !== null,
  );
  const strictErr = await rejects(
    generateUnifiedPredictions({
      now: () => FIXED_NOW,
      date: DATE,
      client: dbDown,
      strict: true,
    }),
  );
  check(
    "(c) strict: スケジュール取得の失敗は例外（対象なしに化けない）",
    strictErr && /db-down/.test(strictErr.message),
    strictErr?.message,
  );
  return { rpcs, tables };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
async function scene3({ rpcs, tables }) {
  // BOA-628: 発走済みのレースは書かず、欠けていても数えない（15:30 の時点で 1R=15:26 は発走済み、2R=15:57 は発走前）
  {
    const at = () => new Date(`${DATE}T15:30:00+09:00`);
    const c2 = createFakeSupabaseClient({ tables: tables(), rpcs });
    const missing = await findRacesMissingUnified(DATE, c2, { now: at });
    check(
      "(c) BOA-628: findRacesMissingUnified は発走済みのレースを数えない（2R だけ）",
      same(missing, ["2026-09-21-01-02"]),
      show(missing),
    );
    const gen = await generateUnifiedPredictions({
      date: DATE,
      client: c2,
      strict: true,
      now: at,
    });
    check(
      "(c) BOA-628: generateUnifiedPredictions は発走済みのレースを書かない（2R の1行だけ）",
      gen.written === 1 &&
        c2.data.predictions.length === 1 &&
        c2.data.predictions[0].race_id === "2026-09-21-01-02",
      show(gen),
    );
    const again = await findRacesMissingUnified(DATE, c2, { now: at });
    check(
      "(c) BOA-628: 生成後、発走済みの 1R が欠けたままでも、欠けたレースは0（再実行が止まる）",
      same(again, []),
      show(again),
    );
    const c3 = createFakeSupabaseClient({ tables: tables(), rpcs });
    const all = await generateUnifiedPredictions({
      date: DATE,
      client: c3,
      strict: true,
      now: at,
      includeStarted: true,
    });
    check(
      "(c) BOA-628: includeStarted なら発走済みも書く（過去日の作り直し）",
      all.written === 2,
      show(all),
    );
  }
}

async function scene4() {
  {
    const s1 = await scene1();
    const s2 = await scene2(s1);
    await scene3(s2);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（FIXED_NOW・check・show・same・rejects・DATE） */
export async function runMorningInitRefactorScenes2(env) {
  ({ FIXED_NOW, check, show, same, rejects, DATE } = env);
  await scene4();
}
