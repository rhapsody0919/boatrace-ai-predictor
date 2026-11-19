/**
 * verify-scrape-pre-race-job.js の後半の場面（4/6）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-pre-race-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { runForRaces as realRaceInfoRun } from "../../daily/update-race-info.js";
import { runForRaces as realExhibitionRun } from "../../daily/scrape-exhibition-data.js";
import { computeRaceInfoDigest } from "../../lib/scrapeJobs/preRaceDigest.js";
import { runSlotsWithRefresh, createExhibitionSlotHandler } from "../../lib/scrapeJobs/preRaceHandlers.js";
import { runScrapeJob } from "../../lib/scrapeJobs/cronWrapper.js";
import { SCRAPE_JOBS } from "../../lib/scrapeJobs/registry.js";
import { BreakerOpenError } from "../../lib/scrapeJobs/circuitBreaker.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { splitCatchupSlots } from "../check-pre-race-shadow.js";
import { exhibitionSlot, catchupSkipsHaveData, catchupShadowWritesNothing, catchupWritesNoWeather, catchupIsNotRefreshed, catchupRetriesSlowly } from "./scrape-pre-race-job-scenes-3.js";
import { SUMI_URL, PRIMARY_OFFSET, upsertedTables, sumiDbWithData, CATCHUP_OFFSET, sumiFetcher } from "./scrape-pre-race-job-scenes-2.js";
import { ENV_ON } from "./scrape-pre-race-job-scenes-1.js";

let check, show, BEFORE_UNPUBLISHED_HTML, DATE, SUMI_RACE, RACE, NOW, freshDb, createFetcher, pagesHandler, upsertsOf, raceInfoShadowWritesNothing, raceInfoFetchesOnlyRacelist, exhibitionShadowWritesNothing, slotOf;

// ---------------------------------------------------------------------------
// (k) 体重だけの窓（BOA-500。展示の発走60分前のスロット。レジストリの exhibition の weightOnlyOffsets）
// ---------------------------------------------------------------------------
export const WEIGHT_OFFSET = SCRAPE_JOBS.exhibition.weightOnlyOffsets[0];

export const preExhibitionFetcher = () => sumiFetcher(BEFORE_UNPUBLISHED_HTML);

/** 元の verify の1つの塊 { } を割った 1/4 */
async function scene1() {
  // 実ページ: 発走の後の住之江5Rから、展示タイム・展示STを解析して書く
  const live = await exhibitionSlot({ mode: "live" });
  const rows = upsertsOf(live.db, "exhibition_data").flatMap((u) => u.rows);
  const boat1 = rows.find((row) => row.boat_number === 1);
  check(
    "補完 live（実ページ。発走後の住之江5R）: beforeinfo を1回だけ取得し、展示データ6行を書き、outcome=ok で完了する。1号艇の展示タイム 6.89・展示ST 0.10",
    live.store.completed[0]?.outcome === "ok" &&
      live.store.completed[0].rowsWritten === 6 &&
      live.fetcher.calls.length === 1 &&
      live.fetcher.calls[0].includes(SUMI_URL) &&
      rows.length === 6 &&
      boat1?.exhibition_time === 6.89 &&
      boat1?.start_timing === 0.1 &&
      rows.every((row) => row.race_id === SUMI_RACE),
    show({
      completed: live.store.completed[0],
      calls: live.fetcher.calls,
      boat1,
    }),
  );
  check(
    "補完 live: 展示タイムが取得済みなら、shadow でも live でも、取得しない（公式ページへのリクエスト0・書き込み0。skipped_have_data で完了）",
    await catchupSkipsHaveData(),
  );
  check(
    "補完 shadow: 取得・解析のみで、DBへ一切書かない。ダイジェストを予定表に記録して、完了する（rowsWritten=0）",
    await catchupShadowWritesNothing(),
  );
  check(
    "補完 live: 気象（race_conditions）を書かない（発走後のページは、そのレースの発走前ではなく、その日の最新の観測を表示するため）",
    await catchupWritesNoWeather(),
  );
  check(
    "補完: 予測の再計算の対象にしない（変更を書いても、onChanged を呼ばない。発走後に予測を作り直して、的中率の突き合わせを汚さない）",
    await catchupIsNotRefreshed(),
  );
  check(
    "補完: 未完了（展示が未公開）の再試行は600秒おき（-33 のスロットは120秒おき）。予定表の完了・再試行の記録の意味は変えない",
    await catchupRetriesSlowly(),
  );
  // -33 のスロット（従来の挙動）は、変えない
  const primaryLive = await exhibitionSlot({
    mode: "live",
    offset: PRIMARY_OFFSET,
  });
  check(
    "従来の -33 のスロット live: 展示データと気象（race_conditions）を書き、変更を書いたレースを再計算の対象にする（補完で変えていない）",
    upsertedTables(primaryLive.db).includes("exhibition_data") &&
      upsertedTables(primaryLive.db).includes("race_conditions") &&
      primaryLive.changed.length === 1 &&
      primaryLive.changed[0] === SUMI_RACE,
    show({
      tables: upsertedTables(primaryLive.db),
      changed: primaryLive.changed,
    }),
  );
  const primaryShadow = await exhibitionSlot({
    mode: "shadow",
    offset: PRIMARY_OFFSET,
    db: sumiDbWithData(),
  });
  return { primaryShadow };
}

/** 元の verify の1つの塊 { } を割った 2/4 */
async function scene2({ primaryShadow }) {
  check(
    "従来の -33 のスロット shadow: 取得済みでも、取得・解析する（既存の経路が書いた行と比べるため。補完だけが、取得済みをスキップする）",
    primaryShadow.fetcher.calls.length === 1 &&
      primaryShadow.store.completed[0]?.outcome === "ok",
    show(primaryShadow.store.completed),
  );
  // 通信エラー・ブレーカー: 補完の再試行の間隔・ブレーカーの retryAt
  const until = NOW.getTime() + 120000;
  const brk = await exhibitionSlot({
    mode: "live",
    fetcher: createFetcher(
      () => new BreakerOpenError("host:boatrace.jp", until),
    ),
  });
  const http = await exhibitionSlot({
    mode: "live",
    fetcher: createFetcher(() => 503),
  });
  check(
    "補完: ブレーカーが開いていれば、ブレーカーの retryAt で再試行する（補完の間隔で上書きしない）。通信エラーは、補完の間隔（590秒後）で再試行する",
    brk.store.retried[0]?.outcome === "breaker_open" &&
      new Date(brk.store.retried[0].retryAt).getTime() === until &&
      http.store.retried[0]?.outcome === "error" &&
      new Date(http.store.retried[0].retryAt).getTime() ===
        NOW.getTime() + 590000,
    show({ brk: brk.store.retried[0], http: http.store.retried[0] }),
  );
  // 補完は、スケジュール（races）を読まない（気象を書かないため）。読み取りは、取得済みの確認（exhibition_data）だけ
  const noSchedule = await exhibitionSlot({ mode: "live" });
  check(
    "補完: races（スケジュール）を読まない。DBの読み取りは、展示タイムの取得済みの確認（exhibition_data）と、書き込み前のスキーマの確認だけ",
    !noSchedule.db.state.selects.some((sel) => sel.table === "races"),
    show(noSchedule.db.state.selects.map((sel) => sel.table)),
  );
  // 予測の再計算（案1）: -33 のスロットの変更だけが対象。補完の変更は対象にしない
  const refreshCalls = [];
  const optionsSeen = [];
  const spyRun = async (races, options) => {
    optionsSeen.push({ race_id: races[0].race_id, options });
    return races.map((race) => ({
      race_id: race.race_id,
      outcome: "ok",
      rowsWritten: 6,
      rowsParsed: 6,
      rowsExpected: 6,
      changed: true,
    }));
  };
  return { refreshCalls, optionsSeen, spyRun };
}

/** 元の verify の1つの塊 { } を割った 3/4 */
async function scene3({ refreshCalls, optionsSeen, spyRun }) {
  const refreshRun = async (catchup) => {
    refreshCalls.length = 0;
    optionsSeen.length = 0;
    const store = createMemoryStore({
      rows: {
        exhibition: {
          job: "exhibition",
          mode: "live",
          consecutive_failures: 0,
        },
      },
      slots: [
        slotOf("exhibition", RACE, PRIMARY_OFFSET),
        slotOf("exhibition", SUMI_RACE, CATCHUP_OFFSET),
      ],
    });
    const { body } = await runSlotsWithRefresh({
      job: "exhibition",
      createHandleSlot: (collector) =>
        createExhibitionSlotHandler({
          run: spyRun,
          loadSchedule: async () => [],
          onChanged: collector.onChanged,
          ...(catchup ? { catchup } : {}),
        }),
      refresh: async (args) => {
        refreshCalls.push(args);
      },
      client: freshDb(),
      store,
      env: ENV_ON,
      runJob: (options) =>
        runScrapeJob({
          ...options,
          now: () => NOW,
          worker: "test:exhibition",
          politeFetch: createFetcher(pagesHandler()),
        }),
    });
    return { body, calls: [...refreshCalls], seen: [...optionsSeen] };
  };
  const refreshed = await refreshRun();
  const seenOf = (id) => refreshed.seen.find((x) => x.race_id === id)?.options;
  check(
    "案1: REFRESH_ON_VERCEL=true のとき、-33 のスロットの変更を書いたレースだけを再計算する（補完で書いたレースは、発走後のため再計算しない）。補完の呼び出しは catchup=true・気象なし・スケジュールなし、-33 は従来どおり（スケジュールあり）",
    refreshed.calls.length === 1 &&
      show(refreshed.calls.flatMap((c) => c.specificRaceIds)) ===
        show([RACE]) &&
      refreshed.calls[0].date === DATE &&
      seenOf(SUMI_RACE)?.catchup === true &&
      seenOf(SUMI_RACE)?.updateWeather === false &&
      !("schedule" in seenOf(SUMI_RACE)) &&
      !("catchup" in seenOf(RACE)) &&
      Array.isArray(seenOf(RACE)?.schedule),
    show({ calls: refreshed.calls, body: refreshed.body }),
  );
  // 補完のスロットの集計（check-pre-race-shadow.js）
  const split = splitCatchupSlots(
    [
      { offset_min: -33, race_id: "a" },
      { offset_min: 10, race_id: "b" },
      { offset_min: -60, race_id: "w" },
    ],
    SCRAPE_JOBS.exhibition,
  );
  const splitOther = splitCatchupSlots(
    [{ offset_min: 5, race_id: "c" }],
    SCRAPE_JOBS.result,
  );
  return { refreshRun, split, splitOther };
}

/** 元の verify の1つの塊 { } を割った 4/4 */
async function scene4({ refreshRun, split, splitOther }) {
  check(
    "check-pre-race-shadow: スロットを、通常の窓と、窓の外の補完（catchupOffsets）と、体重だけの窓（weightOnlyOffsets）に分ける。どちらも持たないジョブは、全て通常の窓",
    split.primary.length === 1 &&
      split.primary[0].race_id === "a" &&
      split.catchup.length === 1 &&
      split.catchup[0].race_id === "b" &&
      // 体重だけの窓（BOA-500）も、通常の窓の一致率に混ぜない（展示前のページのダイジェストは、展示後の行と一致しない）
      split.weightOnly.length === 1 &&
      split.weightOnly[0].race_id === "w" &&
      splitOther.primary.length === 1 &&
      splitOther.catchup.length === 0,
  );
  // 変異検証: 仕込んだ版で、上の検証が失敗する
  const dropCatchup = (run) => (races, options) =>
    run(races, { ...options, catchup: false });
  const asLiveRun = (run) => (races, options) =>
    run(races, { ...options, mode: "live" });
  const withWeatherRun = (run) => (races, options) =>
    run(races, {
      ...options,
      catchup: false,
      updateWeather: true,
      schedule: [],
    });
  check(
    "変異検証の前提: 正しい実装は、補完の各検証（取得済みのスキップ・shadow で書かない・気象を書かない・再計算しない・再試行の間隔）に合格する",
    (await catchupSkipsHaveData()) &&
      (await catchupShadowWritesNothing()) &&
      (await catchupWritesNoWeather()) &&
      (await catchupIsNotRefreshed()) &&
      (await catchupRetriesSlowly()),
  );
  check(
    "変異検証: 「補完が、取得済みを再取得する（shadow で取得済みをスキップしない）」版では、『取得済みを取得しない』検証が失敗する",
    !(await catchupSkipsHaveData(dropCatchup(realExhibitionRun))),
  );
  check(
    "変異検証: 「補完が、shadow でも書く」版では、『shadow は書かない』検証が失敗する",
    !(await catchupShadowWritesNothing(asLiveRun(realExhibitionRun))),
  );
  check(
    "変異検証: 「補完が、気象を書く」版では、『気象を書かない』検証が失敗する",
    !(await catchupWritesNoWeather(withWeatherRun(realExhibitionRun))),
  );
  const notCatchup = { isCatchup: () => false, retrySec: 600 };
  check(
    "変異検証: 「補完を、通常のスロットとして扱う（再計算の対象にする）」版では、『再計算の対象にしない』検証が失敗する",
    !(await catchupIsNotRefreshed(notCatchup)),
  );
  check(
    "変異検証: 「補完の再試行が、-33 と同じ120秒」版では、『再試行は600秒おき』検証が失敗する",
    !(await catchupRetriesSlowly({
      isCatchup: (offset) => offset === CATCHUP_OFFSET,
      retrySec: SCRAPE_JOBS.exhibition.retrySec,
    })),
  );
  const mutantRefresh = await refreshRun(notCatchup);
  check(
    "変異検証: 「補完で書いたレースも再計算する」版では、mainRefresh の対象に補完のレースが入り、『補完は再計算しない』検証が失敗する",
    show(mutantRefresh.calls.flatMap((c) => c.specificRaceIds).sort()) ===
      show([RACE, SUMI_RACE].sort()),
    show(mutantRefresh.calls),
  );
}

async function scene5() {
  {
    const s1 = await scene1();
    const s2 = await scene2(s1);
    const s3 = await scene3(s2);
    await scene4(s3);
  }
  // ---------------------------------------------------------------------------
  // (i) 変異検証（shadow が書く・気象のために beforeinfo を取る・ダイジェストが選手を無視する）
  // ---------------------------------------------------------------------------
  {
    check(
      "変異検証の前提: 正しい実装は、shadow が書かない検証（A1・A2）と、出走表だけを取る検証（A1）に合格する",
      (await raceInfoShadowWritesNothing(realRaceInfoRun)) &&
        (await exhibitionShadowWritesNothing(realExhibitionRun)) &&
        (await raceInfoFetchesOnlyRacelist(realRaceInfoRun)),
    );
    const asLive = (run) => (races, options) =>
      run(races, { ...options, mode: "live" });
    check(
      "変異検証: 「shadow でも書く」版（A1）では、『shadow が書かない』検証が失敗する",
      !(await raceInfoShadowWritesNothing(asLive(realRaceInfoRun))),
    );
    check(
      "変異検証: 「shadow でも書く」版（A2）では、『shadow が書かない』検証が失敗する",
      !(await exhibitionShadowWritesNothing(asLive(realExhibitionRun))),
    );
    const withWeather = (run) => (races, options) =>
      run(races, { ...options, includeWeather: true });
    check(
      "変異検証: 「気象のために beforeinfo も取る（D2を戻す）」版では、『出走表だけを取る』検証が失敗する",
      !(await raceInfoFetchesOnlyRacelist(withWeather(realRaceInfoRun))),
    );
    // ダイジェストが選手を無視する版（艇の列を空にして計算）
    const blindDigest = ({ condition, raceGrade }) =>
      computeRaceInfoDigest({ entries: [], condition, raceGrade });
    const a = blindDigest({
      entries: [{ boat_number: 1, racer_id: 1 }],
      condition: null,
      raceGrade: "ippan",
    });
    const b = blindDigest({
      entries: [{ boat_number: 1, racer_id: 2 }],
      condition: null,
      raceGrade: "ippan",
    });
    const c = computeRaceInfoDigest({
      entries: [{ boat_number: 1, racer_id: 1 }],
      condition: null,
      raceGrade: "ippan",
    });
    const d = computeRaceInfoDigest({
      entries: [{ boat_number: 1, racer_id: 2 }],
      condition: null,
      raceGrade: "ippan",
    });
    check(
      "変異検証: 「ダイジェストが選手を無視する」版では、選手が違っても同じになり（検証が失敗する）、正しい実装では違う値になる",
      a === b && c !== d,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・BEFORE_UNPUBLISHED_HTML・DATE・SUMI_RACE・RACE・NOW・freshDb・createFetcher・pagesHandler・upsertsOf・raceInfoShadowWritesNothing・raceInfoFetchesOnlyRacelist・exhibitionShadowWritesNothing・slotOf） */
export async function runScrapePreRaceJobScenes5(env) {
  ({ check, show, BEFORE_UNPUBLISHED_HTML, DATE, SUMI_RACE, RACE, NOW, freshDb, createFetcher, pagesHandler, upsertsOf, raceInfoShadowWritesNothing, raceInfoFetchesOnlyRacelist, exhibitionShadowWritesNothing, slotOf } = env);
  await scene5();
}
