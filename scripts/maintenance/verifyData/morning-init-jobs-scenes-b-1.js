/**
 * verify-morning-init-jobs.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-morning-init-jobs.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { createFakeSupabaseClient } from "../../lib/scrapeJobs/testing/fakeSupabaseClient.js";
import { PREDICT_CODE_HASH_JOB, checkPredictCodeChange } from "../../lib/racesInit/predictCodeCheck.js";
import { runMorningInitJobsScenes1 } from "./morning-init-jobs-scenes-1.js";
import { runMorningInitJobsScenes2 } from "./morning-init-jobs-scenes-2.js";
import { runMorningInitJobsScenes3 } from "./morning-init-jobs-scenes-3.js";

let check, show, same, jst, clone, GOLDEN_VENUE, DATE, JOB, fakeVenue, newEnv;
export let T0;

/** runRacesInitJob の依存を、呼び出しを数える偽物にする */
export function newDeps({
  venues = [1, 2, 3],
  existing = [],
  failVenues = new Map(),
  clock = null,
  venueCost = 0,
  noProgramVenues = [],
} = {}) {
  const calls = {
    getVenues: 0,
    dates: [],
    opts: [],
    scrape: [],
    write: [],
    slots: 0,
    unified: 0,
    hook: 0,
    noProgramChecks: [],
  };
  const state = {
    venues,
    existing,
    failVenues,
    unifiedFails: false,
    // イン崩れ注意度の表が読めない回数（BOA-822）。Infinity なら毎回
    inCautionFails: 0,
  };
  const deps = {
    getVenues: async (date) => {
      calls.getVenues++;
      calls.dates.push(date);
      return typeof state.venues === "function"
        ? state.venues(calls.getVenues)
        : state.venues;
    },
    scrapeVenue: async (date, code, opts) => {
      calls.scrape.push(code);
      calls.opts.push(opts);
      if (clock) clock.advance(venueCost);
      const failure = state.failVenues.get(code);
      if (failure)
        throw failure instanceof Error ? failure : new Error(failure);
      return fakeVenue(code);
    },
    existingVenueCodes: async () => new Set(state.existing),
    writeVenue: async (venue) => {
      calls.write.push(venue.placeCd);
    },
    ensureSlots: async () => {
      calls.slots++;
      return { jobs: ["odds"], created: 5 };
    },
    ensureUnified: async () => {
      calls.unified++;
      if (state.unifiedFails) throw new Error("unified-down");
      const inCautionFailed = state.inCautionFails > 0;
      state.inCautionFails--;
      return { missing: 0, generated: 0, inCautionFailed };
    },
    triggerDeployHook: async () => {
      calls.hook++;
      return { triggered: true };
    },
    // 番組の無い中止の会場の確認（BOA-721）。既定は「番組なしではない」（従来どおり失敗にする）
    checkNoProgram: async (date, code) => {
      calls.noProgramChecks.push(code);
      return noProgramVenues.includes(code);
    },
  };
  return { deps, calls, state };
}

const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

export const at = (minutes, base = T0) => new Date(base.getTime() + minutes * 60_000);

// ---------------------------------------------------------------------------
// (h) 予測ロジックの変更検知
// ---------------------------------------------------------------------------
/** { の中身を割った 1/5 */
export async function mijPredictCode1() {
  const stateTable = (hash) =>
    hash === undefined
      ? []
      : [{ job: PREDICT_CODE_HASH_JOB, mode: "off", last_report: { hash } }];
  const nowAt = jst("2026-09-21 06:30");
  const schedule = [
    { race_id: "2026-09-21-01-01", start_time: jst("2026-09-21 06:00") }, // 発走済み
    { race_id: "2026-09-21-01-02", start_time: jst("2026-09-21 07:00") },
    { race_id: "2026-09-21-01-03", start_time: jst("2026-09-21 08:00") },
  ];
  const refreshCalls = [];
  const refresh = async (args) => {
    refreshCalls.push(args);
  };
  const getSchedule = async (date) => {
    if (date !== DATE) throw new Error(`日付が違います: ${date}`);
    return schedule;
  };
  const hashOf = (client) =>
    client.data.scrape_job_state.find((r) => r.job === PREDICT_CODE_HASH_JOB)
      ?.last_report?.hash;

  {
    const client = createFakeSupabaseClient({
      tables: { scrape_job_state: stateTable("A") },
    });
    const r = await checkPredictCodeChange({
      client,
      now: () => nowAt,
      hash: null,
      refresh,
      getSchedule,
    });
    check(
      "(h) ハッシュを計算できない: 検知しない（DBにも触れない）",
      r.status === "hash_unavailable" && client.calls.length === 0,
    );
  }
  {
    const client = createFakeSupabaseClient({
      tables: { scrape_job_state: [] },
    });
    const r = await checkPredictCodeChange({
      client,
      now: () => nowAt,
      hash: "A",
      refresh,
      getSchedule,
    });
    check(
      "(h) 初回（保存済みのハッシュなし）: 基準を保存するのみ。再生成しない",
      r.status === "baseline" &&
        hashOf(client) === "A" &&
        refreshCalls.length === 0,
    );
  }
  {
    const client = createFakeSupabaseClient({
      tables: { scrape_job_state: stateTable("A") },
    });
    const r = await checkPredictCodeChange({
      client,
      now: () => nowAt,
      hash: "A",
      refresh,
      getSchedule,
    });
    check(
      "(h) ハッシュが同じ: 何もしない。DBへの問い合わせは、ハッシュの行の読み取り1回だけ",
      r.status === "unchanged" &&
        refreshCalls.length === 0 &&
        client.calls.length === 1 &&
        client.writes.length === 0,
      show(client.calls),
    );
  }
  return { stateTable, nowAt, schedule, refreshCalls, refresh, getSchedule, hashOf };
}

/** { の中身を割った 2/5 */
export async function mijPredictCode2({ getSchedule, hashOf, nowAt, refresh, refreshCalls, stateTable }) {
  {
    const client = createFakeSupabaseClient({
      tables: { scrape_job_state: stateTable("A") },
    });
    const r = await checkPredictCodeChange({
      client,
      now: () => nowAt,
      hash: "B",
      refresh,
      getSchedule,
    });
    const call = refreshCalls.at(-1);
    check(
      "(h) ハッシュが変わった: 発走前の2レースだけ再生成（発走済みは、的中フラグを保つため対象外）。upsert・updated_at を進める・対象日つき",
      r.status === "regenerated" &&
        r.races === 2 &&
        same(call.specificRaceIds, ["2026-09-21-01-02", "2026-09-21-01-03"]) &&
        call.writeMode === "upsert" &&
        call.forceTouchRaces === true &&
        call.isDryRun === false &&
        call.date === DATE &&
        hashOf(client) === "B",
      show({ r, call }),
    );
  }
  {
    const before = refreshCalls.length;
    const client = createFakeSupabaseClient({
      tables: { scrape_job_state: stateTable("A") },
    });
    const results = await Promise.all([
      checkPredictCodeChange({
        client,
        now: () => nowAt,
        hash: "B",
        refresh,
        getSchedule,
      }),
      checkPredictCodeChange({
        client,
        now: () => nowAt,
        hash: "B",
        refresh,
        getSchedule,
      }),
    ]);
    check(
      "(h) 重なった2つの起動: 先に保存済みのハッシュを更新した1つだけが再生成する（もう1つは claimed_elsewhere）",
      refreshCalls.length === before + 1 &&
        results
          .map((x) => x.status)
          .sort()
          .join(",") === "claimed_elsewhere,regenerated",
      show(results),
    );
  }
}

/** { の中身を割った 3/5 */
export async function mijPredictCode3({ getSchedule, hashOf, nowAt, refresh, refreshCalls, schedule, stateTable }) {
  {
    const client = createFakeSupabaseClient({
      tables: { scrape_job_state: stateTable("A") },
    });
    const failing = async () => {
      throw new Error("refresh-down");
    };
    let error = null;
    try {
      await checkPredictCodeChange({
        client,
        now: () => nowAt,
        hash: "B",
        refresh: failing,
        getSchedule,
      });
    } catch (e) {
      error = e;
    }
    check(
      "(h) 再生成の失敗: 例外を投げ、保存済みのハッシュを元（A）に戻す（次の起動が再試行できる）",
      error?.message === "refresh-down" && hashOf(client) === "A",
      `${error?.message} ${hashOf(client)}`,
    );
    const before = refreshCalls.length;
    const r = await checkPredictCodeChange({
      client,
      now: () => nowAt,
      hash: "B",
      refresh,
      getSchedule,
    });
    check(
      "(h) 次の起動で再試行して成功する",
      r.status === "regenerated" &&
        refreshCalls.length === before + 1 &&
        hashOf(client) === "B",
    );
  }
  {
    const before = refreshCalls.length;
    const client = createFakeSupabaseClient({
      tables: { scrape_job_state: stateTable("A") },
    });
    const r = await checkPredictCodeChange({
      client,
      now: () => nowAt,
      hash: "B",
      refresh,
      getSchedule: async () => schedule.slice(0, 1),
    });
    check(
      "(h) 発走前のレースが無い: 再生成せず、ハッシュだけ更新する",
      r.status === "regenerated" &&
        r.races === 0 &&
        refreshCalls.length === before &&
        hashOf(client) === "B",
    );
  }
}

async function mijb1Scene1() {
  T0 = jst("2026-09-21 05:00");
  // ---- 後半の場面（verifyData/morning-init-jobs-scenes-1.js・morning-init-jobs-scenes-2.js・morning-init-jobs-scenes-3.js） ----
  await runMorningInitJobsScenes1({ check, show, same, jst, DATE, JOB, newEnv, newDeps, range, T0, at });
  await runMorningInitJobsScenes2({ check, show, same, jst, DATE, fakeVenue, newEnv, newDeps, range, T0, at });
  await runMorningInitJobsScenes3({ check, show, same, jst, clone, GOLDEN_VENUE, DATE, JOB, newEnv, newDeps, T0, at });
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・jst・clone・GOLDEN_VENUE・DATE・JOB・fakeVenue・newEnv） */
export async function runMorningInitJobsScenesB1(env) {
  ({ check, show, same, jst, clone, GOLDEN_VENUE, DATE, JOB, fakeVenue, newEnv } = env);
  await mijb1Scene1();
}
