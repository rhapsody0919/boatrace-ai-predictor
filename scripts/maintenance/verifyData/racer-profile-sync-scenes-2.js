/**
 * verify-racer-profile-sync.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-racer-profile-sync.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { ABORT_AFTER_CONSECUTIVE_FAILURES } from "../../lib/racerProfileSync.js";
import { runWith, existingRow } from "./racer-profile-sync-scenes-1.js";

let check, seasonHtml, createMockSupabase, createMockSite;

async function scene1() {
  {
    // 書き込みが全件失敗する場合、20件で中断する（4時間かけて全件巡回しない）
    const profiles = Array.from({ length: 60 }, (_, i) => existingRow(1000 + i));
    const mock = createMockSupabase({ profiles, patchFails: true });
    const pages = Object.fromEntries(
      profiles.map((p) => [p.racer_id, { season: seasonHtml() }]),
    );
    const site = createMockSite(pages);
    const { summary, verdict } = await runWith(mock, site, []);
    check(
      `統合: 書き込みが全件失敗なら${ABORT_AFTER_CONSECUTIVE_FAILURES}件で中断し、公式サイトへのリクエストも止める`,
      [summary.aborted, summary.season.failCount, site.calls.length, verdict.ok],
      [
        true,
        ABORT_AFTER_CONSECUTIVE_FAILURES,
        ABORT_AFTER_CONSECUTIVE_FAILURES,
        false,
      ],
    );
  }
  {
    // 途中まで成功していても、失敗が連続したら中断する（公式サイトが途中で落ちた場合）
    const profiles = Array.from({ length: 80 }, (_, i) => existingRow(1000 + i));
    const mock = createMockSupabase({ profiles });
    const pages = Object.fromEntries(
      profiles.map((p, i) => [
        p.racer_id,
        { season: i < 5 ? seasonHtml() : 503 }, // 最初の5人は成功、以降は503
      ]),
    );
    const site = createMockSite(pages);
    const { summary, verdict } = await runWith(mock, site, []);
    check(
      "統合: 5人成功のあと503が続けば、連続20件の失敗で中断する（80人全員には当たらない）",
      [
        summary.aborted,
        summary.season.successCount,
        summary.season.failCount,
        summary.nextOffset,
        verdict.ok,
      ],
      [true, 5, ABORT_AFTER_CONSECUTIVE_FAILURES, 25, false],
    );
  }
  {
    // 失敗の合間に成功が挟まれば連続とはみなさない（5%以内の散発的な失敗では中断しない）
    const profiles = Array.from({ length: 100 }, (_, i) => existingRow(1000 + i));
    const mock = createMockSupabase({ profiles });
    const pages = Object.fromEntries(
      profiles.map((p, i) => [
        p.racer_id,
        { season: i % 25 === 24 ? 503 : seasonHtml() }, // 25人に1人が失敗（4件=4%）
      ]),
    );
    const site = createMockSite(pages);
    const { summary, verdict } = await runWith(mock, site, []);
    check(
      "統合: 散発的な失敗（4%）は中断せず全件処理し、成功扱い",
      [
        summary.aborted,
        summary.season.failCount,
        summary.season.successCount,
        verdict.ok,
      ],
      [false, 4, 96, true],
    );
  }
}

async function scene2() {
  {
    // 時間予算: 経過時間が上限を超えたら中断し、再開用のoffsetを返す
    const profiles = Array.from({ length: 10 }, (_, i) => existingRow(1000 + i));
    const mock = createMockSupabase({ profiles });
    const pages = Object.fromEntries(
      profiles.map((p) => [p.racer_id, { season: seasonHtml() }]),
    );
    const site = createMockSite(pages);
    let clock = 0;
    const { summary, verdict } = await runWith(
      mock,
      site,
      ["--max-minutes=1", "--offset=0"],
      {
        now: () => clock,
        sleep: async () => {
          clock += 30_000;
        }, // 1選手ごとに30秒経過したことにする
      },
    );
    check(
      // 経過0秒・30秒・60秒（上限ちょうどは超過ではない）の3人を処理し、90秒で中断する
      "統合: 時間予算で中断し、再開用offsetを記録して失敗扱い",
      [summary.stoppedEarly, summary.nextOffset, verdict.ok],
      [true, 3, false],
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・seasonHtml・createMockSupabase・createMockSite） */
export async function runRacerProfileSyncScenes2(env) {
  ({ check, seasonHtml, createMockSupabase, createMockSite } = env);
  await scene1();
  await scene2();
}
