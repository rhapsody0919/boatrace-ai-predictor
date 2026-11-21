/**
 * verify-scrape-result-job.js の後半の場面（4/7）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-result-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { confirmCancellationsForRaceIds, syncKFileForDate } from "../../daily/scrape-results.js";
import { parseKFileRankings, fetchKFileText } from "../../lib/kfileParser.js";
import {
  CANCELLATION_CONFIRM_AFTER_MIN,
  overdueWindows,
  createResultOnTick,
} from "../../lib/scrapeJobs/resultHandlers.js";
import { SCRAPE_JOBS } from "../../lib/scrapeJobs/registry.js";
import { createFakeDb } from "./scrape-result-job-fake-db.js";
import { NOW_TICK, runResultJob, slotFor } from "./scrape-result-job-scenes-b-3.js";
import { RACE_A } from "./scrape-result-job-scenes-b-1.js";

let check, show, same, K_TEXT;
let kRows;

export const K_DATE = "2026-09-11";

export const kDb = () =>
  createFakeDb({
    race_results: kRows.map((r) => ({
      race_id: r.race_id,
      rank1: r.rank1,
      rank2: r.rank2,
      rank3: r.rank3,
      rank4: null,
      rank5: null,
      rank6: null,
      actual_course_1: null,
      actual_course_2: null,
      actual_course_3: null,
      actual_course_4: null,
      actual_course_5: null,
      actual_course_6: null,
    })),
  });

function srjb4Scene1() {
  // 中止・順延の確定
  check(
    "確定の基準: 結果のスロットの期限+許容幅（発走+10分+80分）が、中止・順延の確定の基準（発走+90分）と一致する",
    SCRAPE_JOBS.result.offsets[0] + SCRAPE_JOBS.result.graceMin ===
      CANCELLATION_CONFIRM_AFTER_MIN,
  );
  {
    // overdueWindows: 発走 < now-90分（排他）、15分の範囲
    const w = overdueWindows(new Date("2026-09-19T05:40:00Z")); // 14:40 JST → 発走13:10未満・12:55以上
    check(
      "overdueWindows: 14:40 JST → 発走 12:55:00〜13:10:00（未満）の1範囲",
      same(w, [{ date: "2026-09-19", from: "12:55:00", to: "13:10:00" }]),
      show(w),
    );
    const w2 = overdueWindows(new Date("2026-09-19T15:16:00Z")); // 00:16 JST（翌日）→ 前日22:31〜22:46
    check(
      "overdueWindows: 翌 00:16 JST → 前日（2026-09-19）の発走 22:31:00〜22:46:00（未満）。最終レース22:45発走が入る（日付をまたいでも拾う）",
      same(w2, [{ date: "2026-09-19", from: "22:31:00", to: "22:46:00" }]) &&
        "22:45:00" >= w2[0].from &&
        "22:45:00" < w2[0].to,
      show(w2),
    );
    const wExact = overdueWindows(new Date("2026-09-19T15:15:00Z")); // 00:15:00 ちょうど: 22:45発走は「90分ちょうど」で、まだ超えていない
    check(
      "overdueWindows: 22:45発走のレースは、翌 00:15:00 ちょうどでは対象外（発走+90分を「超えた」後＝排他）",
      !("22:45:00" < wExact[0].to),
      show(wExact),
    );
    const wCross = overdueWindows(new Date("2026-09-19T16:40:00Z")); // 01:40 JST → 前日23:55〜（終日）と当日 00:00〜00:10
    check(
      "overdueWindows: 日付をまたぐ範囲は、前日の終わりまでと当日の 00:00 からの2つに分ける",
      same(wCross, [
        { date: "2026-09-19", from: "23:55:00", to: null },
        { date: "2026-09-20", from: "00:00:00", to: "00:10:00" },
      ]),
      show(wCross),
    );
  }
}

async function srjb4Scene2() {
  {
    // onTick: 発走時刻の範囲のレースを問い合わせ、確定の処理へ渡す
    const db = createFakeDb({
      races: [
        {
          race_id: "A",
          race_date: "2026-09-19",
          start_time: "12:56:00",
          cancellation_status: null,
        },
        {
          race_id: "B",
          race_date: "2026-09-19",
          start_time: "13:09:00",
          cancellation_status: null,
        },
        {
          race_id: "C",
          race_date: "2026-09-19",
          start_time: "13:10:00",
          cancellation_status: null,
        }, // 上限（排他）
        {
          race_id: "D",
          race_date: "2026-09-19",
          start_time: "12:50:00",
          cancellation_status: null,
        }, // 範囲外（古い）
        {
          race_id: "E",
          race_date: "2026-09-19",
          start_time: "13:00:00",
          cancellation_status: "confirmed",
        }, // 確定済み
        {
          race_id: "F",
          race_date: "2026-09-18",
          start_time: "13:00:00",
          cancellation_status: null,
        }, // 別の日
      ],
    });
    const seen = [];
    const tick = await createResultOnTick({
      confirm: async (client, ids) => {
        seen.push(ids);
        return { checked: ids.length, confirmed: ["A"] };
      },
    })({ client: db, now: () => NOW_TICK });
    check(
      "onTick: 発走 12:55〜13:10（未満）・未確定・当日のレースだけを、確定の処理に渡す",
      same(seen, [["A", "B"]]) && same(tick, { overdue: 2, confirmed: 1 }),
      show({ seen, tick }),
    );
    check(
      "onTick: 書き込みは自分ではしない（確定は confirm 経由）",
      db.writes.length === 0,
    );
  }
}

async function srjb4Scene3() {
  {
    // confirmCancellationsForRaceIds: 結果のあるレースは確定しない。読み取り失敗は書かない
    const mk = (extra = {}) =>
      createFakeDb(
        {
          race_results: [{ race_id: "R1" }],
          races: [
            { race_id: "R1", cancellation_status: null },
            { race_id: "R2", cancellation_status: null },
            { race_id: "R3", cancellation_status: "confirmed" },
          ],
        },
        extra,
      );
    const db = mk();
    const r = await confirmCancellationsForRaceIds(db, ["R1", "R2", "R3"]);
    check(
      "確定: 結果のあるレース（R1）・確定済み（R3）は対象外、結果の無い R2 だけを confirmed にする",
      same(r.confirmed, ["R2"]) &&
        db.tables.races.find((x) => x.race_id === "R2").cancellation_status ===
          "confirmed" &&
        db.tables.races.find((x) => x.race_id === "R1").cancellation_status ===
          null,
      show(r),
    );
    const bad = mk({ readError: { race_results: "接続断" } });
    let err = null;
    try {
      await confirmCancellationsForRaceIds(bad, ["R1", "R2"]);
    } catch (e) {
      err = e;
    }
    check(
      "確定: race_results の読み取りに失敗したら例外・書き込みなし（結果の有無が分からないまま、結果のあるレースを中止にしない）",
      err && /race_results/.test(err.message) && bad.writes.length === 0,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same） */
export async function runScrapeResultJobScenesB5(env) {
  ({ check, show, same } = env);
  srjb4Scene1();
  await srjb4Scene2();
  await srjb4Scene3();
}

async function srjb4Scene4() {
  {
    // onTick の失敗: 500・失敗を記録・でもスロットの処理は続ける
    const r = await runResultJob({
      mode: "live",
      slots: [slotFor(RACE_A)],
      onTick: async () => {
        throw new Error("確定に失敗（テスト）");
      },
    });
    check(
      "onTick が失敗: 500・失敗を記録。ただしスロットの処理（取得・書き込み・完了）は続ける",
      r.res.status === 500 &&
        /確定に失敗/.test(r.res.body.tickError) &&
        r.store.completed.length === 1 &&
        r.store.calls.some((c) => c.name === "recordFailure"),
      show(r.res.body),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same） */
export async function runScrapeResultJobScenesB6(env) {
  ({ check, show, same } = env);
  await srjb4Scene4();
}

async function srjb4Scene5() {
  kRows = parseKFileRankings(K_TEXT, K_DATE).filter((r) => r.valid);
  {
    const db = kDb();
    let downloads = 0;
    const fetchText = async () => {
      downloads++;
      return K_TEXT;
    };
    const r = await syncKFileForDate(K_DATE, { client: db, fetchText });
    check(
      "Kファイル: 進入コースとrank4〜6の両方が未同期でも、同じ日のKファイルのダウンロードは1回（D4の解消）",
      downloads === 1 && r.downloads === 1,
      `downloads=${downloads}`,
    );
    const filled = db.tables.race_results.filter(
      (x) => x.actual_course_1 !== null || x.actual_course_2 !== null,
    ).length;
    check(
      "Kファイル: 進入コース・rank4〜6が書き込まれる（status=synced、更新件数>0）",
      r.actualCourse.status === "synced" &&
        r.rank456.status === "synced" &&
        r.actualCourse.updated > 100 &&
        r.rank456.updated > 100 &&
        filled > 100 &&
        db.tables.race_results.some((x) => x.rank4 !== null),
      show({ a: r.actualCourse, k: r.rank456 }),
    );
    const writes = db.writes.length;
    const again = await syncKFileForDate(K_DATE, { client: db, fetchText });
    check(
      "Kファイル: 同期済みの日は、ダウンロードも書き込みもしない（nothing_pending・BOA-349の維持）",
      again.downloads === 0 &&
        downloads === 1 &&
        db.writes.length === writes &&
        again.actualCourse.status === "nothing_pending" &&
        again.rank456.status === "nothing_pending",
      show(again),
    );
  }
}

async function srjb4Scene6() {
  {
    // rank4〜6だけが未同期でも、ダウンロードは1回。dryRun は書かない
    const db = kDb();
    for (const row of db.tables.race_results) {
      Object.assign(row, { actual_course_1: 1 }); // 進入コースは同期済み
    }
    let downloads = 0;
    const dry = await syncKFileForDate(K_DATE, {
      client: db,
      dryRun: true,
      fetchText: async () => {
        downloads++;
        return K_TEXT;
      },
    });
    check(
      "Kファイル: dryRun（shadow）は取得・解析して書くはずの件数を数えるが、書き込みは0件",
      downloads === 1 &&
        db.writes.length === 0 &&
        dry.actualCourse.status === "nothing_pending" &&
        dry.rank456.updated > 100 &&
        db.tables.race_results.every((x) => x.rank4 === null),
      show(dry),
    );
    const unavailable = await syncKFileForDate(K_DATE, {
      client: kDb(),
      fetchText: async () => null,
    });
    check(
      "Kファイル: 未同期のレースがあるのにKファイルが未公開（null）→ kfile_unavailable",
      unavailable.actualCourse.status === "kfile_unavailable" &&
        unavailable.rank456.status === "kfile_unavailable",
    );
    const failed = await syncKFileForDate(K_DATE, {
      client: kDb(),
      fetchText: async () => {
        throw new Error("HTTP 500");
      },
    });
    check(
      "Kファイル: ダウンロード失敗 → kfile_error（理由付き）。2つの同期で同じ失敗を共有し、ダウンロードの試行は1回",
      failed.actualCourse.status === "kfile_error" &&
        failed.rank456.status === "kfile_error" &&
        failed.downloads === 1 &&
        /HTTP 500/.test(failed.actualCourse.error),
    );
    // fetchKFileText は fetchImpl を受け取る（politeFetch を通せる）
    let calledUrl = null;
    const none = await fetchKFileText("2026-09-11", {
      fetchImpl: async (url) => {
        calledUrl = url;
        return new Response(null, { status: 404 });
      },
    });
    let err = null;
    try {
      await fetchKFileText("2026-09-11", {
        fetchImpl: async () => new Response("x", { status: 500 }),
      });
    } catch (e) {
      err = e;
    }
    check(
      "fetchKFileText: fetchImpl を差し替えられる（404 → null、500 → 例外）。URLは www1.mbrace.or.jp の k260911.lzh",
      none === null &&
        err &&
        /500/.test(err.message) &&
        /mbrace\.or\.jp\/od2\/K\/202609\/k260911\.lzh/.test(calledUrl),
      String(calledUrl),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・K_TEXT） */
export async function runScrapeResultJobScenesB7(env) {
  ({ check, show, same, K_TEXT } = env);
  await srjb4Scene5();
  await srjb4Scene6();
}
