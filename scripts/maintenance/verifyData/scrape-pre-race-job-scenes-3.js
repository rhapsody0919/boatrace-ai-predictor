/**
 * verify-scrape-pre-race-job.js の後半の場面（3/6）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-pre-race-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { runForRaces as realExhibitionRun } from "../../daily/scrape-exhibition-data.js";
import { createExhibitionSlotHandler } from "../../lib/scrapeJobs/preRaceHandlers.js";
import { CATCHUP_OFFSET, sumiFetcher, sumiDbWithData, upsertedTables, PRIMARY_OFFSET } from "./scrape-pre-race-job-scenes-2.js";

let BEFORE_UNPUBLISHED_HTML, SUMI_RACE, NOW, freshDb, writeCount, slotOf, runViaWrapper;

/**
 * 展示のスロットを共通ラッパ経由で1件処理する（補完のスロットは offset=10）。
 * 差し替え: run（runForRaces）、catchup（補完の判定・再試行の間隔）。changed は、onChanged に通知されたレース
 */
export async function exhibitionSlot({
  mode = "live",
  offset = CATCHUP_OFFSET,
  raceId = SUMI_RACE,
  db = freshDb(),
  fetcher = sumiFetcher(),
  run = realExhibitionRun,
  catchup,
  weightOnly,
} = {}) {
  const changed = [];
  const r = await runViaWrapper({
    job: "exhibition",
    createHandleSlot: () =>
      createExhibitionSlotHandler({
        run,
        loadSchedule: async () => [],
        onChanged: (date, id) => changed.push(id),
        ...(catchup ? { catchup } : {}),
        ...(weightOnly ? { weightOnly } : {}),
      }),
    rows: { exhibition: { job: "exhibition", mode, consecutive_failures: 0 } },
    slots: [slotOf("exhibition", raceId, offset)],
    db,
    fetcher,
  });
  return { ...r, changed };
}

// 観測（正しい実装で、以下の各検証が満たすことと、変異版が満たさないことを、同じ関数で確かめる）
/** 補完は、取得済みのレースを、shadow でも live でも取得しない（公式ページへのリクエスト0）。書き込みも0 */
export async function catchupSkipsHaveData(run = realExhibitionRun) {
  for (const mode of ["shadow", "live"]) {
    const r = await exhibitionSlot({ mode, db: sumiDbWithData(), run });
    if (
      r.fetcher.calls.length !== 0 ||
      writeCount(r.db) !== 0 ||
      r.store.completed[0]?.outcome !== "skipped_have_data"
    ) {
      return false;
    }
  }
  return true;
}

/** 補完は、shadow では書かない（取得・解析のみ。ダイジェストを予定表に記録して完了する） */
export async function catchupShadowWritesNothing(run = realExhibitionRun) {
  const r = await exhibitionSlot({ mode: "shadow", run });
  return (
    r.fetcher.calls.length === 1 &&
    writeCount(r.db) === 0 &&
    r.store.completed[0]?.outcome === "ok" &&
    typeof r.store.completed[0]?.resultDigest === "string" &&
    r.store.completed[0]?.rowsWritten === 0
  );
}

/** 補完は、live で展示データを書くが、気象（race_conditions）は書かない */
export async function catchupWritesNoWeather(run = realExhibitionRun) {
  const r = await exhibitionSlot({ mode: "live", run });
  return (
    upsertedTables(r.db).includes("exhibition_data") &&
    !upsertedTables(r.db).includes("race_conditions") &&
    r.store.completed[0]?.outcome === "ok"
  );
}

/** 補完は、変更を書いても、予測の再計算の対象にしない（onChanged を呼ばない） */
export async function catchupIsNotRefreshed(catchup) {
  const r = await exhibitionSlot({ mode: "live", catchup });
  return r.changed.length === 0 && r.store.completed[0]?.rowsWritten === 6;
}

/** 補完の未完了の再試行は、-33 のスロットの再試行（120秒）より長い（600秒）。ブレーカーの retryAt は、そのまま使う */
export async function catchupRetriesSlowly(catchup) {
  const r = await exhibitionSlot({
    mode: "live",
    fetcher: sumiFetcher(BEFORE_UNPUBLISHED_HTML),
    catchup,
  });
  const primary = await exhibitionSlot({
    mode: "live",
    offset: PRIMARY_OFFSET,
    fetcher: sumiFetcher(BEFORE_UNPUBLISHED_HTML),
    catchup,
  });
  const retryAfterSec = (x) =>
    (new Date(x.store.retried[0]?.retryAt).getTime() - NOW.getTime()) / 1000;
  return (
    // BOA-500 以降、展示航走前のページは当日体重・調整重量を書くため partial（未完了なのは変わらない）
    r.store.retried[0]?.outcome === "partial" &&
    retryAfterSec(r) === 590 &&
    retryAfterSec(primary) === 110
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（BEFORE_UNPUBLISHED_HTML・SUMI_RACE・NOW・freshDb・writeCount・slotOf・runViaWrapper） */
export function runScrapePreRaceJobScenes4(env) {
  ({ BEFORE_UNPUBLISHED_HTML, SUMI_RACE, NOW, freshDb, writeCount, slotOf, runViaWrapper } = env);

}
