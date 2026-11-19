/**
 * verify-scrape-pre-race-job.js の後半の場面（5/6）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-pre-race-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { runForRaces as realExhibitionRun } from "../../daily/scrape-exhibition-data.js";
import { SCRAPE_JOBS } from "../../lib/scrapeJobs/registry.js";
import { exhibitionSlot } from "./scrape-pre-race-job-scenes-3.js";
import { WEIGHT_OFFSET, preExhibitionFetcher } from "./scrape-pre-race-job-scenes-4.js";
import { upsertedTables, sumiFetcher, sumiDbWithData, PRIMARY_OFFSET } from "./scrape-pre-race-job-scenes-2.js";

let check, show, NOW, upsertsOf;

/** 体重だけの窓は、展示航走前のページ（当日体重・調整重量だけ公開）で、6行を書いて完了（ok）する。気象・再計算は無し */
async function weightOnlyCompletes({
  run = realExhibitionRun,
  weightOnly,
} = {}) {
  const r = await exhibitionSlot({
    mode: "live",
    offset: WEIGHT_OFFSET,
    fetcher: preExhibitionFetcher(),
    run,
    weightOnly,
  });
  const rows = upsertsOf(r.db, "exhibition_data").flatMap((u) => u.rows);
  return (
    r.store.completed[0]?.outcome === "ok" &&
    r.store.completed[0]?.rowsWritten === 6 &&
    r.store.retried.length === 0 &&
    r.fetcher.calls.length === 1 &&
    rows.length === 6 &&
    rows.every(
      (row) => row.today_weight != null && row.exhibition_time === null,
    ) &&
    r.changed.length === 0
  );
}

/** 体重だけの窓は、気象（race_conditions）を書かず、スケジュール（races）を読まない */
async function weightOnlyWritesNoWeather(run = realExhibitionRun) {
  const r = await exhibitionSlot({
    mode: "live",
    offset: WEIGHT_OFFSET,
    fetcher: preExhibitionFetcher(),
    run,
  });
  return (
    upsertedTables(r.db).includes("exhibition_data") &&
    !upsertedTables(r.db).includes("race_conditions") &&
    !r.db.state.selects.some((sel) => sel.table === "races")
  );
}

/** 体重も未公開（直前情報の表が無い）なら no_values で、900秒おき（ゆらぎ10秒を引いて890秒後）に再試行する（BOA-1145） */
async function weightOnlyRetriesSlowly(weightOnly) {
  const r = await exhibitionSlot({
    mode: "live",
    offset: WEIGHT_OFFSET,
    fetcher: sumiFetcher("<html></html>"),
    weightOnly,
  });
  const retryAfterSec =
    (new Date(r.store.retried[0]?.retryAt).getTime() - NOW.getTime()) / 1000;
  return (
    r.store.completed.length === 0 &&
    r.store.retried[0]?.outcome === "no_values" &&
    retryAfterSec === 890 &&
    upsertsOf(r.db, "exhibition_data").length === 0
  );
}

async function scene1() {
  {
    check(
      "体重だけの窓 live（展示航走前のページ）: beforeinfo を1回だけ取得し、当日体重・調整重量の6行を書いて outcome=ok で完了する（partial で26分間再試行し続けない）。予測の再計算の対象にしない",
      await weightOnlyCompletes(),
    );
    check(
      "体重だけの窓: 気象（race_conditions）を書かず、スケジュール（races）を読まない（気象は -33 の窓が、発走に近い観測で書く）",
      await weightOnlyWritesNoWeather(),
    );
    check(
      "体重だけの窓: 体重も未公開（表が無い）なら no_values・書き込み0で、900秒おき（890秒後）に再試行する",
      await weightOnlyRetriesSlowly(),
    );
    const done = await exhibitionSlot({
      mode: "live",
      offset: WEIGHT_OFFSET,
      db: sumiDbWithData(),
    });
    check(
      "体重だけの窓: 展示タイムが取得済みなら取得しない（skipped_have_data。公式ページへのリクエスト0）",
      done.fetcher.calls.length === 0 &&
        done.store.completed[0]?.outcome === "skipped_have_data",
      show(done.store.completed),
    );
    const primary = await exhibitionSlot({
      mode: "live",
      offset: PRIMARY_OFFSET,
      fetcher: preExhibitionFetcher(),
    });
    check(
      "-33 のスロットは従来どおり: 展示航走前のページでは、体重を書いても partial（展示タイムが入るまで完了にしない）で、120秒おき（110秒後）に再試行する",
      primary.store.completed.length === 0 &&
        primary.store.retried[0]?.outcome === "partial" &&
        new Date(primary.store.retried[0].retryAt).getTime() ===
          NOW.getTime() + 110000,
      show(primary.store.retried),
    );
    const exhibited = await exhibitionSlot({
      mode: "live",
      offset: WEIGHT_OFFSET,
    });
    check(
      "体重だけの窓: 展示タイムまで公開済みのページなら、展示タイムも書いて ok（-33 のスロットは skipped_have_data で済む）",
      exhibited.store.completed[0]?.outcome === "ok" &&
        upsertsOf(exhibited.db, "exhibition_data")
          .flatMap((u) => u.rows)
          .some((row) => row.exhibition_time != null),
      show(exhibited.store.completed),
    );

    // 変異検証
    const dropWeightOnly = (run) => (races, options) =>
      run(races, { ...options, weightOnly: false });
    const withWeatherRun = (run) => (races, options) =>
      run(races, { ...options, updateWeather: true, schedule: [] });
    check(
      "変異検証の前提: 正しい実装は、体重だけの窓の各検証（完了・気象なし・再試行の間隔）に合格する",
      (await weightOnlyCompletes()) &&
        (await weightOnlyWritesNoWeather()) &&
        (await weightOnlyRetriesSlowly()),
    );
    check(
      "変異検証: 「体重だけの窓でも、展示タイムが入るまで完了にしない（runForRaces に weightOnly を渡さない）」版では、『完了する』検証が失敗する",
      !(await weightOnlyCompletes({ run: dropWeightOnly(realExhibitionRun) })),
    );
    check(
      "変異検証: 「-60 を通常のスロットとして扱う」版では、『完了する』検証が失敗する（partial・再計算の対象になる）",
      !(await weightOnlyCompletes({
        weightOnly: { isWeightOnly: () => false, retrySec: 300 },
      })),
    );
    check(
      "変異検証: 「体重だけの窓の再試行が、-33 と同じ120秒」版では、『900秒おき』検証が失敗する",
      !(await weightOnlyRetriesSlowly({
        isWeightOnly: (offset) => offset === WEIGHT_OFFSET,
        retrySec: SCRAPE_JOBS.exhibition.retrySec,
      })),
    );
    check(
      "変異検証: 「体重だけの窓が、気象を書く」版では、『気象を書かない』検証が失敗する",
      !(await weightOnlyWritesNoWeather(withWeatherRun(realExhibitionRun))),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・NOW・upsertsOf） */
export async function runScrapePreRaceJobScenes6(env) {
  ({ check, show, NOW, upsertsOf } = env);
  await scene1();
}
