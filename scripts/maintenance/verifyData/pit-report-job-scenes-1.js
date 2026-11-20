/**
 * verify-pit-report-job.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-pit-report-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  PIT_REPORT_JOB,
  createPitReportSlotHandler,
  processPitReportRace,
  createPitReportStore,
} from "../../lib/pitReportJob.js";
import { runScrapeJob } from "../../lib/scrapeJobs/cronWrapper.js";
import { SCRAPE_JOBS } from "../../lib/scrapeJobs/registry.js";
import { isFinalOutcome } from "../../lib/scrapeJobs/outcomes.js";
import { computeWindowStats } from "../../lib/scrapeJobs/monitor.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import {
  freshClient,
  show,
  G1_RACE,
  PENDING,
  FINAL_DAY,
  createFakeClient,
} from "./pit-report-job-fixtures.js";

let check, SLOT, NOW, runWrapped;

/** 変異で壊れた版は、評価の途中で例外になることがある。例外も「検証が失敗した」として数える */
export const safeEval = async (fn) => {
  try {
    return await fn();
  } catch (e) {
    return [`例外: ${e.message}`];
  }
};

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene1() {
  const fetched = { count: 0 };
  const client = freshClient();
  const off = await runWrapped({ mode: "off", client, fetched });
  check(
    "(d) off: 何も取得せず、DBにも予定表にも書かない",
    off.result.body.skipped === "mode_off" &&
      fetched.count === 0 &&
      client.calls.length === 0 &&
      off.store.completed.length === 0 &&
      off.store.retried.length === 0,
  );
  const noRow = await runWrapped({ rows: {}, client, fetched });
  check(
    "(d) 行なし: off として扱い、何も取得しない（行を作るのみ）",
    noRow.result.body.skipped === "mode_off" &&
      fetched.count === 0 &&
      client.calls.length === 0 &&
      noRow.store.state.get(PIT_REPORT_JOB)?.mode === "off",
  );
  const shadow = await runWrapped({ mode: "shadow", client, fetched });
  return { fetched, client, shadow };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene2({ fetched, client, shadow }) {
  check(
    "(d) shadow: 取得・解析のみ。データにもStorageにも書かず、予定表に result_digest を残す",
    fetched.count === 1 &&
      client.calls.length === 0 &&
      client.uploads.length === 0 &&
      shadow.store.completed.length === 1 &&
      shadow.store.completed[0].outcome === "ok" &&
      shadow.store.completed[0].resultDigest?.length === 64 &&
      shadow.store.completed[0].rowsWritten === 0,
  );
  const live = await runWrapped({ mode: "live", client, fetched });
  check(
    "(d) live: 書き込み、予定表を完了にする",
    client.state.race_pit_comments.length === 6 &&
      live.store.completed.length === 1 &&
      live.store.completed[0].rowsWritten === 7,
  );
  {
    // 未公開のレース: 発走まで150分。再試行は10分間隔（claim した時刻から590秒後）で、共通ラッパの既定（300秒）を上書きする
    const claimedAt = "2026-09-18T13:59:30+09:00";
    const store = createMemoryStore({
      rows: {
        [PIT_REPORT_JOB]: {
          job: PIT_REPORT_JOB,
          mode: "live",
          consecutive_failures: 0,
        },
      },
      slots: [{ ...SLOT, last_attempt_at: claimedAt }],
    });
    await runScrapeJob({
      job: PIT_REPORT_JOB,
      store,
      now: NOW,
      client: freshClient(),
      politeFetch: async () => {
        throw new Error("使わない");
      },
      handleSlot: createPitReportSlotHandler({
        load: async () => ({
          ...G1_RACE,
          race_date: "2026-09-18",
          start_time: "16:30:00",
        }),
        process: (p) =>
          processPitReportRace({ ...p, fetchHtml: async () => PENDING }),
      }),
    });
    const retried = store.retried[0];
    check(
      "(d) 未公開: 発走までの時間に応じた間隔（150分前→10分）で再試行する",
      store.retried.length === 1 &&
        retried.outcome === "no_values" &&
        new Date(retried.retryAt).getTime() ===
          new Date(claimedAt).getTime() + 590 * 1000,
      show(retried?.retryAt),
    );
  }
}

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene3() {
  const races = [];
  for (let n = 1; n <= 12; n++) {
    const t = `${String(10 + Math.floor(n / 2)).padStart(2, "0")}:${n % 2 ? "05" : "40"}:00`;
    races.push({
      race_id: `2026-09-21-01-${String(n).padStart(2, "0")}`,
      race_date: "2026-09-21",
      race_number: n,
      race_grade: "SG",
      start_time: t,
    });
    races.push({
      race_id: `2026-09-21-05-${String(n).padStart(2, "0")}`,
      race_date: "2026-09-21",
      race_number: n,
      race_grade: "G1",
      start_time: t,
    });
    races.push({
      race_id: `2026-09-21-17-${String(n).padStart(2, "0")}`,
      race_date: "2026-09-21",
      race_number: n,
      race_grade: "G3",
      start_time: t,
    });
    races.push({
      race_id: `2026-09-21-03-${String(n).padStart(2, "0")}`,
      race_date: "2026-09-21",
      race_number: n,
      race_grade: "ippan",
      start_time: t,
    });
  }
  races.push({
    race_id: "2026-09-21-09-01",
    race_date: "2026-09-21",
    race_number: 1,
    race_grade: "SG",
    start_time: null,
  });
  const client = createFakeClient({ tables: { races, scrape_slots: [] } });
  // 期限が過ぎていない時刻（朝）
  const store = createPitReportStore(client, { base: {} });
  const created = await store.ensureSlots({
    date: "2026-09-21",
    jobs: [PIT_REPORT_JOB],
    now: new Date("2026-09-21T07:00:00+09:00"),
  });
  const slots = client.state.scrape_slots;
  const ids = slots.map((s) => s.race_id);
  check(
    "(e) 予定表: SG全12レース＋G1の7R〜12R（6レース）の18件だけを作る",
    created === 18 && slots.length === 18,
    `created=${created}`,
  );
  check(
    "(e) 予定表: G3・一般戦・発走時刻なしのスロットは作らない",
    !ids.some((id) => ["17", "03", "09"].includes(id.split("-")[3])),
  );
  check(
    "(e) 予定表: G1の1R〜6Rは作らない・SGの1Rは作る",
    !ids.includes("2026-09-21-05-06") &&
      ids.includes("2026-09-21-05-07") &&
      ids.includes("2026-09-21-01-01"),
  );
  check(
    "(e) 予定表: job・offset・race_date を持ち、二重生成は ignoreDuplicates",
    slots.every(
      (s) =>
        s.job === PIT_REPORT_JOB &&
        s.offset_min === SCRAPE_JOBS.pit_reports.offsets[0] &&
        s.race_date === "2026-09-21",
    ) && client.calls.at(-1).opts.ignoreDuplicates === true,
  );
  return { races, client, store };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene4({ races, client, store }) {
  const again = await store.ensureSlots({
    date: "2026-09-21",
    jobs: [PIT_REPORT_JOB],
    now: new Date("2026-09-21T07:00:00+09:00"),
  });
  check(
    "(e) 予定表: 2回目は増えない（冪等）",
    (client.state.scrape_slots.length === 18 &&
      again ===
        18) /* 偽クライアントは returning で件数を返す。実DBは新規のみ */ ||
      client.state.scrape_slots.length === 18,
  );
  const lateClient = createFakeClient({ tables: { races, scrape_slots: [] } });
  const late = await createPitReportStore(lateClient, { base: {} }).ensureSlots(
    {
      date: "2026-09-21",
      jobs: [PIT_REPORT_JOB],
      now: new Date("2026-09-22T09:00:00+09:00"),
    },
  );
  check(
    "(e) 予定表: 期限＋許容幅を過ぎたレースのスロットは作らない（有効化が遅い日の一斉 expired を防ぐ）",
    late === 0 && lateClient.state.scrape_slots.length === 0,
  );
  const failClient = createFakeClient({
    tables: { races: [] },
    failOps: { "races:select": "db down" },
  });
  let threw = false;
  try {
    await createPitReportStore(failClient, { base: {} }).ensureSlots({
      date: "2026-09-21",
      jobs: [PIT_REPORT_JOB],
    });
  } catch (e) {
    threw = /db down/.test(e.message);
  }
  check("(e) 予定表: races の取得失敗は、対象なしに化けさせず例外", threw);
}

async function scene5() {
  {
    const s1 = await scene1();
    await scene2(s1);
  }
  {
    // 対象外で終端（最終日のG1 7R）は完了。未公開は再試行
    const store = createMemoryStore({
      rows: {
        [PIT_REPORT_JOB]: {
          job: PIT_REPORT_JOB,
          mode: "live",
          consecutive_failures: 0,
        },
      },
      slots: [
        { ...SLOT, race_id: "2026-09-21-05-07" },
        { ...SLOT, race_id: "2026-09-21-05-12" },
      ],
    });
    const client = freshClient();
    await runScrapeJob({
      job: PIT_REPORT_JOB,
      store,
      now: NOW,
      client,
      politeFetch: async () => {
        throw new Error("使わない");
      },
      handleSlot: createPitReportSlotHandler({
        load: async (_c, id) => ({
          race_grade: "G1",
          race_number: Number(id.slice(-2)),
        }),
        process: (p) =>
          processPitReportRace({
            ...p,
            fetchHtml: async () =>
              p.raceId.endsWith("07") ? FINAL_DAY : PENDING,
          }),
      }),
    });
    const byRace = Object.fromEntries([
      ...store.completed.map((c) => [c.slot.race_id, "done:" + c.outcome]),
      ...store.retried.map((c) => [c.slot.race_id, "retry:" + c.outcome]),
    ]);
    check(
      "(d) 対象外で終端は完了（skipped_not_target）・未公開は再試行（no_values）",
      byRace["2026-09-21-05-07"] === "done:skipped_not_target" &&
        byRace["2026-09-21-05-12"] === "retry:no_values",
      show(byRace),
    );
    check(
      "(d) skipped_not_target は完了の outcome",
      isFinalOutcome("skipped_not_target") &&
        isFinalOutcome("ok") &&
        !isFinalOutcome("no_values"),
    );
    const mk = (outcome, doneAt) => ({
      job: PIT_REPORT_JOB,
      race_id: "r",
      offset_min: -60,
      race_date: "2026-09-21",
      status: "done",
      outcome,
      run_mode: "live",
      done_at: doneAt,
      races: { start_time: "16:30:00", cancellation_status: null },
    });
    const stats = computeWindowStats([
      mk("ok", "2026-09-21T06:00:00Z"),
      mk("skipped_not_target", "2026-09-21T06:00:00Z"),
    ]);
    check(
      "(d) 監視: skipped_not_target は窓内取得率の分母に入れない",
      stats.length === 1 && stats[0].total === 1,
      show(stats),
    );
  }
  {
    const s1 = await scene3();
    await scene4(s1);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・SLOT・NOW・runWrapped） */
export async function runPitReportJobScenes1(env) {
  ({ check, SLOT, NOW, runWrapped } = env);
  await scene5();
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・SLOT・NOW・runWrapped） */
export function runPitReportJobScenes2(env) {
  ({ check, SLOT, NOW, runWrapped } = env);

}
