/**
 * BOATCASTのモーター使用開始日（bc_mst。N26）の日次取得ジョブ（docs/design/boatcast-original-exhibition/）。
 * api/cron/boatcast-motor-start.js が、共通ラッパ（scripts/lib/scrapeJobs/cronWrapper.js）経由で使う。
 *
 * 日次ジョブ（レジストリ boatcast_motor_start）。全24会場の bc_mst（`YYYYMMDD` の1行。モーターの世代の区切り。
 * 会場ごとに、モーターの交換のたびに変わる）を、逐次（2.2秒以上の間隔）で取り、venue_motor_start_dates へ
 * 「（会場, 使用開始日）の組が初めて現れたとき」だけ追記する（履歴になる。同じ組は書かない）。
 * 実行時間は24リクエスト×約2.5秒 ≒ 60秒。
 *
 * モード: off（または行なし）は何もしない。shadow は取得・解析のみ（書かない）。live は書く。
 *
 * 失敗の扱い: 全24件の取得を試みる。一部だけ失敗（403・形式不正）した場合は、取れた分を書き、incomplete（対象日を
 * 処理済みにしない。補足の起動が再処理する）にして、last_report.alerts に出す。最初の3件が続けて失敗なら、アクセス拒否・
 * 接続の異常の疑いとして、取得を止めて error にする（bc_mst は全24会場で常時存在する。2026-09-21に24件とも200を確認）。
 */
import { ALL_VENUE_CODES } from "./publicMap.js";
import { parseMotorStartDate } from "./oritenParser.js";
import {
  buildMotorStartUrl,
  fetchBoatcast,
  sharedPacer,
} from "./boatcastClient.js";
import { MOTOR_START_TABLES, detectBoatcastSchema } from "./oritenSchema.js";
import { upsertChangedRows } from "../unchangedRows.js";
import { addSeconds } from "../scrapeJobs/time.js";

export const MOTOR_START_JOB = "boatcast_motor_start";

/** 最初からこの件数が続けて失敗したら、取得を止める（アクセス拒否・接続の異常の疑い） */
export const ABORT_AFTER_CONSECUTIVE_FAILURES = 3;

/** 通知の持続時間（時間）。日次ジョブなので、次の日の実行までに消える */
const ALERT_HOURS = 24;

/**
 * 全会場の bc_mst を取得して解析する（書き込まない。probe・shadow・live が共有する）。
 *
 * @param {Object} deps
 * @param {(url: string) => Promise<Response>} deps.fetchImpl politeFetch など
 * @param {{wait: () => Promise<void>}} [deps.pacer]
 * @param {() => boolean} [deps.shouldStop] 時間切れ（ソフトデッドライン）
 * @param {readonly string[]} [deps.venues]
 * @returns {Promise<{rows: Array<{venue_code: number, start_date: string}>, failures: Array<{venue: string, reason: string}>, aborted: boolean, stopped: boolean}>}
 */
export async function fetchMotorStartDates({
  fetchImpl,
  pacer = sharedPacer,
  shouldStop = () => false,
  venues = ALL_VENUE_CODES,
}) {
  const rows = [];
  const failures = [];
  let consecutive = 0;
  let aborted = false;
  let stopped = false;
  for (const jo of venues) {
    if (shouldStop()) {
      stopped = true;
      break;
    }
    let reason = null;
    try {
      const res = await fetchBoatcast(buildMotorStartUrl(jo), {
        fetchImpl,
        pacer,
      });
      if (res.status !== 200) {
        reason = `HTTP ${res.status}`;
      } else {
        const date = parseMotorStartDate(res.text);
        if (date === null) {
          reason = `本文が YYYYMMDD ではありません: ${String(res.text).slice(0, 40)}`;
        } else {
          rows.push({ venue_code: Number(jo), start_date: date });
        }
      }
    } catch (error) {
      reason = `取得に失敗しました: ${error?.message ?? error}`;
    }
    if (reason === null) {
      consecutive = 0;
      continue;
    }
    failures.push({ venue: jo, reason });
    consecutive++;
    // 最初から続けて失敗（取れた件数が0のまま）は、個別の欠落ではなく、全体の異常
    if (rows.length === 0 && consecutive >= ABORT_AFTER_CONSECUTIVE_FAILURES) {
      aborted = true;
      break;
    }
  }
  return { rows, failures, aborted, stopped };
}

/** 日ごとの取得の履歴に、今回の1件を足す（同じ対象日は置き換え。直近 HISTORY_DAYS 日分） */
export const HISTORY_DAYS = 14;
export function nextHistory(previous, entry) {
  const kept = Array.isArray(previous)
    ? previous.filter((h) => h?.date && h.date !== entry.date)
    : [];
  return [...kept, entry].slice(-HISTORY_DAYS);
}

/**
 * 日次ジョブのハンドラー（共通ラッパの run(ctx)）。
 */
export function createMotorStartRun({
  fetchDates = fetchMotorStartDates,
  pacer = sharedPacer,
  venues = ALL_VENUE_CODES,
} = {}) {
  return async function run(ctx) {
    const fetched = await fetchDates({
      fetchImpl: ctx.politeFetch,
      pacer,
      shouldStop: ctx.shouldStop,
      venues,
    });
    const { rows, failures, aborted, stopped } = fetched;
    const expected = venues.length;

    if (aborted) {
      return {
        outcome: "error",
        error: `bc_mst の取得が最初から${failures.length}件続けて失敗しました（アクセス拒否・接続の異常の疑い）: ${failures
          .map((f) => `${f.venue}: ${f.reason}`)
          .join(" / ")}`,
        rowsParsed: 0,
        rowsExpected: expected,
      };
    }

    let rowsWritten = 0;
    if (ctx.mode === "live" && rows.length > 0) {
      if (!(await detectBoatcastSchema(ctx.client, MOTOR_START_TABLES))) {
        return {
          outcome: "error",
          error:
            "マイグレーション087（venue_motor_start_dates）が未適用のため、書き込みませんでした",
          rowsParsed: rows.length,
          rowsExpected: expected,
        };
      }
      const result = await upsertChangedRows(
        ctx.client,
        "venue_motor_start_dates",
        rows,
        {
          onConflict: "venue_code,start_date",
          keyColumns: ["venue_code", "start_date"],
          chunkColumn: "venue_code",
          chunkSize: 24,
          label: "venue_motor_start_dates",
        },
      );
      if (result.error) {
        return {
          outcome: "error",
          error: result.error.message,
          rowsParsed: rows.length,
          rowsExpected: expected,
        };
      }
      rowsWritten = result.written;
    }

    const incomplete = failures.length > 0 || stopped;
    const now = ctx.now();
    const alerts = incomplete
      ? [
          {
            key: "motor_start_incomplete",
            text: `モーター使用開始日（bc_mst）が${rows.length}/${expected}会場しか取れていません${stopped ? "（時間切れ）" : ""}${
              failures.length > 0
                ? `: ${failures
                    .slice(0, 5)
                    .map((f) => `${f.venue} ${f.reason}`)
                    .join(" / ")}`
                : ""
            }`,
            until: addSeconds(now, ALERT_HOURS * 3600).toISOString(),
          },
        ]
      : [];
    return {
      outcome: "ok",
      rowsWritten,
      rowsParsed: rows.length,
      rowsExpected: expected,
      incomplete,
      report: {
        alerts,
        fetched: rows.length,
        expected,
        failed: failures.map((f) => f.venue),
        // 日ごとの取得の履歴（完了の定義A・Bの実測に使う。本体のテーブルは、新しい日付が現れたときだけ増えるため、日ごとの
        // 取得の成否・完了時刻が残らない）。同じ対象日の再実行（補足の起動）は置き換え、直近14日分を残す
        history: nextHistory(ctx.state?.last_report?.history, {
          date: ctx.targetDate,
          fetched: rows.length,
          expected,
          failed: failures.map((f) => f.venue),
          complete: !incomplete,
          doneAt: now.toISOString(),
        }),
      },
      body: { fetched: rows.length, expected, failed: failures.length },
    };
  };
}
