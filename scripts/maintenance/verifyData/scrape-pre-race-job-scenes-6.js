/**
 * verify-scrape-pre-race-job.js の後半の場面（6/6）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-pre-race-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { createExhibitionSlotHandler } from "../../lib/scrapeJobs/preRaceHandlers.js";
import { runScrapeJob } from "../../lib/scrapeJobs/cronWrapper.js";
import { computeRetryAt } from "../../lib/scrapeJobs/outcomes.js";
import { SCRAPE_JOBS, nextPollTime, validateRegistry } from "../../lib/scrapeJobs/registry.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";

let printOut, check, show, DATE, RACE, freshDb, createFetcher, pagesHandler, slotOf;

/** 元の verify の1つの塊 { } を割った 1/4 */
async function scene1() {
  const ex = SCRAPE_JOBS.exhibition;
  const DEADLINE = new Date(`${DATE}T14:21:00+09:00`);
   // RACE（12R）の締切
  const at = (minBefore, sec = 0) =>
    new Date(DEADLINE.getTime() - minBefore * 60000 - sec * 1000);
  /**
   * -33 のスロット1件を、窓の始まり（締切33分前）から窓の終わり（7分前）まで、ハンドラーの retryAt（無ければ
   * ラッパと同じ computeRetryAt の retrySec）に従って、毎分の Cron の起動（分の頭）で取り直す。
   * publishedMinBefore 分前に公開されたとして、取得の回数と取れた時刻（締切の何分前）を返す
   */
  const simulate = async ({
    pollMinBefore,
    publishedMinBefore,
    cronDelaySec = 0,
  }) => {
    let t = at(33);
    const end = at(7);
    let fetches = 0;
    let claims = 0;
    let doneMinBefore = null;
    const handler = createExhibitionSlotHandler({
      pollMinBefore,
      loadSchedule: async () => [{ race_id: RACE, start_time: DEADLINE }],
      run: async () => {
        fetches++;
        const mb = (DEADLINE.getTime() - t.getTime()) / 60000;
        return [
          {
            race_id: RACE,
            outcome: mb <= publishedMinBefore ? "ok" : "no_values",
            rowsWritten: 0,
          },
        ];
      },
    });
    while (t <= end) {
      claims++;
      const res = await handler(
        {
          job: "exhibition",
          race_id: RACE,
          offset_min: -33,
          last_attempt_at: t.toISOString(),
        },
        {
          now: () => t,
          mode: "live",
          politeFetch: () => {
            throw new Error("no fetch");
          },
        },
      );
      if (res.outcome === "ok") {
        doneMinBefore = (DEADLINE.getTime() - t.getTime()) / 60000;
        break;
      }
      const next =
        res.retryAt ??
        computeRetryAt({ now: t, claimedAt: t, retrySec: ex.retrySec });
      // 毎分の Cron: next 以降の最初の分の頭（から cronDelaySec 遅れて起動）。ループの条件 t <= end は、
      // claim_scrape_slots（075）の「期限＋許容幅 < now なら claim の前に expired」と同じ判定
      t = new Date(
        Math.ceil((next.getTime() - cronDelaySec * 1000) / 60000) * 60000 +
          cronDelaySec * 1000,
      );
    }
    return { fetches, claims, doneMinBefore };
  };
  const notYet = await simulate({
    pollMinBefore: ex.pollMinBefore,
    publishedMinBefore: 0,
  });
  check(
    "予定の時刻（20・16・13・10・8分前）: 公開されないままなら、窓の中で取得は5回だけ（120秒おきなら13回）。最初の claim（33分前）は取得しない",
    show(ex.pollMinBefore) === show([20, 16, 13, 10, 8]) &&
      notYet.fetches === 5,
    show(notYet),
  );
  const median = await simulate({
    pollMinBefore: ex.pollMinBefore,
    publishedMinBefore: 16.4,
  });
  return { ex, DEADLINE, at, simulate, median };
}

/** 元の verify の1つの塊 { } を割った 2/4 */
async function scene2({ ex, DEADLINE, at, simulate, median }) {
  const late = await simulate({
    pollMinBefore: ex.pollMinBefore,
    publishedMinBefore: 8.43,
  });
  check(
    "予定の時刻: 中央値（16.4分前に公開）は2回目（16分前）で取れる。実測で最も遅い公開（8.43分前）も、締切8分前の最後の予定で取れる",
    median.fetches === 2 &&
      median.doneMinBefore === 16 &&
      late.fetches === 5 &&
      late.doneMinBefore === 8,
    show({ median, late }),
  );
  // 毎分の Cron の起動が分の頭から数秒遅れても、予定の全ての取得が claim できる（窓の終わり＝7分前の予定は、
  // 数秒の遅れで claim の前に expired になる。Codex の指摘、BOA-1145）
  {
    const delayed = await simulate({
      pollMinBefore: ex.pollMinBefore,
      publishedMinBefore: 0,
      cronDelaySec: 5,
    });
    const withSeven = await simulate({
      pollMinBefore: [...ex.pollMinBefore, 7],
      publishedMinBefore: 0,
      cronDelaySec: 5,
    });
    check(
      "予定の時刻: Cron の起動が5秒遅れても、予定の全ての取得（5回）が窓の終わり（7分前。claim_scrape_slots の期限＋許容幅）より前に claim される。7分前を足した版は、7分前の取得が期限切れで消える（検出できる）",
      delayed.fetches === ex.pollMinBefore.length &&
        withSeven.fetches < ex.pollMinBefore.length + 1,
      show({ delayed, withSeven }),
    );
  }
  const legacy = await simulate({ pollMinBefore: null, publishedMinBefore: 0 });
  check(
    "変異検証: 予定の時刻を外した版（120秒おき）では、取得が5回を超える（『5回だけ』の検証が失敗する）",
    legacy.fetches > 5,
    show(legacy),
  );
  // 最初の予定より前の claim: 取得せず not_due・試行回数を戻す・retryAt は20分前の10秒前
  {
    const store = createMemoryStore({
      rows: {
        exhibition: {
          job: "exhibition",
          mode: "live",
          consecutive_failures: 0,
        },
      },
      slots: [
        slotOf("exhibition", RACE, -33, {
          last_attempt_at: at(33).toISOString(),
          lease_until: at(33, -90).toISOString(),
        }),
      ],
    });
    const fetcher = createFetcher(pagesHandler());
    const r = await runScrapeJob({
      job: "exhibition",
      store,
      handleSlot: createExhibitionSlotHandler(),
      now: () => at(33),
      worker: "test:exhibition",
      client: freshDb(),
      politeFetch: fetcher,
    });
    const retried = store.retried[0];
    check(
      "ラッパ A2: 締切20分前より前に claim した -33 のスロットは、公式へ取りに行かず not_due・試行回数を戻して、20分前（の10秒前）まで pending に戻す。起動の成功の記録にも数えない",
      fetcher.calls.length === 0 &&
        retried?.outcome === "not_due" &&
        retried?.releaseAttempt === true &&
        new Date(retried.retryAt).getTime() === at(20, 10).getTime() &&
        r.status === 200 &&
        !store.calls.some((c) => c.name === "recordSuccess"),
      show({ retried, body: r.body }),
    );
  }
  return { ex, DEADLINE, at };
}

/** 元の verify の1つの塊 { } を割った 3/4 */
function scene3({ ex, DEADLINE, at }) {
  check(
    "nextPollTime: 20分前の予定で処理したら次は16分前、8分前の後は次なし（窓の終わりまで取りに行かない）。最初の予定の30秒前（時計のずれ）までは due、21分前は due でない",
    nextPollTime(ex.pollMinBefore, {
      deadline: DEADLINE,
      now: at(20, 10),
    }).nextAt?.getTime() === at(16, 10).getTime() &&
      nextPollTime(ex.pollMinBefore, { deadline: DEADLINE, now: at(8, 10) })
        .nextAt === null &&
      nextPollTime(ex.pollMinBefore, { deadline: DEADLINE, now: at(20, 30) })
        .due === true &&
      nextPollTime(ex.pollMinBefore, { deadline: DEADLINE, now: at(21) })
        .due === false,
  );
  check(
    "レジストリ exhibition（BOA-1145）: claimLimit 8・concurrency 1・leaseSec 110（403 の後、その起動の残りを叩かない）、breakerUrls に beforeinfo、検査は正常",
    ex.claimLimit === 8 &&
      ex.leaseSec === 110 &&
      ex.concurrency === 1 &&
      show(ex.breakerUrls) ===
        show(["https://www.boatrace.jp/owpc/pc/race/beforeinfo"]) &&
      validateRegistry().length === 0,
    show(validateRegistry()),
  );
  const bad = (patch) =>
    validateRegistry({ exhibition: { ...ex, ...patch } }).length > 0;
  return { bad };
}

/** 元の verify の1つの塊 { } を割った 4/4 */
function scene4({ bad }) {
  check(
    "レジストリの検査: pollMinBefore が降順でない・窓の外（33分前より前・窓の終わり7分前の1分前＝8分前より後）・空・整数でない、breakerUrls が URL でない、は不正",
    bad({ pollMinBefore: [10, 20] }) &&
      bad({ pollMinBefore: [20, 8, 7] }) &&
      bad({ pollMinBefore: [40, 10] }) &&
      bad({ pollMinBefore: [20, 5] }) &&
      bad({ pollMinBefore: [] }) &&
      bad({ pollMinBefore: [20.5] }) &&
      bad({ breakerUrls: ["beforeinfo"] }) &&
      !bad({}),
  );
}

async function scene5() {
  {
    const s1 = await scene1();
    const s2 = await scene2(s1);
    const s3 = scene3(s2);
    scene4(s3);
  }
  printOut("");
}

/** verify から呼ぶ入口。env は verify 側の束縛（printOut・check・show・DATE・RACE・freshDb・createFetcher・pagesHandler・slotOf） */
export async function runScrapePreRaceJobScenes7(env) {
  ({ printOut, check, show, DATE, RACE, freshDb, createFetcher, pagesHandler, slotOf } = env);
  await scene5();
}

function scene6() {
  printOut("✅ すべての検証に成功しました");
}

/** verify から呼ぶ入口。env は verify 側の束縛（printOut・check・show・DATE・RACE・freshDb・createFetcher・pagesHandler・slotOf） */
export function runScrapePreRaceJobScenes8(env) {
  ({ printOut, check, show, DATE, RACE, freshDb, createFetcher, pagesHandler, slotOf } = env);
  scene6();
}
