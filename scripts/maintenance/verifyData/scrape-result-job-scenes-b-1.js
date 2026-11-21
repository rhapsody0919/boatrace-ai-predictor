/**
 * verify-scrape-result-job.js の後半の場面（1/7）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-result-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  parseRaceResultHtml,
  buildRaceResultRow,
  isResultComplete,
} from "../../daily/scrape-results.js";
import {
  RESULT_DIGEST_COLUMNS,
  pickResultColumns,
  START_TIMING_DIGEST_COLUMNS,
  pickStartTimingColumns,
  computeResultDigest,
} from "../../lib/scrapeJobs/resultDigest.js";

let check, show, same, HTML_A, HTML_B, HTML_NONE, HTML_PARTIAL, URL_TO_HTML;
let parsedA;
export let parsedB, rowA, timingsA, digestA;

 // 決まり手が未公開の状態を模す

export const RACE_A = "2026-09-19-05-01";

export const RACE_B = "2026-09-19-17-12";

export const RACE_NONE = "2026-09-19-01-01";

// ---------------------------------------------------------------------------
// テスト用の道具: インメモリのSupabaseクライアント・fetch・時計
// ---------------------------------------------------------------------------

// runForRaces の fetchHtml（本文の文字列を返す）。呼び出したURLを calls に残す
export const htmlFetcher = (map = URL_TO_HTML) => {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const body = map(url);
    if (body instanceof Error) throw body;
    return body;
  };
  fn.calls = calls;
  return fn;
};

// 未定義の入力は合否に含めず、現在の値だけを表示する。
export const KNOWN_GAPS = [
  {
    input: 'rank1: 1 と rank1: "1"', specification: "数と数の文字列の同一視は未定",
    current: () => computeResultDigest({ race_id: "x", rank1: 1 }) ===
      computeResultDigest({ race_id: "x", rank1: "1" }),
  },
  {
    input: '艇番 "a" (ST 0.1)・"b" (ST 0.2)', specification: "数にならない艇番の扱いは未定",
    current: () => pickStartTimingColumns([
      { boat_number: "a", start_timing: 0.1 }, { boat_number: "b", start_timing: 0.2 },
    ]),
  },
  {
    input: '艇番1・ST "0.10"', specification: "文字列のSTの扱いは未定",
    current: () => pickStartTimingColumns([{ boat_number: 1, start_timing: "0.10" }]),
  },
];

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・HTML_A・HTML_B・HTML_NONE・HTML_PARTIAL） */
export function runScrapeResultJobScenesB1(env) {
  ({ check, show, same, HTML_A, HTML_B, HTML_NONE, HTML_PARTIAL } = env);

}

function srjb1Scene1() {
  // ---------------------------------------------------------------------------
  // (a) 解析・行の組み立て・result_digest
  // ---------------------------------------------------------------------------
  parsedA = parseRaceResultHtml(HTML_A);
  parsedB = parseRaceResultHtml(HTML_B);
  rowA = buildRaceResultRow(RACE_A, parsedA, {
    resultAt: "2026-09-19T06:00:00Z",
  });
  timingsA = parsedA.startTimings.map((st) => ({ race_id: RACE_A, ...st }));
  check(
    "解析: 桐生1Rの着順・決まり手・払戻・進入・STが、公式ページの表示と一致（1-6-2-3-5-4・逃げ・単勝160円）",
    rowA.rank1 === 1 &&
      rowA.rank2 === 6 &&
      rowA.rank3 === 2 &&
      rowA.rank6 === 4 &&
      rowA.winning_technique === "逃げ" &&
      rowA.payout_win === 160 &&
      rowA.payout_trio === 1480 &&
      parsedA.startTimings.length === 6 &&
      isResultComplete(rowA),
    show(rowA),
  );
  check(
    "解析: 未公開ページ（着順テーブルなし）は null（例外にしない）",
    parseRaceResultHtml(HTML_NONE) === null,
  );
  check(
    "解析: 決まり手が未公開なら、行は組み立てられるが完了ではない（payout_winはあるが winning_technique が null）",
    (() => {
      const p = parseRaceResultHtml(HTML_PARTIAL);
      const r = p && buildRaceResultRow(RACE_A, p);
      return (
        r &&
        r.payout_win === 160 &&
        r.winning_technique === null &&
        !isResultComplete(r)
      );
    })(),
  );
  check(
    "行の列は、ダイジェスト対象の列＋result_at と一致（列を足しても、ダイジェストから漏れない）",
    same(
      Object.keys(rowA).sort(),
      [...RESULT_DIGEST_COLUMNS, "result_at"].sort(),
    ),
    show(Object.keys(rowA).filter((c) => !RESULT_DIGEST_COLUMNS.includes(c))),
  );
}

function srjb1Scene2() {
  // BOA-1134: 列の取り出しをハッシュとは独立に固定する。
  {
    check("pickResultColumns: null・空行は37列すべてnull",
      [null, {}].every((row) => same(pickResultColumns(row), Array(37).fill(null))));
    check("pickResultColumns: 列順・非有限数・undefined・余分な列",
      same(pickResultColumns({
        race_id: "2026-10-01-01-01", rank1: 1, rank2: "2", rank3: NaN,
        rank4: Infinity, rank5: undefined, extra: 9,
      }), ["2026-10-01-01-01", 1, "2", ...Array(34).fill(null)]));
    check("pickResultColumns: result_atは除外",
      same(pickResultColumns({ race_id: "x", result_at: "t" }),
        pickResultColumns({ race_id: "x" })));
    check("START_TIMING_DIGEST_COLUMNS: 列順",
      same(START_TIMING_DIGEST_COLUMNS,
        ["boat_number", "start_timing", "is_flying", "is_late_start"]));
    check("pickStartTimingColumns: null・undefined・空配列",
      [null, undefined, []].every((rows) => same(pickStartTimingColumns(rows), [])));
    const cases = [
      ["STなしを除外・艇番順・欠けた項目はnull", [
        { boat_number: 3, start_timing: 0.12, is_flying: false, is_late_start: false },
        { boat_number: 1, start_timing: 0.05, is_flying: true },
        { boat_number: 2, start_timing: null }, { boat_number: 4 },
      ], [[1, 0.05, true, null], [3, 0.12, false, false]]],
      ["ST 0を残す", [
        { boat_number: 2, start_timing: 0, is_flying: false, is_late_start: false },
        { boat_number: 1, start_timing: 0.01, is_flying: true, is_late_start: false },
      ], [[1, 0.01, true, false], [2, 0, false, false]]],
      ["文字列の艇番は数で整列し値を保持", [
        { boat_number: "10", start_timing: 0.1 },
        { boat_number: "9", start_timing: 0.1 },
      ], [["9", 0.1, null, null], ["10", 0.1, null, null]]],
      ["NaNのSTは行を残してnull", [
        { boat_number: 1, start_timing: NaN },
      ], [[1, null, null, null]]],
      ["STなしは重複に含めない", [
        { boat_number: 1, start_timing: 0.1 },
        { boat_number: 1, start_timing: null },
      ], [[1, 0.1, null, null]]],
    ];
    for (const [label, rows, expected] of cases) {
      check(`pickStartTimingColumns: ${label}`,
        same(pickStartTimingColumns(rows), expected));
    }
    for (const boat of [1, "1"]) {
      let message = "";
      try {
        pickStartTimingColumns([
          { boat_number: 1, start_timing: 0.1 },
          { boat_number: boat, start_timing: 0.2 },
        ]);
      } catch (error) {
        message = error.message;
      }
      check(`pickStartTimingColumns: 重複を拒否（${typeof boat}）`,
        message.includes("スタート情報に艇番の重複があります: [1,1]"));
    }
    const row = { race_id: "x" };
    const timings = [
      { boat_number: 2, start_timing: 0.1 },
      { boat_number: 1, start_timing: 0.2 },
    ];
    check("digest: 最小入力でもSTの順に依存しない",
      computeResultDigest(row, timings) === computeResultDigest(row, [...timings].reverse()));
    const one = [{ boat_number: 1, start_timing: 0.1 }];
    check("digest: STなしの出遅れ行を足しても同じ",
      computeResultDigest(row, one) === computeResultDigest(row,
        [...one, { boat_number: 2, start_timing: null, is_late_start: true }]));
  }
  digestA = computeResultDigest(rowA, timingsA);
  check(
    "digest: 同じ入力で同じ値。result_at（取得時刻）が違っても同じ",
    digestA === computeResultDigest(rowA, timingsA) &&
      digestA ===
        computeResultDigest(
          { ...rowA, result_at: "2030-01-01T00:00:00Z" },
          timingsA,
        ),
    digestA,
  );
}

function srjb1Scene3() {
  {
    // DBから読んだ行（列の順序が違う・実進入コースや的中などの余分な列がある・数値がnumeric由来）でも、解析した行と同じダイジェスト
    const dbRow = {
      id: 1,
      actual_course_1: 1,
      is_cancelled: false,
      ...Object.fromEntries(
        Object.entries(rowA)
          .filter(([k]) => k !== "result_at")
          .reverse(),
      ),
      result_at: "2026-09-19T06:10:00+00:00",
    };
    const dbTimings = [...timingsA]
      .reverse()
      .map((t) => ({ ...t, updated_at: "2026-09-19T06:10:00+00:00" }));
    check(
      "digest: DBの行（列順・余分な列・スタート情報の並び順が違う）でも、解析した行と同じ値（既存基盤の書いた値と比べられる）",
      computeResultDigest(dbRow, dbTimings) === digestA,
    );
  }
  check(
    "digest: 払戻が1円違えば別の値",
    computeResultDigest({ ...rowA, payout_win: 161 }, timingsA) !== digestA,
  );
  check(
    "digest: 決まり手が違えば別の値",
    computeResultDigest({ ...rowA, winning_technique: "まくり" }, timingsA) !==
      digestA,
  );
  check(
    "digest: スタートタイミングが違えば別の値",
    computeResultDigest(
      rowA,
      timingsA.map((t, i) =>
        i === 0 ? { ...t, start_timing: t.start_timing + 0.01 } : t,
      ),
    ) !== digestA,
  );
  check(
    "digest: スタート情報が無い場合は、ある場合と別の値。艇番の重複は例外",
    computeResultDigest(rowA, []) !== digestA &&
      (() => {
        try {
          computeResultDigest(rowA, [timingsA[0], timingsA[0]]);
          return false;
        } catch {
          return true;
        }
      })(),
  );
  check(
    "digest: 別のレースは別の値",
    computeResultDigest(
      buildRaceResultRow(RACE_B, parsedB),
      parsedB.startTimings.map((st) => ({ race_id: RACE_B, ...st })),
    ) !== digestA,
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・HTML_A・HTML_B・HTML_NONE・HTML_PARTIAL・URL_TO_HTML） */
export function runScrapeResultJobScenesB2(env) {
  ({ check, show, same, HTML_A, HTML_B, HTML_NONE, HTML_PARTIAL, URL_TO_HTML } = env);
  srjb1Scene1();
  srjb1Scene2();
  srjb1Scene3();
}
