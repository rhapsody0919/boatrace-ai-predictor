/**
 * verify-scrape-result-job.js の後半の場面（2/7）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-result-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  fetchRaceResultHtml,
  ResultHttpError,
  buildRaceResultRow,
  runForRaces,
} from "../../daily/scrape-results.js";
import { computeResultDigest } from "../../lib/scrapeJobs/resultDigest.js";
import { compareShadowDigests } from "../check-result-shadow.js";
import { BreakerOpenError } from "../../lib/scrapeJobs/circuitBreaker.js";
import { createFakeDb, clone } from "./scrape-result-job-fake-db.js";
import { rowA, timingsA, RACE_A, digestA, RACE_B, parsedB, RACE_NONE, htmlFetcher } from "./scrape-result-job-scenes-b-1.js";

let check, show, same, HTML_NONE, HTML_PARTIAL;

// ---------------------------------------------------------------------------
// (b) runForRaces
// ---------------------------------------------------------------------------
export const racesA = { race_id: RACE_A, venue_code: 5, race_number: 1 };

const racesB = { race_id: RACE_B, venue_code: 17, race_number: 12 };

const racesNone = { race_id: RACE_NONE, venue_code: 1, race_number: 1 };

export const DATE = "2026-09-19";

export const NOW_FN = () => new Date("2026-09-19T06:00:00Z");

export const baseDb = () =>
  createFakeDb({
    race_results: [],
    race_start_timings: [],
    race_conditions: [],
    races: [
      { race_id: RACE_A, start_time: "14:30:00" },
      { race_id: RACE_B, start_time: "15:00:00" },
    ],
    predictions: [
      {
        prediction_id: 1,
        race_id: RACE_A,
        model_id: "unified",
        top_pick: 1,
        top_2nd: 6,
        top_3rd: 2,
        feature_contributions: null,
        is_hit_win: null,
      },
    ],
  });

async function srjb2Scene1() {
  // fetchRaceResultHtml: 200以外は ResultHttpError（未公開の解析失敗と区別する）
  {
    let err = null;
    try {
      await fetchRaceResultHtml(
        "https://example.invalid/x",
        async () => new Response("x", { status: 503 }),
      );
    } catch (e) {
      err = e;
    }
    check(
      "fetchRaceResultHtml: 503 は ResultHttpError（status付き）。200は本文を返す",
      err instanceof ResultHttpError &&
        err.status === 503 &&
        (await fetchRaceResultHtml(
          "https://example.invalid/x",
          async () => new Response("本文", { status: 200 }),
        )) === "本文",
    );
  }
  {
    // shadow の集計スクリプト（check-result-shadow.js）の比較: DBの行から同じ関数で計算したダイジェストと比べる
    const dbRow = { ...rowA, id: 99, actual_course_1: 1 };
    const dbTimings = timingsA.map((t) => ({
      ...t,
      updated_at: "2026-09-19T06:10:00+00:00",
    }));
    const cmp = compareShadowDigests(
      [
        { race_id: RACE_A, result_digest: digestA },
        { race_id: RACE_B, result_digest: "0000000000000000" },
        { race_id: "2026-09-19-01-01", result_digest: digestA },
        { race_id: "2026-09-19-01-02", result_digest: null },
      ],
      [dbRow, { ...buildRaceResultRow(RACE_B, parsedB) }],
      [
        ...dbTimings,
        ...parsedB.startTimings.map((st) => ({ race_id: RACE_B, ...st })),
      ],
    );
    check(
      "check-result-shadow: 一致（桐生1R）・不一致（宮島12Rは別のdigest）・DBに行なし・digest未記録を、別々に数える",
      cmp.matched === 1 &&
        cmp.mismatched.length === 1 &&
        cmp.mismatched[0].race_id === RACE_B &&
        same(cmp.missing, ["2026-09-19-01-01"]) &&
        same(cmp.noDigest, ["2026-09-19-01-02"]),
      show(cmp),
    );
    const t = JSON.parse(JSON.stringify(dbTimings));
    t[0].start_timing = 0.99;
    check(
      "check-result-shadow: DBのスタート情報が1つ違えば不一致になる（結果の行だけでなくSTも比べている）",
      compareShadowDigests(
        [{ race_id: RACE_A, result_digest: digestA }],
        [dbRow],
        t,
      ).mismatched.length === 1,
    );
  }
}

async function srjb2Scene2() {
  {
    // live: 書き込む
    const db = baseDb();
    const fetchHtml = htmlFetcher();
    const res = await runForRaces([racesA, racesB], {
      date: DATE,
      mode: "live",
      fetchHtml,
      client: db,
      concurrency: 2,
      now: NOW_FN,
    });
    const byId = Object.fromEntries(res.map((r) => [r.race_id, r]));
    check(
      "live: 2レースとも ok・digest付き・書き込み行数>0（結果1行＋スタート情報6行）",
      res.length === 2 &&
        byId[RACE_A].outcome === "ok" &&
        byId[RACE_B].outcome === "ok" &&
        byId[RACE_A].resultDigest === digestA &&
        byId[RACE_A].rowsWritten === 7 &&
        byId[RACE_A].rowsParsed === 1,
      show(res),
    );
    check(
      "live: race_results・race_start_timings・race_conditions（気象）へ書き込み、result_at は取得時刻",
      db.tables.race_results.length === 2 &&
        db.tables.race_start_timings.length === 12 &&
        db.tables.race_conditions.length === 2 &&
        db.tables.race_results.find((r) => r.race_id === RACE_A).result_at ===
          "2026-09-19T06:00:00.000Z",
      show(db.writes.map((w) => `${w.table}:${w.op}`)),
    );
    check(
      "live: 気象の観測時刻に、racesの発走予定時刻（14:30 JST＝05:30Z）が入る",
      db.tables.race_conditions.find((r) => r.race_id === RACE_A)
        ?.weather_observed_at === "2026-09-19T05:30:00.000Z",
      show(db.tables.race_conditions),
    );
    check(
      "live: 今回書いた結果の的中判定を更新する（予測1-6-2は単勝・3連単が的中）",
      db.tables.predictions[0].is_hit_win === true &&
        db.tables.predictions[0].is_hit_trio === true &&
        db.tables.predictions[0].payout_win === 160,
      show(db.tables.predictions[0]),
    );

    // 2回目: 完了済みは取得しない
    const fetchAgain = htmlFetcher();
    const res2 = await runForRaces([racesA, racesB], {
      date: DATE,
      mode: "live",
      fetchHtml: fetchAgain,
      client: db,
      now: NOW_FN,
    });
    check(
      "live: 完了済み（payout_win・winning_technique が揃う）は取得せず skipped_have_data",
      res2.every((r) => r.outcome === "skipped_have_data") &&
        fetchAgain.calls.length === 0,
      show(res2),
    );
    // 書き込んだ後に、同じ内容を再取得しても、書き込みは0件（変更なしは書かない）
    const writesBefore = db.writes.length;
    db.tables.race_results.find((r) => r.race_id === RACE_A).winning_technique =
      null;
    const res3 = await runForRaces([racesA], {
      date: DATE,
      mode: "live",
      fetchHtml: htmlFetcher(),
      client: db,
      now: NOW_FN,
    });
    check(
      "live: 未完了（決まり手が空）の行は再取得して、決まり手を書き込む",
      res3[0].outcome === "ok" &&
        db.tables.race_results.find((r) => r.race_id === RACE_A)
          .winning_technique === "逃げ" &&
        db.writes.length > writesBefore,
      show(res3),
    );
  }
}

async function srjb2Scene3() {
  {
    // shadow: 一切書かない。完了済みでも取得してダイジェストを出す
    const db = baseDb();
    // 既存基盤が既に書いた状態にする（live で書いた行）
    await runForRaces([racesA, racesB], {
      date: DATE,
      mode: "live",
      fetchHtml: htmlFetcher(),
      client: db,
      now: NOW_FN,
    });
    const before = clone(db.tables);
    const writesBefore = db.writes.length;
    const fetcher = htmlFetcher();
    const res = await runForRaces([racesA, racesB], {
      date: DATE,
      mode: "shadow",
      fetchHtml: fetcher,
      client: db,
      concurrency: 2,
      now: NOW_FN,
    });
    check(
      "shadow: データテーブルへ一切書かない（writes 0件・全テーブルの内容が不変）",
      db.writes.length === writesBefore && same(db.tables, before),
    );
    check(
      "shadow: 完了済みのレースも取得し（2回）、digest を返す。既存基盤の行から計算した値と一致（一致率の計測ができる）",
      fetcher.calls.length === 2 &&
        res.every((r) => r.outcome === "ok" && r.rowsWritten === 0) &&
        res[0].resultDigest ===
          computeResultDigest(
            db.tables.race_results.find((r) => r.race_id === RACE_A),
            db.tables.race_start_timings.filter((r) => r.race_id === RACE_A),
          ),
      show(res),
    );
    // shadow は既存の行を読まない（完了済みの判定をしない）
    const dbShadow = baseDb();
    await runForRaces([racesA], {
      date: DATE,
      mode: "shadow",
      fetchHtml: htmlFetcher(),
      client: dbShadow,
      now: NOW_FN,
    });
    check(
      "shadow: DBを読みもしない（完了済みの判定も、発走時刻の取得もしない）",
      dbShadow.reads.length === 0 && dbShadow.writes.length === 0,
      show(dbShadow.reads),
    );
  }
  {
    // partial / no_values / error / breaker / 1件の失敗で他を止めない
    const db = baseDb();
    const res = await runForRaces([racesA, racesNone, racesB], {
      date: DATE,
      mode: "live",
      fetchHtml: async (url) =>
        url.includes("jcd=05")
          ? HTML_PARTIAL
          : url.includes("jcd=17")
            ? (() => {
                throw new ResultHttpError(url, 503);
              })()
            : HTML_NONE,
      client: db,
      now: NOW_FN,
    });
    const byId = Object.fromEntries(res.map((r) => [r.race_id, r]));
    check(
      "決まり手が未公開 → partial（書き込み済み・digestなし・再試行の理由付き）。未公開 → no_values（書かない）。HTTP失敗 → error。3件とも処理される",
      byId[RACE_A].outcome === "partial" &&
        byId[RACE_A].resultDigest === undefined &&
        byId[RACE_A].rowsWritten > 0 &&
        /決まり手/.test(byId[RACE_A].error) &&
        byId[RACE_NONE].outcome === "no_values" &&
        byId[RACE_NONE].rowsWritten === 0 &&
        byId[RACE_B].outcome === "error" &&
        /503/.test(byId[RACE_B].error) &&
        !db.tables.race_results.some((r) => r.race_id === RACE_NONE),
      show(res),
    );
    check(
      "partial: 着順・払戻だけでも race_results に書く（結果を早く見せる。従来と同じ）",
      db.tables.race_results.some(
        (r) =>
          r.race_id === RACE_A &&
          r.payout_win === 160 &&
          r.winning_technique === null,
      ),
    );
  }
}

async function srjb2Scene4() {
  {
    const until = Date.parse("2026-09-19T06:01:00Z");
    const res = await runForRaces([racesA], {
      date: DATE,
      mode: "live",
      fetchHtml: async () => {
        throw new BreakerOpenError("host:boatrace.jp", until);
      },
      client: baseDb(),
      now: NOW_FN,
    });
    check(
      "サーキットブレーカーが開いていれば breaker_open（retryAt＝開放期限）。「未公開」にも「失敗」にも化けさせない",
      res[0].outcome === "breaker_open" && res[0].retryAt.getTime() === until,
      show(res),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・HTML_NONE・HTML_PARTIAL） */
export async function runScrapeResultJobScenesB3(env) {
  ({ check, show, same, HTML_NONE, HTML_PARTIAL } = env);
  await srjb2Scene1();
  await srjb2Scene2();
  await srjb2Scene3();
  await srjb2Scene4();
}
