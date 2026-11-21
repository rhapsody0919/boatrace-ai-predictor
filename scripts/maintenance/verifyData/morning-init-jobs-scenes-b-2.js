/**
 * verify-morning-init-jobs.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-morning-init-jobs.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { validateRegistry, SCRAPE_JOBS } from "../../lib/scrapeJobs/registry.js";
import { createPredictCodeOnTick } from "../../lib/racesInit/job.js";
import {
  runMorningInitJobsScenes4,
  runMorningInitJobsScenes5,
  runMorningInitJobsScenes6,
} from "./morning-init-jobs-scenes-4.js";
import { T0, newDeps, mijPredictCode1, mijPredictCode2, mijPredictCode3, at } from "./morning-init-jobs-scenes-b-1.js";

let out, check, show, same, PCEXPECT_HTML, PCEXPECT_DIGEST, DATE, JOB, newEnv, mijPredictCode4, mijWiring2, mijWiring3, mijWiring4;

/** { の中身を割った 5/5 */
async function mijPredictCode5() {
  {
    // onTick: 共通ラッパは live のときだけ呼ぶ
    let ticks = 0;
    const onTick = createPredictCodeOnTick({
      check: async (args) => {
        ticks++;
        return {
          status: "unchanged",
          hasClient: !!args.client,
          hasNow: typeof args.now === "function",
          hasRefresh: typeof args.refresh === "function",
          hasSchedule: typeof args.getSchedule === "function",
        };
      },
    });
    const shadow = newEnv({ mode: "shadow" });
    await shadow.invoke(T0, { deps: newDeps({ venues: [] }).deps, onTick });
    const off = newEnv({ mode: "off" });
    await off.invoke(T0, { deps: newDeps().deps, onTick });
    const live = newEnv({ mode: "live" });
    const res = await live.invoke(T0, {
      deps: newDeps({ venues: [] }).deps,
      onTick,
    });
    check(
      "(h) onTick: live のときだけ、起動のたびに呼ばれる（shadow・off では呼ばれない）。client・now・refresh・getSchedule を渡す",
      ticks === 1 &&
        res.body.tick?.hasClient &&
        res.body.tick?.hasNow &&
        res.body.tick?.hasRefresh &&
        res.body.tick?.hasSchedule,
      show(res.body),
    );
  }
}

// ---------------------------------------------------------------------------
// (j) 配線・監視
// ---------------------------------------------------------------------------
/** { の中身を割った 1/4 */
function mijWiring1() {
  check(
    "(j) レジストリの整合性（validateRegistry）",
    same(validateRegistry(), []),
  );
  const def = SCRAPE_JOBS[JOB];
  check(
    "(j) races_init: 日次・05:00指定・リース=maxDuration=800秒・取得先 boatrace.jp",
    def.kind === "daily" &&
      def.targetTimeJst === "05:00" &&
      def.leaseSec === 800 &&
      def.maxDurationSec === 800 &&
      same(def.hosts, ["boatrace.jp"]),
  );
  const pc = SCRAPE_JOBS.pcexpect;
  check(
    "(j) pcexpect: 窓型・発走12時間前から30分前まで（許容幅690分）・再試行600秒・リース300秒・6件×3並列（設計どおり）",
    pc.kind === "window" &&
      same(pc.offsets, [-720]) &&
      pc.graceMin === 690 &&
      pc.retrySec === 600 &&
      pc.leaseSec === 300 &&
      pc.claimLimit === 6 &&
      pc.concurrency === 3,
  );
  return { def, pc };
}

async function mijb2Scene1() {
  {
    const { stateTable, nowAt, schedule, refreshCalls, refresh, getSchedule, hashOf } = await mijPredictCode1();
    await mijPredictCode2({ getSchedule, hashOf, nowAt, refresh, refreshCalls, stateTable });
    await mijPredictCode3({ getSchedule, hashOf, nowAt, refresh, refreshCalls, schedule, stateTable });
    mijPredictCode4();
    await mijPredictCode5();
  }
  // ---- 後半の場面（verifyData/morning-init-jobs-scenes-4.js） ----
  await runMorningInitJobsScenes4({ out, check, show, same, PCEXPECT_HTML, PCEXPECT_DIGEST, DATE, newEnv, newDeps, T0, at });
}

/** verify から呼ぶ入口。env は verify 側の束縛（out・check・show・same・PCEXPECT_HTML・PCEXPECT_DIGEST・DATE・JOB・newEnv・mijPredictCode4・mijWiring2・mijWiring3・mijWiring4） */
export async function runMorningInitJobsScenesB2(env) {
  ({ out, check, show, same, PCEXPECT_HTML, PCEXPECT_DIGEST, DATE, JOB, newEnv, mijPredictCode4, mijWiring2, mijWiring3, mijWiring4 } = env);
  await mijb2Scene1();
}

async function mijb2Scene2() {
  {
    const { def, pc } = mijWiring1();
    const { read } = mijWiring2();
    const { offenders } = mijWiring3({ def, pc, read });
    mijWiring4({ offenders });
  }
  // ---- 後半の場面（verifyData/morning-init-jobs-scenes-4.js） ----
  await runMorningInitJobsScenes5({ out, check, show, same, PCEXPECT_HTML, PCEXPECT_DIGEST, DATE, newEnv, newDeps, T0, at });
}

/** verify から呼ぶ入口。env は verify 側の束縛（out・check・show・same・PCEXPECT_HTML・PCEXPECT_DIGEST・DATE・JOB・newEnv・mijPredictCode4・mijWiring2・mijWiring3・mijWiring4） */
export async function runMorningInitJobsScenesB3(env) {
  ({ out, check, show, same, PCEXPECT_HTML, PCEXPECT_DIGEST, DATE, JOB, newEnv, mijPredictCode4, mijWiring2, mijWiring3, mijWiring4 } = env);
  await mijb2Scene2();
}

function mijb2Scene3() {
  // ---- 後半の場面（verifyData/morning-init-jobs-scenes-4.js） ----
  runMorningInitJobsScenes6({ out, check, show, same, PCEXPECT_HTML, PCEXPECT_DIGEST, DATE, newEnv, newDeps, T0, at });
}

/** verify から呼ぶ入口。env は verify 側の束縛（out・check・show・same・PCEXPECT_HTML・PCEXPECT_DIGEST・DATE・JOB・newEnv・mijPredictCode4・mijWiring2・mijWiring3・mijWiring4） */
export function runMorningInitJobsScenesB4(env) {
  ({ out, check, show, same, PCEXPECT_HTML, PCEXPECT_DIGEST, DATE, JOB, newEnv, mijPredictCode4, mijWiring2, mijWiring3, mijWiring4 } = env);
  mijb2Scene3();
}
