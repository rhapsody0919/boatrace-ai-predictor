/**
 * verify-scrape-result-job.js の後半の場面（4/7）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-result-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  confirmCancellationsForRaceIds,
  clearCancellationsWithResults,
  clearCancellationsWithResultsInRange,
  syncKFileForDate,
} from "../../daily/scrape-results.js";
import { parseKFileRankings, fetchKFileText } from "../../lib/kfileParser.js";
import { createFakeDb } from "./scrape-result-job-fake-db.js";
import { runResultJob } from "./scrape-result-job-scenes-b-3.js";
import { slotFor } from "./scrape-result-job-scenes-b-2.js";
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

/** 元の verify の1つの塊 { } を割った 1/2 */
async function srjb4Scene1() {
  // clearCancellationsWithResults（BOA-524）: 結果があるのに中止・順延（暫定・確定）が付いたレースを解除する。
  // 2026-09-12 は、結果が先に入り、確定が後から付いた（結果の書き込みの時点では解除できない）
  const mk = (extra = {}) =>
    createFakeDb(
      {
        race_results: [
          { race_id: "R1" },
          { race_id: "R3" },
          { race_id: "R4" },
          { race_id: "R6" },
        ],
        races: [
          // 確定・結果あり（誤り）
          {
            race_id: "R1",
            race_date: "2026-09-12",
            cancellation_status: "confirmed",
            cancellation_check_streak: 0,
          },
          // 確定・結果なし（本物の中止）
          {
            race_id: "R2",
            race_date: "2026-09-12",
            cancellation_status: "confirmed",
            cancellation_check_streak: 0,
          },
          // 暫定・結果あり
          {
            race_id: "R3",
            race_date: "2026-09-12",
            cancellation_status: "tentative",
            cancellation_check_streak: 2,
          },
          // 中止でない・結果あり
          {
            race_id: "R4",
            race_date: "2026-09-12",
            cancellation_status: null,
            cancellation_check_streak: 0,
          },
          // 期間の外（2026-08-01）の確定・結果なし
          {
            race_id: "R5",
            race_date: "2026-08-01",
            cancellation_status: "confirmed",
            cancellation_check_streak: 0,
          },
          // 期間の外の確定・結果あり（範囲の検索では触らない）
          {
            race_id: "R6",
            race_date: "2026-08-01",
            cancellation_status: "confirmed",
            cancellation_check_streak: 0,
          },
        ],
      },
      extra,
    );
  const statusOf = (db, id) => db.tables.races.find((x) => x.race_id === id);
  const db = mk();
  const r = await clearCancellationsWithResults(db, ["R1", "R2", "R3", "R4"]);
  check(
    "解除（BOA-524）: 結果のある確定（R1）・暫定（R3）だけを NULL・streak 0 に戻す。結果の無い確定（R2）と、中止でないレース（R4）は触らない",
    same(r.cleared.sort(), ["R1", "R3"]) &&
      statusOf(db, "R1").cancellation_status === null &&
      statusOf(db, "R3").cancellation_status === null &&
      statusOf(db, "R3").cancellation_check_streak === 0 &&
      statusOf(db, "R2").cancellation_status === "confirmed",
    show(r),
  );
  for (const table of ["race_results", "races"]) {
    const bad = mk({ readError: { [table]: "接続断" } });
    let err = null;
    try {
      await clearCancellationsWithResults(bad, ["R1", "R2"]);
    } catch (e) {
      err = e;
    }
    check(
      `解除: ${table} の読み取りに失敗したら例外・書き込みなし（読めなかった集合を空とみなさない。BOA-512 の反転の再発防止）`,
      err && new RegExp(table).test(err.message) && bad.writes.length === 0,
    );
  }
  return { mk, statusOf };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function srjb4Scene2({ mk, statusOf }) {
  const none = mk();
  const rn = await clearCancellationsWithResults(none, []);
  check(
    "解除: 対象0件は読み書きしない",
    rn.cleared.length === 0 &&
      none.reads.length === 0 &&
      none.writes.length === 0,
  );
  const dbR = mk();
  const rr = await clearCancellationsWithResultsInRange(dbR, {
    from: "2026-09-10",
    to: "2026-09-12",
  });
  check(
    "範囲の解除: 期間（両端含む）の中止・順延の付いたレースだけを調べ、結果のあるもの（R1・R3）を解除する。期間の外（R6）は触らない",
    same(rr.cleared.sort(), ["R1", "R3"]) &&
      statusOf(dbR, "R6").cancellation_status === "confirmed" &&
      statusOf(dbR, "R2").cancellation_status === "confirmed",
    show(rr),
  );
  const badR = mk({ readError: { races: "接続断" } });
  let errR = null;
  try {
    await clearCancellationsWithResultsInRange(badR, {
      from: "2026-09-10",
      to: "2026-09-12",
    });
  } catch (e) {
    errR = e;
  }
  check(
    "範囲の解除: 対象レースの読み取りに失敗したら例外・書き込みなし",
    errR && badR.writes.length === 0,
  );
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
  {
    const s1 = await srjb4Scene1();
    await srjb4Scene2(s1);
  }
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
export async function runScrapeResultJobScenesB5(env) {
  ({ check, show, same } = env);
  await srjb4Scene3();
}

async function srjb4Scene4() {
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

async function srjb4Scene5() {
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
export async function runScrapeResultJobScenesB6(env) {
  ({ check, show, same, K_TEXT } = env);
  await srjb4Scene4();
  await srjb4Scene5();
}
